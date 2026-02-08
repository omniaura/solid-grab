# solid-grab

Dev-mode SolidJS tool that lets you Alt+hover+click any element to copy source location + component hierarchy for AI agent context. Port of react-grab using build-time attribute injection (since Solid has no Fiber tree).

## Build & Test

- `bun install` — install dependencies
- `bun run build` — build with tsup → `dist/` (ESM, .d.ts, sourcemaps)
- `bun test` — run test suite (uses happy-dom via bunfig.toml)
- `bunx tsc --noEmit` — type-check without emitting
- `bun pack --dry-run` — preview npm publish contents

## Project Structure

```
src/
  types.ts          # Interfaces + data attribute constants
  index.ts          # Runtime entry: overlay lifecycle, events, clipboard, global API
  inspector.ts      # DOM → source resolution, component chain, context formatting
  overlay.ts        # Highlight box, tooltip, toast, badge (raw DOM)
  agent-bridge.ts   # WebSocket client for agent communication
  vite.ts           # Vite plugin: regex JSX transform injecting data attributes
tests/              # bun:test + happy-dom
tsup.config.ts      # Dual entry: browser runtime + node Vite plugin
bunfig.toml         # happy-dom test environment
```

## Architecture

- **Two entry points**: `solid-grab` (browser runtime) and `solid-grab/vite` (Vite plugin, Node)
- Vite plugin runs `enforce: "pre"` before vite-plugin-solid, injecting `data-solid-source` and `data-solid-component` attributes via regex
- Runtime auto-initializes on import (`import "solid-grab"`) — tests import sub-modules directly to avoid this side effect
- All overlay DOM is raw (no Solid reactivity) to avoid interfering with the inspected app
