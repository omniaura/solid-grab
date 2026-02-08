/**
 * overlay.ts
 *
 * Renders the hover-highlight overlay, tooltip, and selection UI.
 * All DOM is created outside Solid's reactive tree (raw DOM manipulation)
 * to avoid interfering with the app being inspected.
 */

import type { SourceLocation } from "./types.js";

// ── Styles ───────────────────────────────────────────────────────────

const OVERLAY_STYLES = `
  .solid-grab-overlay {
    position: fixed;
    pointer-events: none;
    z-index: 2147483647;
    border: 2px solid #4f8cf7;
    background: rgba(79, 140, 247, 0.08);
    border-radius: 3px;
    transition: all 0.08s ease-out;
  }

  .solid-grab-tooltip {
    position: fixed;
    z-index: 2147483647;
    pointer-events: none;
    background: #1a1a2e;
    color: #e0e0e0;
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 12px;
    line-height: 1.4;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid rgba(79, 140, 247, 0.4);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    max-width: 480px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .solid-grab-tooltip .sg-component {
    color: #7dd3fc;
    font-weight: 600;
  }

  .solid-grab-tooltip .sg-file {
    color: #a5b4fc;
    opacity: 0.85;
  }

  .solid-grab-tooltip .sg-tag {
    color: #86efac;
  }

  .solid-grab-toast {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%) translateY(0);
    z-index: 2147483647;
    background: #1a1a2e;
    color: #e0e0e0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 13px;
    padding: 10px 18px;
    border-radius: 8px;
    border: 1px solid rgba(79, 140, 247, 0.3);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    opacity: 0;
    transition: opacity 0.2s, transform 0.2s;
    pointer-events: none;
  }

  .solid-grab-toast.sg-visible {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }

  .solid-grab-badge {
    position: fixed;
    bottom: 12px;
    right: 12px;
    z-index: 2147483646;
    background: #1a1a2e;
    color: #7dd3fc;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid rgba(79, 140, 247, 0.25);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    cursor: default;
    user-select: none;
    opacity: 0.7;
    transition: opacity 0.15s;
  }

  .solid-grab-badge:hover { opacity: 1; }
`;

// ── Overlay class ────────────────────────────────────────────────────

export class Overlay {
  private styleEl: HTMLStyleElement;
  private overlayEl: HTMLDivElement;
  private tooltipEl: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private badgeEl: HTMLDivElement;
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;
  private _mounted = false;

  constructor() {
    // Create all elements
    this.styleEl = document.createElement("style");
    this.styleEl.textContent = OVERLAY_STYLES;

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "solid-grab-overlay";
    this.overlayEl.style.display = "none";

    this.tooltipEl = document.createElement("div");
    this.tooltipEl.className = "solid-grab-tooltip";
    this.tooltipEl.style.display = "none";

    this.toastEl = document.createElement("div");
    this.toastEl.className = "solid-grab-toast";

    this.badgeEl = document.createElement("div");
    this.badgeEl.className = "solid-grab-badge";
    this.badgeEl.textContent = "⚡ solid-grab";
  }

  mount() {
    if (this._mounted) return;
    this._mounted = true;

    document.head.appendChild(this.styleEl);
    document.body.appendChild(this.overlayEl);
    document.body.appendChild(this.tooltipEl);
    document.body.appendChild(this.toastEl);
    document.body.appendChild(this.badgeEl);
  }

  unmount() {
    if (!this._mounted) return;
    this._mounted = false;

    this.styleEl.remove();
    this.overlayEl.remove();
    this.tooltipEl.remove();
    this.toastEl.remove();
    this.badgeEl.remove();
  }

  /** Position the overlay highlight over a target element */
  highlight(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const s = this.overlayEl.style;
    s.display = "block";
    s.top = rect.top + "px";
    s.left = rect.left + "px";
    s.width = rect.width + "px";
    s.height = rect.height + "px";
  }

  /** Hide the overlay highlight */
  clearHighlight() {
    this.overlayEl.style.display = "none";
    this.tooltipEl.style.display = "none";
  }

  /** Show the tooltip near the highlighted element */
  showTooltip(el: HTMLElement, source: SourceLocation | null, componentName: string | null) {
    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();

    let html = `<span class="sg-tag">&lt;${tag}&gt;</span>`;
    if (componentName) {
      html = `<span class="sg-component">&lt;${componentName} /&gt;</span> → ${html}`;
    }
    if (source) {
      html += ` <span class="sg-file">${source.file}:${source.line}</span>`;
    }

    this.tooltipEl.innerHTML = html;
    this.tooltipEl.style.display = "block";

    // Position: above the element, or below if not enough space
    const tooltipHeight = 32;
    const gap = 8;
    let top = rect.top - tooltipHeight - gap;
    if (top < 4) top = rect.bottom + gap;

    let left = rect.left;
    // Keep within viewport
    const tooltipWidth = this.tooltipEl.offsetWidth;
    if (left + tooltipWidth > window.innerWidth - 8) {
      left = window.innerWidth - tooltipWidth - 8;
    }
    if (left < 4) left = 4;

    this.tooltipEl.style.top = top + "px";
    this.tooltipEl.style.left = left + "px";
  }

  /** Flash a toast notification */
  toast(message: string, duration = 2000) {
    if (this.toastTimeout) clearTimeout(this.toastTimeout);

    this.toastEl.textContent = message;
    this.toastEl.classList.add("sg-visible");

    this.toastTimeout = setTimeout(() => {
      this.toastEl.classList.remove("sg-visible");
      this.toastTimeout = null;
    }, duration);
  }

  /** Update badge text */
  setBadge(text: string) {
    this.badgeEl.textContent = text;
  }
}
