# solid-grab: Project Setup Report

## Overview

This report documents the full journey of setting up `solid-grab` from initial code generation through npm publish with CI/CD. It captures every significant decision, pitfall, and resolution for future reference.

## Timeline

### 1. Code Generation (Claude.ai)

Source files were generated in a Claude.ai session as a port of `react-grab` for SolidJS. Key architectural decision: **build-time attribute injection via regex** instead of runtime Fiber tree walking (Solid has no Fiber tree).

Generated files:
- `src/types.ts` — Interfaces + data attribute constants
- `src/vite.ts` — Vite plugin with regex JSX transform
- `src/index.ts` — Runtime entry: overlay lifecycle, events, clipboard
- `src/inspector.ts` — DOM-to-source resolution, component chain formatting
- `src/overlay.ts` — Highlight box, tooltip, toast, badge (raw DOM)
- `src/agent-bridge.ts` — WebSocket client for agent communication
- `tsup.config.ts` — Dual-entry build config

### 2. Code Fixes Applied

**`src/vite.ts` — Replaced `process.env.NODE_ENV` with Vite config:**

The generated code used `process.env.NODE_ENV` to gate dev-only behavior. This doesn't work reliably in Vite plugins. Fix: store `isDev` from the `configResolved` hook:

```typescript
configResolved(config: ResolvedConfig) {
  projectRoot = config.root;
  isDev = config.command === "serve" || config.mode === "development";
}
```

**`tsup.config.ts` — Removed phantom dependencies:**

Generated config listed `@babel/core` and `@babel/types` in externals, but the code uses regex-based transforms, not Babel AST. Removed both.

**`tsconfig.json` — DOM types and JSX mode:**

- Added `DOM` and `DOM.Iterable` to `lib` (runtime uses `document`, `HTMLElement`, `WebSocket`, etc.)
- Changed `jsx` from `"react-jsx"` to `"preserve"` (SolidJS, not React)

**TypeScript strict index access (`noUncheckedIndexedAccess`):**

tsup's DTS generation flagged `TS2532: Object is possibly 'undefined'` on regex match groups and array accesses. Fixed with `!` non-null assertions on `match[0]!`, `match[1]!`, `lineStarts[mid]!`, etc. These are safe because the regex always produces these groups when it matches.

### 3. Package Configuration

**`package.json` key decisions:**
- **Unscoped name**: `solid-grab` (not `@omniaura/solid-grab`) — simpler, no scope config needed
- **Removed `private: true`** — this was from bun-init boilerplate and blocks npm publish
- **Exports order**: `types` before `import` in each export entry (TypeScript resolution requirement)
- **`peerDependenciesMeta`**: `vite` marked as `optional: true` (runtime-only users don't need Vite)
- **`files`**: `["dist", "README.md", "LICENSE"]` — clean publish, no source/tests

### 4. Build System

**tsup dual-entry configuration:**

Two separate build configs are needed because the entries target different platforms:

| Entry | Platform | External | Output |
|-------|----------|----------|--------|
| `src/index.ts` | `browser` | `solid-js` | `dist/index.js` + `.d.ts` |
| `src/vite.ts` | `node` | `vite` | `dist/vite.js` + `.d.ts` |

**Test environment:**

`bun:test` with `happy-dom` via `bunfig.toml` preload. Tests import sub-modules directly to avoid `src/index.ts` auto-initialization side effects. 46 tests across 5 files.

### 5. npm Account and Organization Setup

This was the most complex non-code part of the project.

**Account journey:**
1. Started with `@peytonomniaura` npm account
2. Discovered existing `omniaura` username account from years prior
3. Wanted `@omniaura` scope initially, then decided to keep unscoped `solid-grab`
4. Converted `omniaura` username to an npm **organization**
5. Personal account became `futuretrees`

**Key learning:** npm usernames can be converted to organizations. The personal account gets renamed, and the org takes over the old username. This is done from the org settings, not account settings.

### 6. CI/CD Pipeline

**CI (`.github/workflows/ci.yml`):**
- Triggers on PRs to `main`
- Steps: checkout, bun install, build, test, tsc --noEmit

**Release (`.github/workflows/publish.yml`):**
- Triggers on push to `main`
- Uses semantic-release for automated versioning via conventional commits
- Steps: checkout, bun install, test, build, setup-node, semantic-release

**semantic-release config (`.releaserc.json`):**
- `@semantic-release/commit-analyzer` — determines version bump from commit messages
- `@semantic-release/release-notes-generator` — generates changelog
- `@semantic-release/npm` with `provenance: true` — publishes to npm with attestation
- `@semantic-release/github` — creates GitHub releases

### 7. npm Publishing: The Auth Saga

This was a 4-attempt journey to get CI publishing working. Documenting fully because the error messages are misleading.

**Attempt 1 — EINVALIDNPMTOKEN:**
- **Cause:** npm account had 2FA set to "Authorization and publishing"
- **Fix:** Changed to "Authorization only" (uncheck "Require two-factor authentication for write actions")

**Attempt 2 — EINVALIDNPMTOKEN (still):**
- **Cause:** Granular access token created without "Bypass 2FA" checkbox
- **Fix:** Recreated token with "Bypass two-factor authentication (2FA)" checked

**Attempt 3 — E401 on `GET /-/whoami`:**
- **Cause:** `actions/setup-node` with `registry-url` creates an `.npmrc` containing `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}`. But semantic-release reads `NPM_TOKEN`, not `NODE_AUTH_TOKEN`. The `.npmrc` from setup-node takes priority, so auth always fails.
- **Fix:** Removed `registry-url` from `setup-node@v4`. Let semantic-release manage its own `.npmrc` via `NPM_TOKEN`.

**This is now documented in the official semantic-release docs** — they explicitly warn against using `registry-url` with semantic-release.

**Attempt 4 — Success!**

Published `solid-grab@1.0.0` to npm with provenance.

### 8. Trusted Publishing (OIDC)

After the initial publish with `NPM_TOKEN`, we switched to **npm Trusted Publishers**:

- Configured trust relationship on npmjs.com: `omniaura/solid-grab` repo, `publish.yml` workflow
- Removed `NPM_TOKEN` from workflow env — OIDC `id-token: write` permission handles auth
- Package settings changed to "Require two-factor authentication and disallow tokens (recommended)"
- `NPM_TOKEN` secret can be deleted from GitHub repo settings

**Benefits:**
- No long-lived secrets to rotate or leak
- Provenance attestation generated automatically
- Maximum security posture

### 9. Provenance

**bun publish does NOT support `--provenance`** (tracked in oven-sh/bun#15601). This is why we use `actions/setup-node` + semantic-release (which uses `npm publish` under the hood) instead of `bun publish`.

## Key Takeaways

1. **Never use `registry-url` with semantic-release** — it creates conflicting `.npmrc` files
2. **npm 2FA + CI tokens**: Must either use "Authorization only" 2FA or create tokens with "Bypass 2FA" enabled — or skip tokens entirely with trusted publishing
3. **Trusted publishing > tokens** — no secrets to manage, auto-provenance, maximum security
4. **tsup dual-entry** needs separate configs for different platforms (browser vs node)
5. **Solid has no Fiber tree** — build-time attribute injection via Vite plugin is the approach for source mapping
6. **`process.env.NODE_ENV` in Vite plugins** — use `config.command`/`config.mode` from `configResolved` instead
7. **semantic-release ignores `package.json` version** — it determines versions from git tags. First release will be `1.0.0` (or whatever the commit history warrants), not what's in `package.json`
