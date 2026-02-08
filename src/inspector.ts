/**
 * inspector.ts
 *
 * Core logic for mapping a DOM element back to:
 *   1. Its JSX source location (via data-solid-source)
 *   2. Its component ancestry chain (via data-solid-component)
 *   3. A formatted context string suitable for AI agent prompts
 */

import {
  ATTR_SOURCE,
  ATTR_COMPONENT,
  type SourceLocation,
  type ComponentInfo,
  type GrabbedContext,
} from "./types.js";

// ── Source location parsing ──────────────────────────────────────────

/**
 * Parse a `data-solid-source` attribute value.
 * Format: "path/to/file.tsx:42:8"
 */
export function parseSourceAttr(value: string | null): SourceLocation | null {
  if (!value) return null;

  // Match "file:line:col" — file can contain colons on Windows (C:\...)
  // So we split from the right
  const parts = value.split(":");
  if (parts.length < 3) return null;

  const col = parseInt(parts.pop()!, 10);
  const line = parseInt(parts.pop()!, 10);
  const file = parts.join(":");

  if (isNaN(line) || isNaN(col)) return null;

  return { file, line, column: col };
}

// ── DOM walking ──────────────────────────────────────────────────────

/**
 * Find the nearest source location by walking up from a DOM element.
 */
export function findNearestSource(el: HTMLElement): SourceLocation | null {
  let current: HTMLElement | null = el;
  while (current) {
    const attr = current.getAttribute(ATTR_SOURCE);
    if (attr) return parseSourceAttr(attr);
    current = current.parentElement;
  }
  return null;
}

/**
 * Find the source location directly on this element (not walking up).
 */
export function getElementSource(el: HTMLElement): SourceLocation | null {
  return parseSourceAttr(el.getAttribute(ATTR_SOURCE));
}

/**
 * Find the nearest component name by walking up from a DOM element.
 */
export function findNearestComponent(el: HTMLElement): string | null {
  let current: HTMLElement | null = el;
  while (current) {
    const name = current.getAttribute(ATTR_COMPONENT);
    if (name) return name;
    current = current.parentElement;
  }
  return null;
}

/**
 * Collect the full component ancestry chain by walking up from an element.
 * Returns innermost component first.
 */
export function getComponentChain(el: HTMLElement): ComponentInfo[] {
  const chain: ComponentInfo[] = [];
  const seen = new Set<string>();
  let current: HTMLElement | null = el;

  while (current) {
    const name = current.getAttribute(ATTR_COMPONENT);
    if (name) {
      const source = getElementSource(current);
      // Deduplicate consecutive identical component names
      const key = `${name}:${source?.file}:${source?.line}`;
      if (!seen.has(key)) {
        seen.add(key);
        chain.push({ name, location: source });
      }
    }
    current = current.parentElement;
  }

  return chain;
}

// ── Context formatting ───────────────────────────────────────────────

/**
 * Get the trimmed outer HTML of an element, truncated to a max length.
 */
function getElementSnippet(el: HTMLElement, maxLen = 200): string {
  const html = el.outerHTML;
  if (html.length <= maxLen) return html;
  return html.slice(0, maxLen) + "...";
}

/**
 * Get key attributes of an element as a summary.
 */
function getElementSummary(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  const parts: string[] = [`<${tag}`];

  const id = el.id;
  if (id) parts.push(`id="${id}"`);

  const cls = el.className;
  if (cls && typeof cls === "string") {
    const trimmed = cls.trim();
    if (trimmed.length <= 80) {
      parts.push(`class="${trimmed}"`);
    } else {
      parts.push(`class="${trimmed.slice(0, 77)}..."`);
    }
  }

  // Include data-testid if present
  const testId = el.getAttribute("data-testid");
  if (testId) parts.push(`data-testid="${testId}"`);

  return parts.join(" ") + ">";
}

/**
 * Format the full grabbed context into a string for AI agent prompts.
 * Modeled after React Grab's output format.
 */
export function formatContext(ctx: Omit<GrabbedContext, "formatted">): string {
  const lines: string[] = [];

  lines.push("--- solid-grab context ---");
  lines.push("");

  // Element info
  lines.push(`Element: ${getElementSummary(ctx.element)}`);

  if (ctx.elementSource) {
    const s = ctx.elementSource;
    lines.push(`Source:  ${s.file}:${s.line}:${s.column}`);
  }

  // Component chain
  if (ctx.components.length > 0) {
    lines.push("");
    lines.push("Component tree (innermost → outermost):");
    for (const comp of ctx.components) {
      const loc = comp.location
        ? ` → ${comp.location.file}:${comp.location.line}:${comp.location.column}`
        : "";
      lines.push(`  <${comp.name} />${loc}`);
    }
  }

  // HTML snippet
  lines.push("");
  lines.push("HTML:");
  lines.push(getElementSnippet(ctx.element, 500));

  lines.push("");
  lines.push("--- end solid-grab context ---");

  return lines.join("\n");
}

// ── Full inspection ──────────────────────────────────────────────────

/**
 * Inspect a DOM element and produce the full GrabbedContext.
 */
export function inspect(el: HTMLElement): GrabbedContext {
  const elementSource = getElementSource(el) ?? findNearestSource(el);
  const components = getComponentChain(el);

  const partial = {
    element: el,
    tagName: el.tagName.toLowerCase(),
    elementSource,
    components,
    timestamp: Date.now(),
  };

  return {
    ...partial,
    formatted: formatContext(partial),
  };
}
