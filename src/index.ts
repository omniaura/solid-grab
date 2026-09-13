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
import type {
  SolidGrabOptions,
  GrabbedContext,
  SolidGrabStatus,
  SolidGrabStatusListener,
} from "./types.js";

export type {
  SolidGrabOptions,
  GrabbedContext,
  SourceLocation,
  ComponentInfo,
  SolidGrabStatus,
  SolidGrabStatusListener,
} from "./types.js";
export { inspect } from "./inspector.js";

// ── State ────────────────────────────────────────────────────────────

let initialized = false;
let autoInitCancelled = false;
let overlay: Overlay | null = null;
let bridge: AgentBridge | null = null;
let opts: Required<Omit<SolidGrabOptions, "onGrab" | "agentUrl">> & Pick<SolidGrabOptions, "onGrab" | "agentUrl"> = {
  key: "Alt",
  showToast: true,
  showBadge: true,
  onGrab: undefined,
  agentUrl: undefined,
};

let keyHeld = false;
let persistentPicking = false;
let hoveredEl: HTMLElement | null = null;
let pendingClickSuppression: {
  target: HTMLElement;
  releasedTarget?: HTMLElement;
  button: number;
  clearTimer: ReturnType<typeof setTimeout> | null;
} | null = null;
let badgeVisible = true;
let pendingBadgeVisible: boolean | null = null;
const subscribers = new Set<SolidGrabStatusListener>();
let lastStatusJson = "";

const SOLID_GRAB_OWN_ATTR = "data-solid-grab";
const SOLID_PULSE_OWN_ATTR = "data-solid-pulse";

