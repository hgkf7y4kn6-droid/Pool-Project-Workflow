import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { palette } from "../src";

/** The app's NativeWind theme (global.css) must mirror the palette exactly. */
describe("global.css mirrors the palette", () => {
  const css = readFileSync(path.resolve(__dirname, "../../../apps/mobile/global.css"), "utf8");
  const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const block = (scheme: "light" | "dark") => {
    const i = scheme === "light" ? css.indexOf("@theme") : css.indexOf("prefers-color-scheme: dark");
    return css.slice(i, css.indexOf("}", css.indexOf("--color-", i)) + 1);
  };
  for (const scheme of ["light", "dark"] as const) {
    it(scheme, () => {
      const b = block(scheme);
      for (const [k, v] of Object.entries(palette[scheme])) {
        expect(b, `--color-${kebab(k)}`).toContain(`--color-${kebab(k)}: ${v};`);
      }
    });
  }
});
