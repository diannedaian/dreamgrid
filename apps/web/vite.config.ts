import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    // The Three/R3F stack is lazy-loaded into its own chunk. Warn if that
    // deliberately isolated renderer bundle grows beyond this baseline.
    chunkSizeWarningLimit: 1_000,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
  },
});
