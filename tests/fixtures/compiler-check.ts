import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";
import solid from "@solidjs/vite-plugin";
import solidGrab from "../../src/vite.js";

const root = fileURLToPath(new URL("../../examples/solid2", import.meta.url));
const mode = process.argv[2];
assert(mode === "native" || mode === "babel" || mode === "production");

if (mode === "production") {
  const result = await build({
    configFile: false,
    root,
    plugins: [solidGrab(), solid()],
    build: { write: false, minify: false },
    logLevel: "silent",
  });
  const outputs = Array.isArray(result) ? result : [result];
  const code = outputs.flatMap(output => "output" in output ? output.output : [])
    .map(chunk => chunk.type === "chunk" ? chunk.code : String(chunk.source)).join("\n");
  assert(code.includes("Reactive counter"));
  assert(!code.includes("data-solid-source"));
  assert(!code.includes("solid-grab-init"));
  assert(!code.includes("/@solid-grab/init"));
  assert(!code.includes("solid-grab-overlay"));
} else {
  const server = await createServer({
    configFile: false,
    root,
    plugins: [solidGrab(), solid({ compiler: mode })],
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: "silent",
  });
  try {
    const result = await server.transformRequest("/main.tsx");
    assert(result);
    assert(/@solidjs(?:\/|_)web/.test(result.code));
    assert(!result.code.includes("solid-js/web"));
    // Both compilers minimize static HTML by removing optional quotes.
    assert(/data-solid-source=["']?main.tsx:10:7/.test(result.code));
    assert(result.code.includes('"data-solid-component": "Counter"'));
  } finally {
    await server.close();
  }
}