function hasDOM(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function isPickingActive(): boolean {
  return keyHeld || persistentPicking;
}

function dispatchRuntimeEvent(type: "solid-grab:ready" | "solid-grab:destroy") {
  if (!hasDOM()) return;
  window.dispatchEvent(new CustomEvent(type, { detail: status() }));
}

function emitStatusIfChanged() {
  const snapshot = status();
  const json = JSON.stringify(snapshot);
  if (json === lastStatusJson) return;
  lastStatusJson = json;
  for (const listener of subscribers) {
    listener(snapshot);
  }
}

function updateCursor() {
  if (!hasDOM()) return;
  (document.body ?? document.documentElement).style.cursor = isPickingActive() ? "crosshair" : "";
}

function updateBadge() {
  if (!overlay) return;
  overlay.setBadge(isPickingActive() ? `⚡ solid-grab [${opts.key}]` : "⚡ solid-grab");
  overlay.setBadgeVisible(badgeVisible);
}

function clearCurrentHighlight() {
  overlay?.clearHighlight();
  hoveredEl = null;
}

function setKeyHeld(next: boolean) {
  if (keyHeld === next) return;
  keyHeld = next;
  if (!keyHeld && !persistentPicking) {
    clearCurrentHighlight();
  }
  updateBadge();
  updateCursor();
  emitStatusIfChanged();
}

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

function isPlainActivationKeyDown(e: KeyboardEvent): boolean {
  if (!isActivationKey(e)) return false;

  switch (opts.key) {
    case "Alt":
      return !e.ctrlKey && !e.metaKey && !e.shiftKey;
    case "Control":
      return !e.altKey && !e.metaKey && !e.shiftKey;
    case "Meta":
      return !e.altKey && !e.ctrlKey && !e.shiftKey;
    case "Shift":
      return !e.altKey && !e.ctrlKey && !e.metaKey;
    default:
      return false;
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (persistentPicking && e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    setPicking(false);
    return;
  }

  if (keyHeld && !isActivationKey(e)) {
    setKeyHeld(false);
    return;
  }

  if (!isPlainActivationKeyDown(e)) return;
  setKeyHeld(true);

  // If already hovering over something, highlight it
  if (hoveredEl) {
    highlightElement(hoveredEl);
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (!isActivationKey(e)) return;
  setKeyHeld(false);
}

// ── Mouse handling ───────────────────────────────────────────────────

function findClosestHTMLElement(target: EventTarget | null): HTMLElement | null {
  if (typeof Node === "undefined" || typeof HTMLElement === "undefined") return null;
  if (!(target instanceof Node)) return null;

  let current: Node | null = target;
  while (current) {
    if (current instanceof HTMLElement) return current;
    current = current.parentNode;
  }

  return null;
}

function findGrabbableTarget(target: EventTarget | null): HTMLElement | null {
  const el = findClosestHTMLElement(target);
  if (!el) return null;

  // Skip our own overlay elements and the Solid Pulse host panel/overlay tree.
  if (
    el.closest(`[${SOLID_GRAB_OWN_ATTR}]`) ||
    el.closest(`[${SOLID_PULSE_OWN_ATTR}]`) ||
    el.classList.contains("solid-grab-overlay") ||
    el.classList.contains("solid-grab-tooltip") ||
    el.classList.contains("solid-grab-toast") ||
    el.classList.contains("solid-grab-badge")
  ) {
    return null;
  }

  return el;
}

function clearPendingClickSuppression() {
  if (pendingClickSuppression?.clearTimer) {
    clearTimeout(pendingClickSuppression.clearTimer);
  }
  pendingClickSuppression = null;
}

function suppressClickForGesture(target: HTMLElement, e: MouseEvent) {
  clearPendingClickSuppression();
  pendingClickSuppression = {
    target,
    button: e.button,
    clearTimer: null,
  };
}

function clickMatchesSuppressedGesture(target: HTMLElement | null, e: MouseEvent): boolean {
  if (!target || !pendingClickSuppression) return false;
  const pending = pendingClickSuppression;
  if (e.button !== pending.button) return false;
  if (target === pending.target) return true;
  // A down/up on siblings dispatches click to their nearest common ancestor.
  // Only accept that retargeting after this gesture's mouseup, not an arbitrary
  // later click on an ancestor or unrelated control.
  if (!pending.releasedTarget) return false;
  let common: HTMLElement | null = pending.target;
  while (common && !common.contains(pending.releasedTarget)) common = common.parentElement;
  return target === common;
}

function clearSuppressionAfterCurrentClickTask(e: MouseEvent) {
  if (!pendingClickSuppression || pendingClickSuppression.button !== e.button) return;
  pendingClickSuppression.releasedTarget = findGrabbableTarget(e.target) ?? undefined;
  if (pendingClickSuppression.clearTimer) clearTimeout(pendingClickSuppression.clearTimer);
  pendingClickSuppression.clearTimer = setTimeout(() => {
    pendingClickSuppression = null;
  }, 0);
}

function highlightElement(el: HTMLElement) {
  if (!overlay) return;
  overlay.highlight(el);
  const source = findNearestSource(el);
  const component = findNearestComponent(el);
  overlay.showTooltip(el, source, component);
}

function onMouseMove(e: MouseEvent) {
  if (!isPickingActive()) return;

  const target = findGrabbableTarget(e.target);
  if (!target) {
    clearCurrentHighlight();
    return;
  }

  hoveredEl = target;
  highlightElement(target);
}

function grabElement(target: HTMLElement) {
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
    overlay?.toast("✓ Sent to agent", 1500);
  } else if (shouldCopy && opts.showToast) {
    overlay?.toast("✓ Copied to clipboard", 1500);
  }

  // Flash the overlay for visual feedback
  clearCurrentHighlight();
}

function onMouseDown(e: MouseEvent) {
  if (!isPickingActive()) return;

  const target = findGrabbableTarget(e.target);
  if (!target) return;

  // Prevent default behavior (text selection, link navigation, etc.)
  e.preventDefault();
  e.stopImmediatePropagation();
  suppressClickForGesture(target, e);

  grabElement(target);

  if (persistentPicking) {
    setPicking(false);
  }
}

function onMouseUp(e: MouseEvent) {
  clearSuppressionAfterCurrentClickTask(e);
}

function onPointerCancel() {
  clearPendingClickSuppression();
}

function onClick(e: MouseEvent) {
  const target = findGrabbableTarget(e.target);
  const matchesSuppressedGesture = clickMatchesSuppressedGesture(target, e);

  if (!target || (!isPickingActive() && !matchesSuppressedGesture)) {
    clearPendingClickSuppression();
    return;
  }

  // Block clicks on the underlying page while grabbing
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  clearPendingClickSuppression();
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
    setKeyHeld(false);
  }
  setPicking(false);
  clearPendingClickSuppression();
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Initialize solid-grab with options.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initSolidGrab(options: SolidGrabOptions = {}) {
  if (!hasDOM()) return;
  if (initialized) return;

  opts = {
    key: options.key ?? "Alt",
    showToast: options.showToast ?? true,
    showBadge: options.showBadge ?? pendingBadgeVisible ?? true,
    onGrab: options.onGrab,
    agentUrl: options.agentUrl,
  };
  badgeVisible = opts.showBadge;
  pendingBadgeVisible = null;
  initialized = true;

  // Create overlay
  overlay = new Overlay();

  bootstrap();
}

function bootstrap() {
  if (!overlay) return;
  overlay.mount();
  updateBadge();
  updateCursor();

  // Set up event listeners
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("mouseup", onMouseUp, true);
  document.addEventListener("pointercancel", onPointerCancel, true);
  document.addEventListener("dragstart", onPointerCancel, true);
  document.addEventListener("click", onClick, true);
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

  emitStatusIfChanged();
  dispatchRuntimeEvent("solid-grab:ready");
}

export function setBadgeVisible(visible: boolean) {
  if (!initialized) {
    pendingBadgeVisible = visible;
  }
  if (badgeVisible === visible) return;
  badgeVisible = visible;
  overlay?.setBadgeVisible(visible);
  emitStatusIfChanged();
}

export function setPicking(picking: boolean) {
  if (persistentPicking === picking) return;
  persistentPicking = picking;
  if (!persistentPicking && !keyHeld) {
    clearCurrentHighlight();
  }
  updateBadge();
  updateCursor();
  emitStatusIfChanged();
}

export function status(): SolidGrabStatus {
  return {
    initialized,
    picking: isPickingActive(),
    badgeVisible,
    key: opts.key,
  };
}

export function subscribe(listener: SolidGrabStatusListener): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

/**
 * Tear down solid-grab (for HMR / cleanup).
 */
export function destroySolidGrab() {
  autoInitCancelled = true;
  if (!initialized) return;
  initialized = false;
  keyHeld = false;
  persistentPicking = false;
  hoveredEl = null;
  clearPendingClickSuppression();
  pendingBadgeVisible = null;

  document.removeEventListener("keydown", onKeyDown, true);
  document.removeEventListener("keyup", onKeyUp, true);
  document.removeEventListener("mousemove", onMouseMove, true);
  document.removeEventListener("mousedown", onMouseDown, true);
  document.removeEventListener("mouseup", onMouseUp, true);
  document.removeEventListener("pointercancel", onPointerCancel, true);
  document.removeEventListener("dragstart", onPointerCancel, true);
  document.removeEventListener("click", onClick, true);
  window.removeEventListener("blur", onBlur);

  overlay?.unmount();
  overlay = null;
  bridge?.disconnect();
  bridge = null;
  (document.body ?? document.documentElement).style.cursor = "";
  emitStatusIfChanged();
  dispatchRuntimeEvent("solid-grab:destroy");
}

// ── Auto-init on import ──────────────────────────────────────────────
// Deferred to a microtask so that named importers can call
// initSolidGrab({ key: ... }) synchronously before the default init.
// This lets the Vite plugin pass options through the virtual module.

if (hasDOM()) {
  queueMicrotask(() => {
    if (!initialized && !autoInitCancelled) initSolidGrab();
  });
}

// ── Expose global API for extensibility (like React Grab) ────────────

declare global {
  interface Window {
    __SOLID_GRAB__: {
      init: typeof initSolidGrab;
      destroy: typeof destroySolidGrab;
      inspect: typeof inspect;
      setBadgeVisible: typeof setBadgeVisible;
      setPicking: typeof setPicking;
      status: typeof status;
      subscribe: typeof subscribe;
    };
  }
}

if (hasDOM()) {
  window.__SOLID_GRAB__ = {
    init: initSolidGrab,
    destroy: destroySolidGrab,
    inspect,
    setBadgeVisible,
    setPicking,
    status,
    subscribe,
  };
}
