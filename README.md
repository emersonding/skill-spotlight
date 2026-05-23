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

## Size

Current local build:

- Tauri app: `8.8M`
- Tauri DMG: `3.0M`
- Electron app in this workspace: `264M`
