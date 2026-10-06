import { describe, expect, it } from "vitest";
import { contrastRatio, palette, toneColors, type Tone } from "../src";

describe("design tokens", () => {
  for (const scheme of ["light", "dark"] as const) {
    const p = palette[scheme];
    it(`${scheme}: text is legible outdoors`, () => {
      expect(contrastRatio(p.foreground, p.card)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(p.foreground, p.background)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(p.mutedForeground, p.card)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.primaryForeground, p.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.accentForeground, p.accent)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${scheme}: status badges meet AA`, () => {
      for (const tone of ["neutral", "info", "success", "warning", "danger", "primary"] as Tone[]) {
        const { fg, bg } = toneColors(tone, scheme);
        expect(contrastRatio(fg, bg), tone).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
