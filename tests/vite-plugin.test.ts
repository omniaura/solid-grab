import { test, expect, describe } from "bun:test";
import type { Plugin, ResolvedConfig } from "vite";
import solidGrab from "../src/vite.js";

/** Helper: create the plugin and simulate Vite's configResolved hook */
function createPlugin(
  options: Parameters<typeof solidGrab>[0] = {},
  mode: "development" | "production" = "development"
): Plugin {
  const plugin = solidGrab(options);

  // Simulate Vite calling configResolved
  const fakeConfig = {
    root: "/project",
    command: mode === "development" ? "serve" : "build",
    mode,
  } as ResolvedConfig;

  (plugin as any).configResolved(fakeConfig);
  return plugin;
}

describe("plugin metadata", () => {
  test("has correct name", () => {
    const plugin = solidGrab();
    expect(plugin.name).toBe("solid-grab");
  });

  test("enforces pre", () => {
    const plugin = solidGrab();
    expect(plugin.enforce).toBe("pre");
  });
});

describe("transform", () => {
  test("injects data-solid-source into JSX elements", () => {
    const plugin = createPlugin();
    const code = `function App() {\n  return <div>hello</div>;\n}`;
    const result = (plugin as any).transform(code, "/project/src/App.tsx");

    expect(result).not.toBeNull();
    expect(result.code).toContain('data-solid-source="src/App.tsx:');
  });

  test("injects data-solid-component for PascalCase tags", () => {
    const plugin = createPlugin();
    const code = `function App() {\n  return <MyComponent />;\n}`;
    const result = (plugin as any).transform(code, "/project/src/App.tsx");

    expect(result).not.toBeNull();
    expect(result.code).toContain('data-solid-component="MyComponent"');
  });

  test("does not inject data-solid-component for lowercase tags", () => {
    const plugin = createPlugin();
    const code = `function App() {\n  return <div>hello</div>;\n}`;
    const result = (plugin as any).transform(code, "/project/src/App.tsx");

    expect(result).not.toBeNull();
    expect(result.code).not.toContain("data-solid-component");
  });

  test("skips non-JSX files", () => {
    const plugin = createPlugin();
    const result = (plugin as any).transform("const x = 1;", "/project/src/utils.ts");
    expect(result).toBeNull();
  });

  test("skips node_modules", () => {
    const plugin = createPlugin();
    const code = `function App() {\n  return <div>hello</div>;\n}`;
    const result = (plugin as any).transform(code, "/project/node_modules/foo/index.tsx");
    expect(result).toBeNull();
  });

  test("skips in production mode", () => {
    const plugin = createPlugin({}, "production");
    const code = `function App() {\n  return <div>hello</div>;\n}`;
    const result = (plugin as any).transform(code, "/project/src/App.tsx");
    expect(result).toBeNull();
  });

  test("does not inject into TypeScript generics", () => {
    const plugin = createPlugin();
    const code = [
      `const x: Accessor<boolean> = () => true;`,
      `const ctx = createContext<ModalContextType | null>(null);`,
      `const [store, setStore] = createStore<SubjectViewerStore>({});`,
      `function useFoo(a: string, b: Accessor<boolean>) {}`,
      `return useDittoQuery<typeof Schema, Response | null>({});`,
    ].join("\n");
    const result = (plugin as any).transform(code, "/project/src/hooks.tsx");

    // No JSX in this code — should return null (no changes)
    expect(result).toBeNull();
  });

  test("injects into JSX but not generics in the same file", () => {
    const plugin = createPlugin();
    const code = [
      `function App() {`,
      `  const x: Accessor<boolean> = () => true;`,
      `  return <div>hello</div>;`,
      `}`,
    ].join("\n");
    const result = (plugin as any).transform(code, "/project/src/App.tsx");

    expect(result).not.toBeNull();
    expect(result.code).toContain('data-solid-source=');
    // The generic should be untouched
    expect(result.code).toContain("Accessor<boolean>");
    expect(result.code).not.toContain("Accessor<boolean data-solid");
  });

  test("does not inject into comparison operators", () => {
    const plugin = createPlugin();
    const code = [
      `function foo() {`,
      `  const x = count() < totalItems`,
      `  if (a < b) {}`,
      `  return userTier < minimumTier`,
      `}`,
    ].join("\n");
    const result = (plugin as any).transform(code, "/project/src/foo.tsx");
    expect(result).toBeNull();
  });

  test("does not inject into comparison after function call", () => {
    const plugin = createPlugin();
    const code = [
      `function foo() {`,
      `  return visiblePageCount() < totalPages`,
      `}`,
    ].join("\n");
    const result = (plugin as any).transform(code, "/project/src/foo.tsx");
    expect(result).toBeNull();
  });

  test("does not inject into comparison in conditional expression", () => {
    const plugin = createPlugin();
    const code = [
      `if (`,
      `  newIndex !== currentIndex() &&`,
      `  newIndex >= 0 &&`,
      `  newIndex < props.images.length`,
      `) {}`,
    ].join("\n");
    const result = (plugin as any).transform(code, "/project/src/foo.tsx");
    expect(result).toBeNull();
  });

  test("injects into JSX after return keyword", () => {
    const plugin = createPlugin();
    const code = `function App() {\n  return <div>hello</div>;\n}`;
    const result = (plugin as any).transform(code, "/project/src/App.tsx");
    expect(result).not.toBeNull();
    expect(result.code).toContain("data-solid-source=");
  });

  test("injects into JSX after logical operators", () => {
    const plugin = createPlugin();
    const code = `const el = show() && <div>visible</div>;`;
    const result = (plugin as any).transform(code, "/project/src/App.tsx");
    expect(result).not.toBeNull();
    expect(result.code).toContain("data-solid-source=");
  });

  test("injects into JSX in ternary expression", () => {
    const plugin = createPlugin();
    const code = `const el = cond ? <div>a</div> : <span>b</span>;`;
    const result = (plugin as any).transform(code, "/project/src/App.tsx");
    expect(result).not.toBeNull();
    expect(result.code).toContain("data-solid-source=");
  });

  test("handles mixed comparisons and JSX in the same file", () => {
    const plugin = createPlugin();
    const code = [
      `function App() {`,
      `  const isSmall = count() < maxItems;`,
      `  return <div>{isSmall ? <span>small</span> : <span>big</span>}</div>;`,
      `}`,
    ].join("\n");
    const result = (plugin as any).transform(code, "/project/src/App.tsx");
    expect(result).not.toBeNull();
    expect(result.code).toContain("data-solid-source=");
    // Comparison should be untouched
    expect(result.code).toContain("count() < maxItems");
  });

  test("respects jsxLocation: false", () => {
    const plugin = createPlugin({ jsxLocation: false });
    const code = `function App() {\n  return <div>hello</div>;\n}`;
    const result = (plugin as any).transform(code, "/project/src/App.tsx");
    // No source attr, no component attr for lowercase tag — should return null (no changes)
    expect(result).toBeNull();
  });

  test("respects componentLocation: false", () => {
    const plugin = createPlugin({ componentLocation: false });
    const code = `function App() {\n  return <MyComponent />;\n}`;
    const result = (plugin as any).transform(code, "/project/src/App.tsx");

    expect(result).not.toBeNull();
    expect(result.code).toContain("data-solid-source");
    expect(result.code).not.toContain("data-solid-component");
  });
});

describe("transformIndexHtml", () => {
  test("returns tag descriptors in dev mode", () => {
    const plugin = createPlugin();
    const result = (plugin as any).transformIndexHtml();

    expect(result).toBeArray();
    expect(result).toHaveLength(1);
    expect(result[0].tag).toBe("script");
    expect(result[0].attrs.type).toBe("module");
    expect(result[0].attrs.src).toBe("/@solid-grab/init");
    expect(result[0].injectTo).toBe("head");
  });

  test("returns undefined in production mode", () => {
    const plugin = createPlugin({}, "production");
    const result = (plugin as any).transformIndexHtml();

    expect(result).toBeUndefined();
  });

  test("returns undefined when autoImport is false", () => {
    const plugin = createPlugin({ autoImport: false });
    const result = (plugin as any).transformIndexHtml();

    expect(result).toBeUndefined();
  });
});
