# SkillSpotlight Tauri

Tauri rewrite of the Electron SkillSpotlight app. The renderer is intentionally reused from the Electron version so the search panel, preferences UI, shortcuts, and snippet behavior stay the same while the packaged app is much smaller.

## Requirements

- macOS
- Node.js 20+
- Rust/Cargo

Install dependencies:

```bash
npm install
```

Run in development:

```bash
npm start
```

Run checks:

```bash
npm run check
npm test
npm run test:e2e
```

## Test Coverage

`npm test` runs the Rust unit tests for config loading, directory scanning, source updates, hotkey conversion, and default paths.

`npm run test:e2e` runs the browser fixture suite for the main UI flows:

- direct snippet add, edit, confirm, revert, delete, and undo
- directory import, duplicate warning, prefix edit, collapse/expand, refresh, reveal, remove, and sync
- search results, no-match state, hover/keyboard selection, paste/copy/reveal invocation, and close invocation
- settings navigation, theme changes, hotkey save, config path display, reload, and reveal invocation

The e2e suite runs against the browser shim in `src/tauri-api.js`. It verifies UI behavior and command invocation, but it does not exercise native macOS dialogs, clipboard writes, global shortcut registration, or Finder reveal behavior end-to-end.

Build the macOS app and DMG:

```bash
npm run build
```

Artifacts are written under:

```text
src-tauri/target/release/bundle/
```

## Config

The Tauri version reads and writes its own default config file:

```text
~/Library/Application Support/skillspotlight-tauri/config.json
```

`SS_CONFIG_PATH` is still supported for development or isolated testing.

## Release

See `RELEASE.md` for the release checklist and artifact verification steps.

## Size

Current local build:

- Tauri app: `8.8M`
- Tauri DMG: `3.0M`
- Electron app in this workspace: `264M`
