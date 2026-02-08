# solid-grab Setup Guide

Add dev-mode element inspection to your SolidJS app. Hold Alt, hover any element, click to copy source location and component hierarchy — ready to paste into your AI coding agent.

## Installation

```bash
bun add -d solid-grab
# or
npm install -D solid-grab
# or
pnpm add -D solid-grab
```

## Vite Plugin Setup

Add the `solid-grab` Vite plugin **before** `vite-plugin-solid` in your `vite.config.ts`:

```typescript
import solidGrab from "solid-grab/vite";
import solidPlugin from "vite-plugin-solid";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    solidGrab(), // Must be BEFORE solidPlugin
    solidPlugin(),
    // ...other plugins
  ],
});
```

The plugin order matters — `solid-grab` needs to inject `data-solid-source` and `data-solid-component` attributes into the raw JSX **before** Solid's compiler transforms it away.

### Real-World Example (ditto-app)

Here's how it looks in a production SolidJS app with Tailwind, PWA, and other plugins:

```typescript
/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import solidGrab from "solid-grab/vite";
import solidPlugin from "vite-plugin-solid";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    tailwindcss(),
    solidGrab(),      // Before solidPlugin — order matters
    solidPlugin(),
    VitePWA({ ... }),
  ],
  // ...rest of config
});
```

`solidGrab()` can go anywhere before `solidPlugin()` — it doesn't conflict with CSS plugins, PWA plugins, etc.

## That's It

No other code changes needed. The plugin does two things automatically in dev mode:

1. **Injects source attributes** — Every JSX element gets `data-solid-source="path:line:col"` and components get `data-solid-component="ComponentName"`
2. **Auto-imports the runtime** — A `<script>` tag is injected into `index.html` that loads the overlay UI

In production builds, the plugin is completely inert — no attributes injected, no runtime loaded.

## Usage

1. Start your dev server (`bun run dev` / `vite`)
2. Hold **Alt** (Option on Mac) and hover over any element
3. A blue highlight shows the element with its source location
4. **Click** to copy the context to your clipboard
5. Paste into Claude Code, Cursor, or any AI coding agent

The copied context includes:
- File path, line, and column
- Component hierarchy (e.g., `App > Sidebar > NavItem`)
- Ready-to-use format for AI agents

## Plugin Options

```typescript
solidGrab({
  jsxLocation: true,      // Inject data-solid-source (default: true)
  componentLocation: true, // Inject data-solid-component (default: true)
  autoImport: true,        // Auto-inject runtime script (default: true)
});
```

To disable the auto-import and manually control when the runtime loads:

```typescript
// vite.config.ts
solidGrab({ autoImport: false });

// Then in your app entry, conditionally import:
if (import.meta.env.DEV) {
  import("solid-grab");
}
```

## Troubleshooting

### Attributes not appearing on elements

- Verify `solidGrab()` is listed **before** `solidPlugin()` in the plugins array
- Check that you're running in dev mode (`vite` / `bun run dev`), not a production build
- Only `.jsx` and `.tsx` files are transformed — plain `.ts` files are skipped

### Overlay not showing

- Check browser console for errors
- If `autoImport` is disabled, make sure you're importing `"solid-grab"` somewhere in your app code
- The overlay only activates while holding the Alt key

### TypeScript errors

If TypeScript can't find the module types, ensure your `tsconfig.json` has `"moduleResolution": "bundler"` or `"nodenext"` — these resolve package.json `exports` correctly.
