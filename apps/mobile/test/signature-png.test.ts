import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { signatureToPng } from "../src/lib/signature-png";

describe("signatureToPng", () => {
  it("produces a valid PNG with ink where the stroke is", () => {
    const url = signatureToPng([[{ x: 10, y: 50 }, { x: 290, y: 50 }]], 300, 100, 300, 3);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    const png = Buffer.from(url.split(",")[1]!, "base64");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(300); // width
    expect(png.readUInt32BE(20)).toBe(100); // height
    const idatLen = png.readUInt32BE(33);
    expect(png.subarray(37, 41).toString()).toBe("IDAT");
    const raw = inflateSync(png.subarray(41, 41 + idatLen)); // also validates adler32
    const rowBytes = Math.ceil(300 / 8) + 1;
    expect(raw.length).toBe(rowBytes * 100);
    const pixel = (x: number, y: number) => (raw[y * rowBytes + 1 + (x >> 3)]! >> (7 - (x & 7))) & 1;
    expect(pixel(150, 50)).toBe(0); // ink
    expect(pixel(150, 10)).toBe(1); // paper
    expect(url.length).toBeLessThan(300_000); // API limit for signatures
  });
});
