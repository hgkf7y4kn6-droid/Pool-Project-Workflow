import { defineConfig } from "tsup";

// Bundle the server with the internal @pool/* packages inlined (they ship as
// TypeScript source); third-party dependencies stay external.
export default defineConfig({
  entry: ["src/server.ts", "src/migrate.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  noExternal: [/^@pool\//],
  // Third-party packages (including ones only the @pool/* packages depend on)
  // stay external and are resolved from node_modules at runtime.
  external: [/^(?!@pool\/)(@[^/]+\/)?[^./][^:]*$/],
});
