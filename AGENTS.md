# SkillSpotlightTauri Agent Notes

## Basic Info

SkillSpotlightTauri is a Tauri 2 desktop app with a Vite-rendered frontend and a Rust backend. It provides a Spotlight-style snippet launcher, directory-backed snippet imports, global shortcut registration, tray controls, and local JSON config storage.

Common commands:

- `npm start` or `npm run dev`: run the Tauri app in development mode.
- `npm run dev:frontend`: run the frontend-only Vite server for browser/e2e work.
- `npm run build`: build the packaged Tauri app.
- `npm run check`: build the frontend and run `cargo check`.
- `npm test`: run Rust tests.
- `npm run test:e2e`: run Playwright e2e tests.

Generated build output lives in `dist/`, `node_modules/`, `src-tauri/target/`, `test-results/`, and `e2e/.runtime/`. Do not treat those directories as source.

## File Tree

```text
.
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── RELEASE.md
├── e2e/
│   ├── fixtures/skills/
│   └── skillspotlight.e2e.js
├── package.json
├── playwright.config.js
├── src/
│   ├── index.html
│   ├── renderer/
│   │   ├── app.js
│   │   └── styles.css
│   └── tauri-api.js
├── src-tauri/
│   ├── Cargo.toml
│   ├── build.rs
│   ├── capabilities/default.json
│   ├── icons/
│   ├── src/main.rs
│   └── tauri.conf.json
└── vite.config.js
```

## Rules

- Do not start coding or modify files when the user is only asking a question or the topic is still under discussion.
- Prefer repo-local patterns over introducing new abstractions.
- Keep generated output, dependency folders, and build artifacts out of commits.
- If a behavior change is suitable for e2e coverage, add or update Playwright e2e coverage for it.
- Use `rg`/`rg --files` for search when available.
- Do not invoke `playwright-scraper` or `superpowers` skills unless the user explicitly asks for them.

## Testing Notes

Frontend-only browser behavior is covered by `e2e/skillspotlight.e2e.js` through the `?e2e=1` shim in `src/tauri-api.js`. Native Tauri behavior should be covered with Rust tests where practical, and with e2e assertions when the behavior is observable through the renderer.
