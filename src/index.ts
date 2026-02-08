/**
 * solid-grab
 *
 * Runtime entry point. Import this in dev mode to activate the grab overlay.
 *
 * Usage (auto-imported by the Vite plugin, or manually):
 *
 *   if (import.meta.env.DEV) {
 *     import("solid-grab");
 *   }
 *
 * Or with options:
 *
 *   import { initSolidGrab } from "solid-grab";
 *   initSolidGrab({ key: "Alt", agentUrl: "ws://localhost:4567" });
 */

import { Overlay } from "./overlay.js";
import { inspect, findNearestSource, findNearestComponent } from "./inspector.js";
import { AgentBridge } from "./agent-bridge.js";
import { ATTR_SOURCE } from "./types.js";
import type { SolidGrabOptions, GrabbedContext } from "./types.js";

export type { SolidGrabOptions, GrabbedContext, SourceLocation, ComponentInfo } from "./types.js";
export { inspect } from "./inspector.js";

// ── State ────────────────────────────────────────────────────────────

let initialized = false;
let overlay: Overlay;
let bridge: AgentBridge | null = null;
let opts: Required<Omit<SolidGrabOptions, "onGrab" | "agentUrl">> & Pick<SolidGrabOptions, "onGrab" | "agentUrl">;

let keyHeld = false;
let hoveredEl: HTMLElement | null = null;

// ── Key handling ─────────────────────────────────────────────────────

function isActivationKey(e: KeyboardEvent): boolean {
  switch (opts.key) {
    case "Alt": return e.key === "Alt";
    case "Control": return e.key === "Control";
    case "Meta": return e.key === "Meta";
    case "Shift": return e.key === "Shift";
    default: return e.key === "Alt";
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (!isActivationKey(e)) return;
  keyHeld = true;
  overlay.setBadge(`⚡ solid-grab [${opts.key}]`);
  document.body.style.cursor = "crosshair";

  // If already hovering over something, highlight it
  if (hoveredEl) {
    highlightElement(hoveredEl);
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (!isActivationKey(e)) return;
  keyHeld = false;
  overlay.setBadge("⚡ solid-grab");
  overlay.clearHighlight();
  document.body.style.cursor = "";
  hoveredEl = null;
}

// ── Mouse handling ───────────────────────────────────────────────────

function findGrabbableTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;

  // Skip our own overlay elements
  if (
    target.classList.contains("solid-grab-overlay") ||
    target.classList.contains("solid-grab-tooltip") ||
    target.classList.contains("solid-grab-toast") ||
    target.classList.contains("solid-grab-badge")
  ) {
    return null;
  }

  return target;
}

function highlightElement(el: HTMLElement) {
  overlay.highlight(el);
  const source = findNearestSource(el);
  const component = findNearestComponent(el);
  overlay.showTooltip(el, source, component);
}

function onMouseMove(e: MouseEvent) {
  if (!keyHeld) return;

  const target = findGrabbableTarget(e.target);
  if (!target) return;

  hoveredEl = target;
  highlightElement(target);
}

function onMouseDown(e: MouseEvent) {
  if (!keyHeld) return;

  const target = findGrabbableTarget(e.target);
  if (!target) return;

  // Prevent default behavior (text selection, link navigation, etc.)
  e.preventDefault();
  e.stopPropagation();

  // Inspect the element
  const context = inspect(target);

  // Fire callback
  const shouldCopy = opts.onGrab?.(context) !== false;

  // Copy to clipboard
  if (shouldCopy) {
    copyToClipboard(context.formatted);
  }

  // Send to agent bridge
  if (bridge?.connected) {
    bridge.send(context);
    overlay.toast("✓ Sent to agent", 1500);
  } else if (shouldCopy && opts.showToast) {
    overlay.toast("✓ Copied to clipboard", 1500);
  }

  // Flash the overlay for visual feedback
  overlay.clearHighlight();
}

// ── Clipboard ────────────────────────────────────────────────────────

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for non-HTTPS or restricted contexts
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

// ── Blur handling (key release when window loses focus) ──────────────

function onBlur() {
  if (keyHeld) {
    keyHeld = false;
    overlay.clearHighlight();
    document.body.style.cursor = "";
    hoveredEl = null;
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Initialize solid-grab with options.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initSolidGrab(options: SolidGrabOptions = {}) {
  if (initialized) return;
  initialized = true;

  opts = {
    key: options.key ?? "Alt",
    showToast: options.showToast ?? true,
    onGrab: options.onGrab,
    agentUrl: options.agentUrl,
  };

  // Create overlay
  overlay = new Overlay();

  // Wait for DOM to be ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
}

function bootstrap() {
  overlay.mount();

  // Set up event listeners
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("mousedown", onMouseDown, true);
  window.addEventListener("blur", onBlur);

  // Connect agent bridge if URL provided
  if (opts.agentUrl) {
    bridge = new AgentBridge(opts.agentUrl);
    bridge.connect();
  }

  console.log(
    `%c⚡ solid-grab%c Hold ${opts.key} + click to grab element context`,
    "color: #7dd3fc; font-weight: bold",
    "color: inherit"
  );
}

/**
 * Tear down solid-grab (for HMR / cleanup).
 */
export function destroySolidGrab() {
  if (!initialized) return;
  initialized = false;

  document.removeEventListener("keydown", onKeyDown, true);
  document.removeEventListener("keyup", onKeyUp, true);
  document.removeEventListener("mousemove", onMouseMove, true);
  document.removeEventListener("mousedown", onMouseDown, true);
  window.removeEventListener("blur", onBlur);

  overlay.unmount();
  bridge?.disconnect();
  bridge = null;
  document.body.style.cursor = "";
}

// ── Auto-init on import ──────────────────────────────────────────────
// When imported as a side-effect (`import "solid-grab"`), auto-initialize
// with defaults. Users who want custom options should use initSolidGrab().

initSolidGrab();

// ── Expose global API for extensibility (like React Grab) ────────────

declare global {
  interface Window {
    __SOLID_GRAB__: {
      init: typeof initSolidGrab;
      destroy: typeof destroySolidGrab;
      inspect: typeof inspect;
    };
  }
}

if (typeof window !== "undefined") {
  window.__SOLID_GRAB__ = {
    init: initSolidGrab,
    destroy: destroySolidGrab,
    inspect,
  };
}
