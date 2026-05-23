# Release Checklist

This project ships as a macOS Tauri app plus DMG.

## Version

Update both version fields before a release:

- `package.json`
- `src-tauri/tauri.conf.json`

Keep the versions identical.

## Verify

Run the full local verification set:

```bash
npm run check
npm test
npm run test:e2e
```

What this covers:

- Rust backend unit tests for config paths, config sanitization, directory source behavior, and hotkey conversion.
- Browser e2e tests for direct snippets, directory sources, search, settings, storage, and command invocation.
- Production frontend build plus Rust `cargo check`.

Manual smoke checks still needed before publishing:

- First launch opens Preferences.
- Global shortcut registers and toggles the window.
- Paste, copy, and reveal work in a real macOS app.
- Directory picker opens and imports a real directory.
- Tray menu actions work, including Sync All and Quit.

## Build

```bash
npm run build
```

Artifacts are written under:

```text
src-tauri/target/release/bundle/
```

Expected artifact types:

- `.app` bundle
- `.dmg` installer image

## Inspect Artifacts

Check artifact presence and size:

```bash
du -sh src-tauri/target/release/bundle/macos/*.app
du -sh src-tauri/target/release/bundle/dmg/*.dmg
```

Open the built app from the release bundle for the manual smoke checks.

## Publish

Create a Git tag using the app version:

```bash
git tag v0.3.0
```

Attach the DMG to the release. Include notes for user-visible changes, known issues, and whether config migration is required.
