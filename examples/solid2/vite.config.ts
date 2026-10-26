import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";
import solidGrab from "../../src/vite.js";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [
    solidGrab(),
    solid({ compiler: process.env.SOLID_COMPILER === "babel" ? "babel" : "native" }),
  ],
});
