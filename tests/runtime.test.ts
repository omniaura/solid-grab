import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  destroySolidGrab,
  initSolidGrab,
  setBadgeVisible,
  setPicking,
  status,
  subscribe,
} from "../src/index.js";

async function resetRuntime() {
  await Promise.resolve();
  destroySolidGrab();
  document.body.innerHTML = "";
}

function dispatch(target: EventTarget, event: Event) {
  return target.dispatchEvent(event);
}

describe("runtime API", () => {
  beforeEach(async () => {
    await resetRuntime();
  });

  afterEach(() => {
    destroySolidGrab();
    document.body.innerHTML = "";
  });

  test("exposes lifecycle-safe named and global API", () => {
    expect(window.__SOLID_GRAB__).toBeDefined();
    expect(window.__SOLID_GRAB__.init).toBe(initSolidGrab);
    expect(window.__SOLID_GRAB__.destroy).toBe(destroySolidGrab);
    expect(window.__SOLID_GRAB__.setBadgeVisible).toBe(setBadgeVisible);
    expect(window.__SOLID_GRAB__.setPicking).toBe(setPicking);
    expect(window.__SOLID_GRAB__.status).toBe(status);
    expect(window.__SOLID_GRAB__.subscribe).toBe(subscribe);
    expect(typeof window.__SOLID_GRAB__.inspect).toBe("function");
  });

  test("dispatches ready and destroy events with serializable status", () => {
    const ready: unknown[] = [];
    const destroyed: unknown[] = [];
    window.addEventListener("solid-grab:ready", (event) => {
      ready.push((event as CustomEvent).detail);
    });
    window.addEventListener("solid-grab:destroy", (event) => {
      destroyed.push((event as CustomEvent).detail);
    });

    initSolidGrab({ key: "Meta", showBadge: false });

    expect(ready).toEqual([
      { initialized: true, picking: false, badgeVisible: false, key: "Meta" },
    ]);
    expect(JSON.parse(JSON.stringify(status()))).toEqual(status());

    destroySolidGrab();

    expect(destroyed).toEqual([
      { initialized: false, picking: false, badgeVisible: false, key: "Meta" },
    ]);
  });

  test("notifies subscribers for observable state changes", () => {
    const seen: ReturnType<typeof status>[] = [];
    const unsubscribe = subscribe((next) => {
      seen.push(next);
    });

    initSolidGrab({ showBadge: true });
    setBadgeVisible(false);
    setPicking(true);
    unsubscribe();
    setPicking(false);

    expect(seen).toContainEqual({
      initialized: true,
      picking: false,
      badgeVisible: true,
      key: "Alt",
    });
    expect(seen).toContainEqual({
      initialized: true,
      picking: false,
      badgeVisible: false,
      key: "Alt",
    });
    expect(seen).toContainEqual({
      initialized: true,
      picking: true,
      badgeVisible: false,
      key: "Alt",
    });
    expect(seen.at(-1)?.picking).toBe(true);
  });

  test("setBadgeVisible hides and restores the standalone badge", () => {
    initSolidGrab();
    const badge = document.querySelector(".solid-grab-badge") as HTMLElement;

    expect(status().badgeVisible).toBe(true);
    expect(badge.style.display).toBe("");

    setBadgeVisible(false);
    expect(status().badgeVisible).toBe(false);
    expect(badge.style.display).toBe("none");

    setBadgeVisible(true);
    expect(status().badgeVisible).toBe(true);
    expect(badge.style.display).toBe("");
  });

  test("pre-init badge visibility applies only to the next bootstrap", () => {
    setBadgeVisible(false);
    initSolidGrab();

    expect(status().badgeVisible).toBe(false);
    expect((document.querySelector(".solid-grab-badge") as HTMLElement).style.display).toBe("none");

    destroySolidGrab();
    initSolidGrab();

    expect(status().badgeVisible).toBe(true);
    expect((document.querySelector(".solid-grab-badge") as HTMLElement).style.display).toBe("");
  });

  test("persistent picking grabs once, copies context, and suppresses link navigation", () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(text: string) {
          copied.push(text);
          return Promise.resolve();
        },
      },
    });

    const grabbed: string[] = [];
    initSolidGrab({
      showToast: false,
      onGrab(context) {
        grabbed.push(context.tagName);
      },
    });

    const link = document.createElement("a");
    link.href = "https://example.com/";
    link.textContent = "Example";
    link.setAttribute("data-solid-source", "src/App.tsx:12:5");
    let bubbledClick = false;
    link.addEventListener("click", () => {
      bubbledClick = true;
    });
    document.body.appendChild(link);

    setPicking(true);
    expect(status().picking).toBe(true);

    dispatch(link, new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    const clickResult = dispatch(link, new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(grabbed).toEqual(["a"]);
    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain("Source:  src/App.tsx:12:5");
    expect(status().picking).toBe(false);
    expect(clickResult).toBe(false);
    expect(bubbledClick).toBe(false);
  });

  test("persistent picking resolves SVG descendants to the nearest grabbable HTML element", () => {
    const grabbed: string[] = [];
    initSolidGrab({
      showToast: false,
      onGrab(context) {
        grabbed.push(context.tagName);
        return false;
      },
    });

    const link = document.createElement("a");
    link.href = "https://example.com/svg";
    link.setAttribute("data-solid-source", "src/IconLink.tsx:7:3");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(path);
    link.appendChild(svg);
    document.body.appendChild(link);

    let clicked = false;
    link.addEventListener("click", () => {
      clicked = true;
    });

    setPicking(true);
    dispatch(path, new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    const clickResult = dispatch(path, new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(grabbed).toEqual(["a"]);
    expect(status().picking).toBe(false);
    expect(clickResult).toBe(false);
    expect(clicked).toBe(false);
  });

  test("grabbed mousedown stops later document capture listeners", () => {
    const grabbed: string[] = [];
    initSolidGrab({
      showToast: false,
      onGrab(context) {
        grabbed.push(context.tagName);
        return false;
      },
    });

    const button = document.createElement("button");
    button.textContent = "Grab me";
    document.body.appendChild(button);

    let lateDocumentCaptureSeen = false;
    const lateDocumentCaptureListener = () => {
      lateDocumentCaptureSeen = true;
    };
    document.addEventListener("mousedown", lateDocumentCaptureListener, true);

    setPicking(true);
    const result = dispatch(button, new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    document.removeEventListener("mousedown", lateDocumentCaptureListener, true);

    expect(result).toBe(false);
    expect(grabbed).toEqual(["button"]);
    expect(lateDocumentCaptureSeen).toBe(false);
  });

  test("missing click after grabbed mousedown does not suppress an unrelated later click", () => {
    const grabbed: string[] = [];
    initSolidGrab({
      showToast: false,
      onGrab(context) {
        grabbed.push(context.tagName);
        return false;
      },
    });

    const grabbedButton = document.createElement("button");
    grabbedButton.textContent = "Grab me";
    document.body.appendChild(grabbedButton);

    const unrelatedButton = document.createElement("button");
    unrelatedButton.textContent = "Click me";
    document.body.appendChild(unrelatedButton);

    let unrelatedClicked = false;
    unrelatedButton.addEventListener("click", () => {
      unrelatedClicked = true;
    });

    setPicking(true);
    dispatch(grabbedButton, new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    const clickResult = dispatch(unrelatedButton, new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(grabbed).toEqual(["button"]);
    expect(status().picking).toBe(false);
    expect(clickResult).toBe(true);
    expect(unrelatedClicked).toBe(true);
  });

  test("Escape cancels persistent picking", () => {
    initSolidGrab();
    setPicking(true);

    const result = dispatch(
      document,
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    );

    expect(result).toBe(false);
    expect(status().picking).toBe(false);
  });

  test("legacy hold-key behavior still grabs while Alt is held", () => {
    const grabbed: string[] = [];
    initSolidGrab({
      showToast: false,
      onGrab(context) {
        grabbed.push(context.tagName);
        return false;
      },
    });

    const button = document.createElement("button");
    button.textContent = "Grab me";
    document.body.appendChild(button);

    dispatch(document, new KeyboardEvent("keydown", { key: "Alt", altKey: true, bubbles: true }));
    expect(status().picking).toBe(true);

    dispatch(button, new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(grabbed).toEqual(["button"]);
    expect(status().picking).toBe(true);

    dispatch(document, new KeyboardEvent("keyup", { key: "Alt", bubbles: true }));
    expect(status().picking).toBe(false);
  });

  test("Alt+Shift hotkeys cancel transient picking without swallowing the event", () => {
    initSolidGrab();

    dispatch(document, new KeyboardEvent("keydown", { key: "Alt", altKey: true, bubbles: true }));
    expect(status().picking).toBe(true);

    const result = dispatch(
      document,
      new KeyboardEvent("keydown", {
        key: "Shift",
        altKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );

    expect(result).toBe(true);
    expect(status().picking).toBe(false);
  });

  test("does not grab or swallow Solid Pulse subtrees", () => {
    const grabbed: string[] = [];
    initSolidGrab({
      onGrab(context) {
        grabbed.push(context.tagName);
      },
    });

    const pulsePanel = document.createElement("div");
    pulsePanel.setAttribute("data-solid-pulse", "panel");
    const control = document.createElement("button");
    control.textContent = "Pulse";
    pulsePanel.appendChild(control);
    document.body.appendChild(pulsePanel);

    let clicked = false;
    control.addEventListener("click", () => {
      clicked = true;
    });

    setPicking(true);
    const downResult = dispatch(control, new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    const clickResult = dispatch(control, new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(downResult).toBe(true);
    expect(clickResult).toBe(true);
    expect(clicked).toBe(true);
    expect(grabbed).toEqual([]);
    expect(status().picking).toBe(true);
  });

  test("destroy removes listeners and DOM without delayed zombie bootstrap", () => {
    initSolidGrab();
    destroySolidGrab();
    dispatch(document, new Event("DOMContentLoaded", { bubbles: true }));
    dispatch(document, new KeyboardEvent("keydown", { key: "Alt", altKey: true, bubbles: true }));

    expect(document.querySelector(".solid-grab-badge")).toBeNull();
    expect(status().initialized).toBe(false);
    expect(status().picking).toBe(false);
  });
});
