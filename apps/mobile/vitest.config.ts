import { defineConfig } from "vitest/config";

// Unit tests for platform-independent mobile logic (no React Native runtime).
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
