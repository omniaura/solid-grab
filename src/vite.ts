/**
 * solid-grab/vite
 *
 * A Vite plugin that injects source-location data attributes into Solid JSX
 * so the runtime overlay can map DOM elements back to source code.
 *
 * Must be placed BEFORE vite-plugin-solid in the plugins array so it runs
 * on the raw JSX before Solid's compiler transforms it away.
 *
 * Usage:
 *   // vite.config.ts
 *   import { defineConfig } from "vite";
 *   import solid from "vite-plugin-solid";
 *   import solidGrab from "solid-grab/vite";
 *
 *   export default defineConfig({
 *     plugins: [solidGrab(), solid()],
 *   });
 */

import type { Plugin, ResolvedConfig } from "vite";
import type { SolidGrabPluginOptions } from "./types.js";

// ── Regex-based JSX transform ────────────────────────────────────────
//
// We intentionally avoid a full AST parse here for speed. Solid JSX is
// well-structured enough that a regex approach works reliably for the
// purpose of injecting data attributes onto opening tags.
//
// The regex matches: `<TagName` at the start of a JSX element (but not
// closing tags `</`, fragments `<>`, or self-referential generics).
// We inject `data-solid-source="file:line:col"` right after the tag name.

/**
 * Matches the opening of a JSX element:
 *   <div  |  <MyComponent  |  <ns:tag
 * Does NOT match:
 *   </div  |  <>  |  </ |  <=  |  <<
 *   Accessor<boolean>  |  createContext<Type>  (TypeScript generics)
 *
 * The negative lookbehind (?<!\w) ensures the `<` is not preceded by a
 * word character, which distinguishes JSX tags from TypeScript generics.
 *
 * Capture group 1 = everything before we inject the attribute
 * We track line numbers ourselves for accuracy.
 */
const JSX_OPEN_TAG_RE =
  /(?<!\w)(<\s*)([A-Z_a-z][\w.:-]*)(\s|\/?>)/g;

/**
 * Matches component-style names: PascalCase or contains a dot (Foo.Bar).
 */
const COMPONENT_NAME_RE = /^[A-Z]|[.]/;

function transformJsx(
  code: string,
  fileId: string,
  opts: Required<Pick<SolidGrabPluginOptions, "jsxLocation" | "componentLocation">>
): string {
  // Pre-compute line start offsets for fast line/column lookup
  const lineStarts: number[] = [0];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "\n") lineStarts.push(i + 1);
  }

  function getLineCol(offset: number): [number, number] {
    // Binary search for the line
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return [lo + 1, offset - lineStarts[lo]! + 1];
  }

  // Strip the project root prefix to keep paths short
  const shortFile = fileId.replace(/^\//, "");

  let result = "";
  let lastIndex = 0;

  // Reset the regex
  JSX_OPEN_TAG_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = JSX_OPEN_TAG_RE.exec(code)) !== null) {
    const fullMatch = match[0]!;
    const prefix = match[1]!; // `<` or `< `
    const tagName = match[2]!;
    const suffix = match[3]!; // space, `/>`, or `>`

    const offset = match.index;
    const [line, col] = getLineCol(offset);

    const isComponent = COMPONENT_NAME_RE.test(tagName);

    // Build the attributes to inject
    const attrs: string[] = [];

    if (opts.jsxLocation) {
      attrs.push(`data-solid-source="${shortFile}:${line}:${col}"`);
    }

    if (opts.componentLocation && isComponent) {
      attrs.push(`data-solid-component="${tagName}"`);
    }

    if (attrs.length === 0) {
      // Nothing to inject — copy as-is
      result += code.slice(lastIndex, match.index + fullMatch.length);
      lastIndex = match.index + fullMatch.length;
      continue;
    }

    const attrStr = " " + attrs.join(" ");

    // Inject attributes: <Tag ATTRS ...rest>
    result += code.slice(lastIndex, match.index);
    result += prefix + tagName + attrStr + suffix;
    lastIndex = match.index + fullMatch.length;
  }

  result += code.slice(lastIndex);
  return result;
}

// ── The plugin ───────────────────────────────────────────────────────

export default function solidGrab(
  options: SolidGrabPluginOptions = {}
): Plugin {
  const {
    jsxLocation = true,
    componentLocation = true,
    autoImport = true,
  } = options;

  let projectRoot = "";
  let isDev = false;

  return {
    name: "solid-grab",
    enforce: "pre", // Run before vite-plugin-solid

    configResolved(config: ResolvedConfig) {
      projectRoot = config.root;
      isDev = config.command === "serve" || config.mode === "development";
    },

    transform(code, id) {
      // Only transform in dev mode
      if (!isDev) return null;

      // Only transform JSX/TSX files in the user's project
      if (!/\.[jt]sx$/.test(id)) return null;
      if (id.includes("node_modules")) return null;

      // Make the path relative to project root
      const relativePath = id.startsWith(projectRoot)
        ? id.slice(projectRoot.length + 1)
        : id;

      const transformed = transformJsx(code, relativePath, {
        jsxLocation,
        componentLocation,
      });

      if (transformed === code) return null;

      return {
        code: transformed,
        map: null, // TODO: proper source map support
      };
    },

    // Auto-inject the runtime script in dev mode
    transformIndexHtml(html) {
      if (!autoImport) return html;
      if (!isDev) return html;

      // Inject a module script that imports solid-grab
      const script = `<script type="module">
  import("solid-grab").catch(() => {});
</script>`;

      return html.replace("</head>", `${script}\n</head>`);
    },
  };
}
