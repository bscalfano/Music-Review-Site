import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.{ts,tsx}", "src/**/*.test.ts"],
    setupFiles: ["tests/setup-env.ts"],
    testTimeout: 20_000,
  },
});
