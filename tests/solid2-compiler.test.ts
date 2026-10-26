import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("./fixtures/compiler-check.ts", import.meta.url));

describe("Solid 2 compiler integration", () => {
  for (const mode of ["native", "babel", "production"]) {
    test(`${mode}: compiler-independent injection and production isolation`, async () => {
      // Vite needs Node timers; isolate it from the suite's happy-dom globals.
      const process = Bun.spawn([Bun.which("bun")!, "run", fixture, mode], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
      ]);
      expect({ exitCode, stderr: exitCode ? stderr : "", stdout: exitCode ? stdout : "" })
        .toEqual({ exitCode: 0, stderr: "", stdout: "" });
    }, 30_000);
  }
});
