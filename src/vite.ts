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

import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import type { SolidGrabPluginOptions } from "./types.js";

const VIRTUAL_INIT = "virtual:solid-grab-init";
const RESOLVED_VIRTUAL_INIT = "\0" + VIRTUAL_INIT;

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
 * Candidate regex for JSX opening tags. The negative lookbehind (?<!\w)
 * filters TypeScript generics (where `<` directly follows an identifier).
 * Comparison operators (where `<` is preceded by whitespace) are filtered
 * by the isLikelyJsx() context check in the match loop.
 */
const JSX_OPEN_TAG_RE =
  /(?<!\w)(<\s*)([A-Z_a-z][\w.:-]*)(\s|\/?>)/g;

/** Matches component-style names: PascalCase or contains a dot (Foo.Bar). */
const COMPONENT_NAME_RE = /^[A-Z]|[.]/;

/** Keywords that can directly precede a JSX expression. */
const JSX_PRECEDING_KEYWORDS = new Set([
  "return", "yield", "case", "default", "else",
]);

/**
 * Builds a mask over `code` marking every character that lives inside a
 * string literal, template-literal text, or comment — positions where a `<`
 * can never start a JSX tag. Template-literal interpolations (`${ ... }`) are
 * treated as code so JSX inside them is still detected.
 *
 * Without this, the scanner mangles angle-bracket text that merely appears
 * inside a string. For example a CLI placeholder like
 *
 *   `gh secret set ... --repo ${shq(repo() || "<owner>/<repo>")} ...`
 *
 * matches the JSX regex at `<repo>`; isLikelyJsx() then sees the preceding `/`
 * (an "operator") and injects `data-solid-source="..."` straight into the
 * string, whose embedded `"` breaks the literal and crashes the Babel parse.
 *
 * Note: regular-expression literals are not tracked (the regex-vs-division
 * ambiguity needs a real tokenizer). A `<tag>` inside a regex literal remains
 * a known edge case, but those are far rarer than strings and comments.
 */
function buildLiteralMask(code: string): Uint8Array {
  const n = code.length;
  const mask = new Uint8Array(n);

  // Scanner modes. We keep a stack so a `${ }` interpolation can nest a fresh
  // "code" region (and another template, string, etc.) inside a template.
  type Mode = "code" | "sq" | "dq" | "tpl" | "line" | "block";
  const stack: Mode[] = ["code"];

  // Brace depth within code regions, plus the depth recorded when each `${`
  // opened, so we know which `}` closes the interpolation.
  let braceDepth = 0;
  const interpDepths: number[] = [];

  let i = 0;
  while (i < n) {
    const mode = stack[stack.length - 1]!;
    const c = code[i]!;
    const d = i + 1 < n ? code[i + 1]! : "";

    switch (mode) {
      case "code":
        if (c === "/" && d === "/") { stack.push("line"); mask[i] = mask[i + 1] = 1; i += 2; }
        else if (c === "/" && d === "*") { stack.push("block"); mask[i] = mask[i + 1] = 1; i += 2; }
        else if (c === "'") { stack.push("sq"); mask[i] = 1; i++; }
        else if (c === '"') { stack.push("dq"); mask[i] = 1; i++; }
        else if (c === "`") { stack.push("tpl"); mask[i] = 1; i++; }
        else if (c === "{") { braceDepth++; i++; }
        else if (c === "}") {
          braceDepth--;
          // Closing brace of a `${ }` → resume the enclosing template literal.
          if (interpDepths.length && interpDepths[interpDepths.length - 1] === braceDepth) {
            interpDepths.pop();
            stack.pop();
          }
          i++;
        } else i++;
        break;

      case "line":
        if (c === "\n") { stack.pop(); i++; } // newline is code
        else { mask[i] = 1; i++; }
        break;

      case "block":
        if (c === "*" && d === "/") { mask[i] = mask[i + 1] = 1; stack.pop(); i += 2; }
        else { mask[i] = 1; i++; }
        break;

      case "sq":
      case "dq": {
        if (c === "\\") { mask[i] = 1; if (i + 1 < n) mask[i + 1] = 1; i += 2; break; }
        mask[i] = 1;
        if (c === (mode === "sq" ? "'" : '"') || c === "\n") stack.pop();
        i++;
        break;
      }

      case "tpl":
        if (c === "\\") { mask[i] = 1; if (i + 1 < n) mask[i + 1] = 1; i += 2; }
        else if (c === "`") { mask[i] = 1; stack.pop(); i++; }
        else if (c === "$" && d === "{") {
          // Enter an interpolation: its contents are code, not template text.
          mask[i] = mask[i + 1] = 1;
          interpDepths.push(braceDepth);
          braceDepth++;
          stack.push("code");
          i += 2;
        } else { mask[i] = 1; i++; }
        break;
    }
  }

  return mask;
}

