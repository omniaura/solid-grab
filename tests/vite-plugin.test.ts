import { test, expect, describe } from "bun:test";
import type { Plugin, ResolvedConfig } from "vite";
import solidGrab from "../src/vite.js";
import { inspect } from "../src/inspector.js";

/** Helper: create the plugin and simulate Vite's configResolved hook */
function createPlugin(
  options: Parameters<typeof solidGrab>[0] = {},
  root = "/project"
): Plugin {
  const plugin = solidGrab(options);

  // Simulate Vite calling configResolved
  const fakeConfig = { root } as ResolvedConfig;

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

  test("only applies during dev serve", () => {
    const plugin = solidGrab();
    expect(plugin.apply).toBe("serve");
  });
});

describe("source paths", () => {
  const code = "const el = <p>Shared UI</p>;";

  test.each([
    ["/project/apps/web", "/project/packages/ui/src/primitives.tsx", "../../packages/ui/src/primitives.tsx"],
    ["/project", "/project-other/App.tsx", "../project-other/App.tsx"],
    ["/project/", "/project/src/App.tsx", "src/App.tsx"],
    ["/", "/src/App.tsx", "src/App.tsx"],
  ])("uses project-relative paths from %s to %s", (root, id, expected) => {
    const plugin = createPlugin({}, root);
    const result = (plugin as any).transform(code, id);
    expect(result.code).toContain(`data-solid-source="${expected}:1:12"`);
  });

  test.each(["../..", "/project"])("accepts a custom project root: %s", (projectRoot) => {
    const plugin = createPlugin({ projectRoot }, "/project/apps/web");
    const result = (plugin as any).transform(code, "/project/packages/ui/src/primitives.tsx");
    expect(result.code).toContain('data-solid-source="packages/ui/src/primitives.tsx:1:12"');
  });

  test("system-root mode preserves absolute paths including the leading slash", () => {
    const plugin = createPlugin({ pathMode: "system-root" });
    const result = (plugin as any).transform(code, "/project/src/App.tsx");
    expect(result.code).toContain('data-solid-source="/project/src/App.tsx:1:12"');
  });

  test("project-root mode keeps copied source, component tree, and HTML relative", () => {
    const root = "/Users/peyton/code/ditto/heyditto-stack/.worktrees/example/console";
    const plugin = createPlugin({ pathMode: "project-root" }, `${root}/apps/web`);
    const result = (plugin as any).transform(code, `${root}/packages/ui/src/primitives.tsx`);
    const container = document.createElement("div");
    container.innerHTML = result.code.slice(result.code.indexOf("<p"), -1);
    const element = container.firstElementChild as HTMLElement;
    element.setAttribute("data-solid-component", "SharedUI");
    const context = inspect(element);

    expect(context.elementSource).toEqual({
      file: "../../packages/ui/src/primitives.tsx", line: 1, column: 12,
    });
    expect(context.formatted).toContain("Source:  ../../packages/ui/src/primitives.tsx:1:12");
    expect(context.formatted).toContain("<SharedUI /> → ../../packages/ui/src/primitives.tsx:1:12");
    expect(context.formatted).toContain('data-solid-source="../../packages/ui/src/primitives.tsx:1:12"');
    expect(context.formatted).not.toContain("/Users/");
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

  test("does not inject into angle brackets inside a string literal", () => {
    const plugin = createPlugin();
    const code = `const placeholder = "<owner>/<repo>";`;
    const result = (plugin as any).transform(code, "/project/src/foo.tsx");
    // No JSX here — the angle brackets live inside a string.
    expect(result).toBeNull();
  });

  test("does not mangle angle-bracket placeholders inside a template literal", () => {
    // Regression: a CLI command built with a template literal whose
    // interpolation contains a string with `<owner>/<repo>` used to get
    // `data-solid-source="..."` injected into the string, which broke the
    // Babel parse with `Unexpected token, expected ","`.
    const plugin = createPlugin();
    const code = [
      `function App() {`,
      `  const ghCmd = () =>`,
      '    `gh secret set ${shq(name())} --repo ${shq(repo() || "<owner>/<repo>")} --body ${shq(key())}`',
      `  return <div>{ghCmd()}</div>;`,
      `}`,
    ].join("\n");
    const result = (plugin as any).transform(code, "/project/src/App.tsx");

    expect(result).not.toBeNull();
    // The placeholder string must be left exactly as-is.
    expect(result.code).toContain('"<owner>/<repo>"');
    expect(result.code).not.toContain("<repo data-solid-source");
    // ...while the real JSX still gets a source attribute.
    expect(result.code).toContain('data-solid-source="src/App.tsx:');
  });

  test("does not inject into angle brackets inside comments", () => {
    const plugin = createPlugin();
    const code = [
      `function App() {`,
      `  // renders a <div> wrapper`,
      `  /* fallback is <span> */`,
      `  return null;`,
      `}`,
    ].join("\n");
    const result = (plugin as any).transform(code, "/project/src/App.tsx");
    expect(result).toBeNull();
  });

  test("still injects into JSX inside a template-literal interpolation", () => {
    const plugin = createPlugin();
    // `<b>` is template text (skipped); `<Foo/>` lives in the ${} and is JSX.
    const code = "const t = `<b>${cond ? <Foo /> : null}</b>`;";
    const result = (plugin as any).transform(code, "/project/src/App.tsx");

    expect(result).not.toBeNull();
    expect(result.code).toContain('data-solid-component="Foo"');
    // The literal `<b>` text must be untouched.
    expect(result.code).toContain("`<b>");
    expect(result.code).not.toContain("<b data-solid-source");
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

describe("virtual module (key config)", () => {
  test("emits initSolidGrab with default Alt key", () => {
    const plugin = createPlugin();
    const result = (plugin as any).load("\0virtual:solid-grab-init");

    expect(result).toContain('import { initSolidGrab, destroySolidGrab } from "solid-grab"');
    expect(result).toContain("import.meta.hot.dispose(() => destroySolidGrab())");
    expect(result).toContain('initSolidGrab({ key: "Alt", showBadge: true })');
  });

  test("emits initSolidGrab with Meta key", () => {
    const plugin = createPlugin({ key: "Meta" });
    const result = (plugin as any).load("\0virtual:solid-grab-init");

    expect(result).toContain('initSolidGrab({ key: "Meta", showBadge: true })');
  });

  test("emits initSolidGrab with Control key", () => {
    const plugin = createPlugin({ key: "Control" });
    const result = (plugin as any).load("\0virtual:solid-grab-init");

    expect(result).toContain('initSolidGrab({ key: "Control", showBadge: true })');
  });

  test("emits initSolidGrab with showBadge false", () => {
    const plugin = createPlugin({ showBadge: false });
    const result = (plugin as any).load("\0virtual:solid-grab-init");

    expect(result).toContain('initSolidGrab({ key: "Alt", showBadge: false })');
  });

  test("returns undefined for non-virtual module ids", () => {
    const plugin = createPlugin();
    const result = (plugin as any).load("/project/src/App.tsx");
    expect(result).toBeUndefined();
  });
});

describe("transformIndexHtml", () => {
  test("returns tag descriptors", () => {
    const plugin = createPlugin();
    const result = (plugin as any).transformIndexHtml();

    expect(result).toBeArray();
    expect(result).toHaveLength(1);
    expect(result[0].tag).toBe("script");
    expect(result[0].attrs.type).toBe("module");
    expect(result[0].attrs.src).toBe("/@solid-grab/init");
    expect(result[0].injectTo).toBe("head");
  });

  test("returns undefined when autoImport is false", () => {
    const plugin = createPlugin({ autoImport: false });
    const result = (plugin as any).transformIndexHtml();

    expect(result).toBeUndefined();
  });
});
