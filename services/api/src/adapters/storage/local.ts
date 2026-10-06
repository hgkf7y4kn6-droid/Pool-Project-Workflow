import { createHmac } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeEqual } from "../../lib/crypto";
import type { SignedUpload, StorageProvider } from "./types";

/**
 * Development storage on the local disk. Signed URLs point at the API's
 * /storage/local routes and are verified with an HMAC, mirroring S3 presigned
 * URL semantics so client code is identical in every environment.
 */
export class LocalStorage implements StorageProvider {
  readonly driver = "local";
  constructor(
    private readonly rootDir: string,
    private readonly publicBaseUrl: string,
    private readonly secret: string,
  ) {}

  private filePath(key: string): string {
    const resolved = path.resolve(this.rootDir, key);
    if (!resolved.startsWith(path.resolve(this.rootDir) + path.sep)) throw new Error("Invalid storage key");
    return resolved;
  }

  sign(method: string, key: string, expires: number, contentType = ""): string {
    return createHmac("sha256", this.secret).update(`${method}\n${key}\n${expires}\n${contentType}`).digest("base64url");
  }

  verify(method: string, key: string, expires: number, signature: string, contentType = ""): boolean {
    if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;
    return safeEqual(this.sign(method, key, expires, contentType), signature);
  }

  private url(method: string, key: string, expiresInSeconds: number, contentType = "", extra = ""): string {
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const sig = this.sign(method, key, expires, contentType);
    return `${this.publicBaseUrl}/storage/local/${encodeURI(key)}?exp=${expires}&sig=${sig}${extra}`;
  }

  async createUploadUrl(key: string, options: { contentType: string; expiresInSeconds: number }): Promise<SignedUpload> {
    return {
      url: this.url("PUT", key, options.expiresInSeconds, options.contentType),
      method: "PUT",
      headers: { "Content-Type": options.contentType },
      expiresAt: new Date(Date.now() + options.expiresInSeconds * 1000).toISOString(),
    };
  }

  async createDownloadUrl(key: string, options: { expiresInSeconds: number; fileName?: string }): Promise<string> {
    const extra = options.fileName ? `&name=${encodeURIComponent(options.fileName)}` : "";
    return this.url("GET", key, options.expiresInSeconds, "", extra);
  }

  async head(key: string) {
    try {
      const s = await stat(this.filePath(key));
      let contentType: string | null = null;
      try {
        contentType = (await readFile(this.filePath(key) + ".meta", "utf8")) || null;
      } catch {
        /* no sidecar */
      }
      return { size: s.size, contentType };
    } catch {
      return null;
    }
  }

  async getObject(key: string): Promise<Buffer> {
    return readFile(this.filePath(key));
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const file = this.filePath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
    await writeFile(file + ".meta", contentType);
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.filePath(key), { force: true });
    await rm(this.filePath(key) + ".meta", { force: true });
  }
}
