# solid-grab

> Select context for coding agents directly from your SolidJS app.

**solid-grab** is a dev-mode tool for SolidJS that lets you hold a key, hover any element in your running app, and click to copy its full context — source file, line number, component hierarchy — ready to paste into Cursor, Claude Code, or any AI coding agent.

Inspired by [react-grab](https://react-grab.com) by Aiden Bai.

---

## How it works

1. **Build time**: A Vite plugin injects `data-solid-source` and `data-solid-component` attributes onto your JSX elements during compilation
2. **Runtime**: An overlay activates when you hold a modifier key — hover to highlight, click to grab
3. **Output**: The full context (element, source location, component tree) is copied to your clipboard or sent to an agent via WebSocket

---

## Quick start

```bash
npm install solid-grab --save-dev
```

### 1. Add the Vite plugin

```ts
// vite.config.ts
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import solidGrab from "solid-grab/vite";

export default defineConfig({
  plugins: [
    solidGrab(),   // ← must come BEFORE vite-plugin-solid
    solid(),
  ],
});
```

That's it. The plugin auto-injects the runtime in dev mode. No code changes needed.

### 2. Use it

1. Run your dev server (`npm run dev`)
2. Hold **Alt** (or **Option** on Mac)
3. Hover over any element — you'll see a blue highlight with component info
4. **Click** to copy the full context to your clipboard
5. Paste into your AI agent prompt

---

## What gets copied

```
--- solid-grab context ---

Element: <button class="btn btn-primary">
Source:  src/components/Counter.tsx:24:8

Component tree (innermost → outermost):
  <Counter /> → src/components/Counter.tsx:12:1
  <App /> → src/App.tsx:8:1

HTML:
<button class="btn btn-primary" data-solid-source="src/components/Counter.tsx:24:8">Count: 5</button>

--- end solid-grab context ---
```

---

## Configuration

### Vite plugin options

```ts
solidGrab({
  // Inject data-solid-source attributes (default: true)
  jsxLocation: true,

  // Inject data-solid-component attributes (default: true)
  componentLocation: true,

  // Auto-import the runtime in dev mode (default: true)
  autoImport: true,
})
```

### Runtime options

If you want to customize the runtime behavior, disable `autoImport` and initialize manually:

```ts
// src/index.tsx
import { initSolidGrab } from "solid-grab";

if (import.meta.env.DEV) {
  initSolidGrab({
    // Modifier key to hold (default: "Alt")
    key: "Alt",

    // Show toast on copy (default: true)
    showToast: true,

    // WebSocket URL for agent bridge
    agentUrl: "ws://localhost:4567",

    // Custom callback
    onGrab(context) {
      console.log("Grabbed:", context);
      // Return false to prevent clipboard copy
    },
  });
}
```

---

## Agent integration

### Clipboard (default)

Just paste the copied context into any AI chat — Claude, ChatGPT, Cursor's chat, etc.

### WebSocket bridge

For a tighter loop, solid-grab can send context directly to an agent over WebSocket:

```ts
initSolidGrab({
  agentUrl: "ws://localhost:4567",
});
```

You'll need to run a small bridge server alongside your dev server. (A `@solid-grab/claude-code` package is planned.)

---

## How it differs from react-grab

| | react-grab | solid-grab |
|---|---|---|
| **Framework** | React | SolidJS |
| **Source mapping** | React Fiber tree (via bippy) | Build-time attribute injection |
| **Component detection** | Runtime fiber walking | Build-time `data-solid-component` attrs |
| **Why different** | React has a runtime component tree | Solid compiles components away |

React Grab hooks into React's private Fiber internals at runtime to walk the component tree. Solid doesn't have a Fiber tree — components are compiled into direct DOM operations and disappear at runtime. So solid-grab takes a **build-time** approach: the Vite plugin annotates JSX with source metadata before Solid's compiler runs, preserving the mapping through compilation.

---

## API

### `initSolidGrab(options?)`

Initialize the runtime overlay. Called automatically on import unless `autoImport` is disabled.

### `destroySolidGrab()`

Tear down the overlay and event listeners. Useful for HMR cleanup.

### `inspect(element: HTMLElement): GrabbedContext`

Programmatically inspect any DOM element and get its full context.

### `window.__SOLID_GRAB__`

Global API for extensibility:
- `.init(options)` — same as `initSolidGrab`
- `.destroy()` — same as `destroySolidGrab`
- `.inspect(el)` — same as `inspect`

---

## Requirements

- SolidJS >= 1.7
- Vite >= 4.0
- Dev mode only (all code is stripped in production)

---

## License

MIT
