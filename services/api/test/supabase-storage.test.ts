import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseStorage } from "../src/adapters/storage/supabase";

/**
 * A minimal stand-in for Supabase Storage's HTTP API (the endpoints
 * @supabase/storage-js calls), so the driver's protocol is tested without a
 * live project.
 */
const SECRET = "sb_secret_test";
const objects = new Map<string, { body: Buffer; type: string }>();
let server: Server;
let base = "";

const read = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://x");
    const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ""));
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const body = await read(req);
    // Signed uploads authenticate with the token alone; everything else needs the secret key.
    const signedUpload = req.method === "PUT" && p.startsWith("/object/upload/sign/");
    if (!signedUpload && req.headers.authorization !== `Bearer ${SECRET}`) return json(401, { message: "unauthorized" });

    let m: RegExpMatchArray | null;
    if (req.method === "POST" && (m = p.match(/^\/object\/upload\/sign\/(.+)$/))) return json(200, { url: `/object/upload/sign/${m[1]}?token=tok:${m[1]}` });
    if (req.method === "PUT" && (m = p.match(/^\/object\/upload\/sign\/(.+)$/))) {
      if (url.searchParams.get("token") !== `tok:${m[1]}`) return json(400, { message: "bad token" });
      objects.set(m[1]!, { body, type: String(req.headers["content-type"]) });
      return json(200, { Key: m[1] });
    }
    if (req.method === "POST" && (m = p.match(/^\/object\/sign\/(.+)$/))) {
      const { expiresIn } = JSON.parse(body.toString()) as { expiresIn: number };
      return json(200, { signedURL: `/object/sign/${m[1]}?token=dl:${expiresIn}` });
    }
    if (req.method === "GET" && (m = p.match(/^\/object\/info\/(.+)$/))) {
      const o = objects.get(m[1]!);
      return o ? json(200, { name: m[1], size: o.body.length, content_type: o.type }) : json(404, { message: "not found" });
    }
    if (req.method === "POST" && (m = p.match(/^\/object\/(.+)$/))) {
      objects.set(m[1]!, { body, type: String(req.headers["content-type"]) });
      return json(200, { Key: m[1] });
    }
    if (req.method === "GET" && (m = p.match(/^\/object\/(.+)$/))) {
      const o = objects.get(m[1]!);
      if (!o) return json(404, { message: "not found" });
      res.writeHead(200, { "content-type": o.type });
      return res.end(o.body);
    }
    if (req.method === "DELETE" && (m = p.match(/^\/object\/([^/]+)$/))) {
      const { prefixes } = JSON.parse(body.toString()) as { prefixes: string[] };
      for (const k of prefixes) objects.delete(`${m[1]}/${k}`);
      return json(200, prefixes.map((name) => ({ name })));
    }
    if (req.method === "GET" && (m = p.match(/^\/bucket\/(.+)$/))) return m[1] === "existing" ? json(200, { id: "existing" }) : json(404, { message: "Bucket not found" });
    if (req.method === "POST" && p === "/bucket") return json(200, { name: JSON.parse(body.toString()).name });
    json(404, { message: `no route ${req.method} ${p}` });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("SupabaseStorage", () => {
  const storage = () => new SupabaseStorage({ url: base, secretKey: SECRET, bucket: "pool-pm-files" });
  const key = "org/o1/projects/p1/photos/ph1/original.jpg";

  it("issues a signed upload the app can PUT to, then verifies and serves the object", async () => {
    const ticket = await storage().createUploadUrl(key, { contentType: "image/jpeg", expiresInSeconds: 3600 });
    expect(ticket.method).toBe("PUT");
    expect(ticket.url).toContain("/object/upload/sign/pool-pm-files/");
    // Exactly what the mobile upload manager does: raw bytes + ticket headers, no secret.
    const res = await fetch(ticket.url, { method: "PUT", headers: ticket.headers, body: Buffer.from("jpeg-bytes") });
    expect(res.ok).toBe(true);

    expect(await storage().head(key)).toEqual({ size: 10, contentType: "image/jpeg" });
    expect((await storage().getObject(key)).toString()).toBe("jpeg-bytes");
    const dl = await storage().createDownloadUrl(key, { expiresInSeconds: 900, fileName: "rebar.jpg" });
    expect(dl).toContain("token=dl:900");
    expect(dl).toContain("download=rebar.jpg");
  });

  it("caps the upload expiry at Supabase's fixed two hours", async () => {
    const ticket = await storage().createUploadUrl("a/b.pdf", { contentType: "application/pdf", expiresInSeconds: 24 * 3600 });
    const ttl = (new Date(ticket.expiresAt).getTime() - Date.now()) / 1000;
    expect(ttl).toBeLessThanOrEqual(2 * 3600 + 1);
  });

  it("writes, reports missing objects as null, and deletes", async () => {
    await storage().putObject("thumbs/t.jpg", Buffer.from("thumb"), "image/jpeg");
    expect((await storage().head("thumbs/t.jpg"))?.size).toBe(5);
    await storage().deleteObject("thumbs/t.jpg");
    expect(await storage().head("thumbs/t.jpg")).toBeNull();
  });

  it("creates the private bucket once", async () => {
    expect(await new SupabaseStorage({ url: base, secretKey: SECRET, bucket: "existing" }).ensureBucket({ fileSizeLimitBytes: 1 })).toBe("exists");
    expect(await storage().ensureBucket({ fileSizeLimitBytes: 1 })).toBe("created");
  });

  it("fails loudly with a wrong key instead of pretending to work", async () => {
    await expect(new SupabaseStorage({ url: base, secretKey: "wrong", bucket: "pool-pm-files" }).createUploadUrl("x", { contentType: "image/jpeg", expiresInSeconds: 60 })).rejects.toThrow(/could not sign upload/);
  });
});
