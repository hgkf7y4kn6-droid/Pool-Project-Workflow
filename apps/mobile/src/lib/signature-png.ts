/**
 * Rasterize signature strokes into a 1-bit PNG data URL without any native
 * module (works the same on iOS, Android and web). Uses uncompressed
 * ("stored") deflate blocks, which every PNG decoder accepts; a 600×180
 * signature is ~14 KB before base64.
 */
export type Stroke = { x: number; y: number }[];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const x of bytes) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

function chunk(type: string, data: Uint8Array): number[] {
  const typed = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) typed[i] = type.charCodeAt(i);
  typed.set(data, 4);
  return [...u32(data.length), ...typed, ...u32(crc32(typed))];
}

function zlibStored(raw: Uint8Array): Uint8Array {
  const out: number[] = [0x78, 0x01];
  for (let i = 0; i < raw.length || i === 0; i += 65535) {
    const block = raw.subarray(i, Math.min(i + 65535, raw.length));
    const last = i + 65535 >= raw.length ? 1 : 0;
    out.push(last, block.length & 255, block.length >>> 8, ~block.length & 255, (~block.length >>> 8) & 255);
    for (const b of block) out.push(b);
    if (last) break;
  }
  out.push(...u32(adler32(raw)));
  return Uint8Array.from(out);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >>> 18) & 63]! + B64[(n >>> 12) & 63]! + (i + 1 < bytes.length ? B64[(n >>> 6) & 63]! : "=") + (i + 2 < bytes.length ? B64[n & 63]! : "=");
  }
  return out;
}

/** Strokes are in source coordinates (sourceWidth × sourceHeight). */
export function signatureToPng(strokes: Stroke[], sourceWidth: number, sourceHeight: number, width = 600, thickness = 3): string {
  const height = Math.max(1, Math.round((width * sourceHeight) / Math.max(sourceWidth, 1)));
  const sx = width / Math.max(sourceWidth, 1);
  const sy = height / Math.max(sourceHeight, 1);
  const rowBytes = Math.ceil(width / 8);
  // 1-bit grayscale: bit 1 = white. Start all white.
  const pixels = new Uint8Array(rowBytes * height).fill(0xff);
  const plot = (x: number, y: number) => {
    const r = Math.max(1, Math.floor(thickness / 2));
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const px = Math.round(x + dx);
        const py = Math.round(y + dy);
        if (px < 0 || py < 0 || px >= width || py >= height || dx * dx + dy * dy > r * r + 1) continue;
        pixels[py * rowBytes + (px >> 3)]! &= ~(0x80 >> (px & 7));
      }
  };
  for (const stroke of strokes) {
    for (let i = 0; i < stroke.length; i++) {
      const a = stroke[i]!;
      const b = stroke[i + 1] ?? a;
      const steps = Math.max(1, Math.ceil(Math.hypot((b.x - a.x) * sx, (b.y - a.y) * sy)));
      for (let s = 0; s <= steps; s++) plot((a.x + ((b.x - a.x) * s) / steps) * sx, (a.y + ((b.y - a.y) * s) / steps) * sy);
    }
  }
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  const ihdr = Uint8Array.from([...u32(width), ...u32(height), 1, 0, 0, 0, 0]); // bit depth 1, grayscale
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunk("IHDR", ihdr), ...chunk("IDAT", zlibStored(raw)), ...chunk("IEND", new Uint8Array())]);
  return `data:image/png;base64,${base64(png)}`;
}
