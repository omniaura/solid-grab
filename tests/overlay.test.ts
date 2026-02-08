import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Overlay } from "../src/overlay.js";

describe("Overlay", () => {
  let overlay: Overlay;

  beforeEach(() => {
    overlay = new Overlay();
  });

  afterEach(() => {
    overlay.unmount();
  });

  describe("mount/unmount", () => {
    test("mount adds elements to DOM", () => {
      overlay.mount();
      expect(document.querySelector(".solid-grab-overlay")).not.toBeNull();
      expect(document.querySelector(".solid-grab-tooltip")).not.toBeNull();
      expect(document.querySelector(".solid-grab-toast")).not.toBeNull();
      expect(document.querySelector(".solid-grab-badge")).not.toBeNull();
    });

    test("mount is idempotent", () => {
      overlay.mount();
      overlay.mount();
      const badges = document.querySelectorAll(".solid-grab-badge");
      expect(badges.length).toBe(1);
    });

    test("unmount removes elements from DOM", () => {
      overlay.mount();
      overlay.unmount();
      expect(document.querySelector(".solid-grab-overlay")).toBeNull();
      expect(document.querySelector(".solid-grab-badge")).toBeNull();
    });

    test("unmount is idempotent", () => {
      overlay.mount();
      overlay.unmount();
      overlay.unmount(); // should not throw
      expect(document.querySelector(".solid-grab-overlay")).toBeNull();
    });
  });

  describe("badge", () => {
    test("default badge text", () => {
      overlay.mount();
      const badge = document.querySelector(".solid-grab-badge");
      expect(badge?.textContent).toContain("solid-grab");
    });

    test("setBadge changes text", () => {
      overlay.mount();
      overlay.setBadge("test text");
      const badge = document.querySelector(".solid-grab-badge");
      expect(badge?.textContent).toBe("test text");
    });
  });

  describe("clearHighlight", () => {
    test("hides overlay and tooltip", () => {
      overlay.mount();

      // Trigger a highlight first
      const el = document.createElement("div");
      document.body.appendChild(el);
      overlay.highlight(el);

      // Now clear
      overlay.clearHighlight();

      const overlayEl = document.querySelector(".solid-grab-overlay") as HTMLElement;
      const tooltipEl = document.querySelector(".solid-grab-tooltip") as HTMLElement;
      expect(overlayEl.style.display).toBe("none");
      expect(tooltipEl.style.display).toBe("none");

      el.remove();
    });
  });

  describe("toast", () => {
    test("adds sg-visible class", () => {
      overlay.mount();
      overlay.toast("Test message", 5000);
      const toastEl = document.querySelector(".solid-grab-toast");
      expect(toastEl?.classList.contains("sg-visible")).toBe(true);
      expect(toastEl?.textContent).toBe("Test message");
    });
  });
});
