// Renders assets/brand/mark.svg into the app icon, Android adaptive icon
// layers, splash image and web favicon. Run after editing the mark:
//   node apps/mobile/scripts/generate-brand-assets.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mark = readFileSync(path.join(root, "assets/brand/mark.svg"), "utf8");
const out = (f) => path.join(root, "assets/images", f);

// The mark without its rounded tile, for layers that the OS masks itself.
const inner = mark.replace(/<rect width="64" height="64" rx="18" fill="#0a2230"\/>/, "");
const padded = (svg, size, scale, bg) =>
  sharp(Buffer.from(svg), { density: 1200 })
    .resize(Math.round(size * scale), Math.round(size * scale))
    .extend({
      top: Math.round((size - size * scale) / 2),
      bottom: Math.round((size - size * scale) / 2),
      left: Math.round((size - size * scale) / 2),
      right: Math.round((size - size * scale) / 2),
      background: bg,
    })
    .resize(size, size);

// iOS / generic icon: full-bleed square (iOS rounds the corners itself).
await sharp(Buffer.from(mark.replace('rx="18"', 'rx="0"')), { density: 1200 }).resize(1024, 1024).png().toFile(out("icon.png"));
// Android adaptive: deep-water background + centered mark in the 66% safe zone.
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#0a2230" } }).png().toFile(out("android-icon-background.png"));
await padded(inner, 1024, 0.62, { r: 0, g: 0, b: 0, alpha: 0 }).png().toFile(out("android-icon-foreground.png"));
const mono = inner.replace(/fill="#[0-9a-f]{6}"|fill="url\(#water\)"/g, 'fill="#000000"').replace(/stroke="#ffffff"/g, 'stroke="#ffffff"');
await padded(mono, 1024, 0.62, { r: 0, g: 0, b: 0, alpha: 0 }).png().toFile(out("android-icon-monochrome.png"));
// Splash: the rounded mark on transparent (background colors come from app.json).
await sharp(Buffer.from(mark), { density: 1200 }).resize(512, 512).png().toFile(out("splash-icon.png"));
await sharp(Buffer.from(mark), { density: 600 }).resize(96, 96).png().toFile(out("favicon.png"));
console.log("brand assets written to assets/images");
