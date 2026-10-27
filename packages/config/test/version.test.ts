import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_VERSION, nextVersion } from "../src/version";

it("APP_VERSION matches the root package.json and the app config", () => {
  const root = path.resolve(__dirname, "../../..");
  expect(APP_VERSION).toBe(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version);
  expect(APP_VERSION).toBe(JSON.parse(readFileSync(path.join(root, "apps/mobile/app.json"), "utf8")).expo.version);
});

describe("nextVersion", () => {
  it.each([
    ["0.0.3", "0.0.4"],
    ["0.0.8", "0.0.9"],
    ["0.0.9", "0.1.0"],
    ["0.1.9", "0.2.0"],
    ["0.9.9", "1.0.0"],
    ["1.9.9", "2.0.0"],
    ["12.4.5", "12.4.6"],
  ])("%s → %s", (from, to) => expect(nextVersion(from)).toBe(to));

  it("rejects versions that don't follow the single-digit scheme", () => {
    expect(() => nextVersion("0.10.0")).toThrow();
    expect(() => nextVersion("1.2")).toThrow();
  });
});
