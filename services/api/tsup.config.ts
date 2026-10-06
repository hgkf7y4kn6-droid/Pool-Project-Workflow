import { defineConfig } from "tsup";

// Bundle the server with the internal @pool/* packages inlined (they ship as
// TypeScript source); third-party dependencies stay external.
export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  noExternal: [/^@pool\//],
});