/**
 * Walks backwards from `<` (skipping whitespace) to determine whether
 * it's a JSX opening tag or a less-than comparison.
 *
 *   - After `)`, `]`, quotes  → comparison (end of expression)
 *   - After `(`, `{`, `=`, etc. → JSX (start of expression)
 *   - After a keyword like `return` → JSX
 *   - After any other identifier → comparison
 */
function isLikelyJsx(code: string, ltIndex: number): boolean {
  let i = ltIndex - 1;
  while (i >= 0 && (code[i] === " " || code[i] === "\t" || code[i] === "\n" || code[i] === "\r")) {
    i--;
  }

  if (i < 0) return true; // Start of file

  const ch = code[i]!;

  // Expression-ending tokens → comparison
  if (ch === ")" || ch === "]" || ch === '"' || ch === "'" || ch === "`") {
    return false;
  }

  // Operators/punctuation that introduce an expression → JSX
  if ("({[,;:?=!>&|+-*/%^~".includes(ch)) {
    return true;
  }

  // Word character → JSX only if it's a keyword like `return`
  if (/\w/.test(ch)) {
    const end = i + 1;
    while (i >= 0 && /\w/.test(code[i]!)) i--;
    const word = code.slice(i + 1, end);
    return JSX_PRECEDING_KEYWORDS.has(word);
  }

  return true; // Conservative default
}

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

  // Mark characters that live inside strings, templates, or comments so the
  // scanner never injects attributes into angle-bracket text that isn't JSX.
  const literalMask = buildLiteralMask(code);

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

    // Skip `<` that sits inside a string literal, template text, or comment.
    if (literalMask[offset]) {
      continue;
    }

    // Skip comparisons like `x < y` — only inject into actual JSX
    if (!isLikelyJsx(code, offset)) {
      continue;
    }

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
    key = "Alt",
  } = options;

  let projectRoot = "";

  return {
    name: "solid-grab",
    enforce: "pre", // Run before vite-plugin-solid
    apply: "serve", // Only active during dev — completely skipped in production builds

    configResolved(config: ResolvedConfig) {
      projectRoot = config.root;
    },

    // Virtual module that imports the runtime — resolved by Vite's pipeline
    resolveId(id) {
      if (id === VIRTUAL_INIT) return RESOLVED_VIRTUAL_INIT;
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_INIT) {
        return `import { initSolidGrab } from "solid-grab";\ninitSolidGrab({ key: "${key}" });`;
      }
    },

    transform(code, id) {
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

    // Serve the virtual init module through Vite's transform pipeline
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, _res, next) => {
        // Rewrite the URL so Vite's built-in module serving handles it
        if (req.url === "/@solid-grab/init") {
          req.url = `/@id/${VIRTUAL_INIT}`;
        }
        next();
      });
    },

    // Inject a <script src> that Vite's dev server will resolve
    transformIndexHtml() {
      if (!autoImport) return;
      return [
        {
          tag: "script",
          attrs: { type: "module", src: "/@solid-grab/init" },
          injectTo: "head" as const,
        },
      ];
    },
  };
}
