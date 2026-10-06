import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
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
