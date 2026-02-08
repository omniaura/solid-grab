import { defineConfig } from "tsup";

export default defineConfig([
  // Runtime entry (browser)
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    platform: "browser",
    external: ["solid-js"],
  },
  // Vite plugin entry (node)
  {
    entry: { vite: "src/vite.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    platform: "node",
    external: ["vite"],
  },
]);
