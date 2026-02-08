import { test, expect, describe } from "bun:test";
import {
  parseSourceAttr,
  findNearestSource,
  findNearestComponent,
  getComponentChain,
  formatContext,
  inspect,
} from "../src/inspector.js";

describe("parseSourceAttr", () => {
  test("parses valid source string", () => {
    const result = parseSourceAttr("src/App.tsx:12:5");
    expect(result).toEqual({ file: "src/App.tsx", line: 12, column: 5 });
  });

  test("returns null for null input", () => {
    expect(parseSourceAttr(null)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseSourceAttr("")).toBeNull();
  });

  test("returns null for string with fewer than 3 parts", () => {
    expect(parseSourceAttr("file:10")).toBeNull();
  });

  test("returns null for non-numeric line/col", () => {
    expect(parseSourceAttr("file:abc:def")).toBeNull();
  });

  test("handles Windows-style paths with drive letter", () => {
    const result = parseSourceAttr("C:\\src\\App.tsx:42:8");
    expect(result).toEqual({ file: "C:\\src\\App.tsx", line: 42, column: 8 });
  });
});

describe("findNearestSource", () => {
  test("finds source on the element itself", () => {
    const el = document.createElement("div");
    el.setAttribute("data-solid-source", "src/Foo.tsx:1:1");
    const result = findNearestSource(el);
    expect(result).toEqual({ file: "src/Foo.tsx", line: 1, column: 1 });
  });

  test("walks up to parent to find source", () => {
    const parent = document.createElement("div");
    parent.setAttribute("data-solid-source", "src/Parent.tsx:5:3");
    const child = document.createElement("span");
    parent.appendChild(child);

    const result = findNearestSource(child);
    expect(result).toEqual({ file: "src/Parent.tsx", line: 5, column: 3 });
  });

  test("returns null when no source found", () => {
    const el = document.createElement("div");
    expect(findNearestSource(el)).toBeNull();
  });
});

describe("findNearestComponent", () => {
  test("finds component on element", () => {
    const el = document.createElement("div");
    el.setAttribute("data-solid-component", "Counter");
    expect(findNearestComponent(el)).toBe("Counter");
  });

  test("walks up to find component", () => {
    const parent = document.createElement("div");
    parent.setAttribute("data-solid-component", "App");
    const child = document.createElement("button");
    parent.appendChild(child);

    expect(findNearestComponent(child)).toBe("App");
  });

  test("returns null when no component found", () => {
    const el = document.createElement("div");
    expect(findNearestComponent(el)).toBeNull();
  });
});

describe("getComponentChain", () => {
  test("returns empty array for element with no components", () => {
    const el = document.createElement("div");
    expect(getComponentChain(el)).toEqual([]);
  });

  test("returns chain of components innermost first", () => {
    const outer = document.createElement("div");
    outer.setAttribute("data-solid-component", "App");
    outer.setAttribute("data-solid-source", "src/App.tsx:1:1");

    const inner = document.createElement("div");
    inner.setAttribute("data-solid-component", "Counter");
    inner.setAttribute("data-solid-source", "src/Counter.tsx:5:3");
    outer.appendChild(inner);

    const button = document.createElement("button");
    inner.appendChild(button);

    const chain = getComponentChain(button);
    expect(chain).toHaveLength(2);
    expect(chain[0]!.name).toBe("Counter");
    expect(chain[1]!.name).toBe("App");
  });

  test("deduplicates consecutive identical components", () => {
    const outer = document.createElement("div");
    outer.setAttribute("data-solid-component", "App");
    outer.setAttribute("data-solid-source", "src/App.tsx:1:1");

    const dup = document.createElement("div");
    dup.setAttribute("data-solid-component", "App");
    dup.setAttribute("data-solid-source", "src/App.tsx:1:1");
    outer.appendChild(dup);

    const child = document.createElement("span");
    dup.appendChild(child);

    const chain = getComponentChain(child);
    expect(chain).toHaveLength(1);
    expect(chain[0]!.name).toBe("App");
  });
});

describe("formatContext", () => {
  test("includes element summary and source", () => {
    const el = document.createElement("button");
    el.className = "btn primary";

    const formatted = formatContext({
      element: el,
      tagName: "button",
      elementSource: { file: "src/App.tsx", line: 10, column: 5 },
      components: [],
      timestamp: Date.now(),
    });

    expect(formatted).toContain("--- solid-grab context ---");
    expect(formatted).toContain("--- end solid-grab context ---");
    expect(formatted).toContain("Element: <button");
    expect(formatted).toContain("Source:  src/App.tsx:10:5");
  });

  test("includes component tree when present", () => {
    const el = document.createElement("div");

    const formatted = formatContext({
      element: el,
      tagName: "div",
      elementSource: null,
      components: [
        { name: "Counter", location: { file: "src/Counter.tsx", line: 5, column: 1 } },
        { name: "App", location: null },
      ],
      timestamp: Date.now(),
    });

    expect(formatted).toContain("Component tree");
    expect(formatted).toContain("<Counter />");
    expect(formatted).toContain("<App />");
  });
});

describe("inspect", () => {
  test("returns full GrabbedContext", () => {
    const el = document.createElement("div");
    el.setAttribute("data-solid-source", "src/Foo.tsx:3:1");

    const ctx = inspect(el);
    expect(ctx.element).toBe(el);
    expect(ctx.tagName).toBe("div");
    expect(ctx.elementSource).toEqual({ file: "src/Foo.tsx", line: 3, column: 1 });
    expect(ctx.formatted).toContain("--- solid-grab context ---");
    expect(ctx.timestamp).toBeGreaterThan(0);
  });

  test("works when element has no source attributes", () => {
    const el = document.createElement("span");
    const ctx = inspect(el);
    expect(ctx.elementSource).toBeNull();
    expect(ctx.components).toEqual([]);
    expect(ctx.formatted).toContain("Element: <span>");
  });
});
