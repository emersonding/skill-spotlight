# SkillSpotlight

Call skills explicitly, and only when you need them.

SkillSpotlight is a macOS snippet launcher for skills, prompts, commands, and reusable text. Open it with a global shortcut, type a few characters, then paste, copy, or reveal the matching snippet without leaving your current workflow.

![SkillSpotlight search results for clean-code](assets/readme/spotlight-search-clean-code.png)

## Why This App

Skills are most useful when invocation is intentional. Many agent skills are expensive, slow, opinionated, or disruptive when they trigger automatically. For heavy workflows, telling Claude, Codex, or another agent in `AGENTS.md` not to auto-invoke a skill is not always reliable enough. The cleaner pattern is to keep the skill available everywhere, but call it explicitly at the moment you want it.

That gets harder when you use multiple agents. Today, a common workaround is to symlink or copy the same skill directories between tools. SkillSpotlight gives you a more universal control point: index your skill files once, search them quickly, and inject the exact skill prompt into any app, editor, chat, or new agent platform with one shortcut.

## What It Does

- Opens a Spotlight-style launcher from a global shortcut.
- Searches direct snippets and directory-backed snippets in the same result list.
- Imports Claude, Codex, team, or personal skill directories with prefixes like `claude:` and `codex:` so each snippet's source is visible in its name.
- Supports fuzzy matching, highlighted matches, keyboard navigation, and mouse selection.
- Pastes the selected snippet, copies it to the clipboard, or reveals the source file.
- Provides preferences for snippets, directory sources, theme, shortcut, and storage.

## Usage

1. Start SkillSpotlight and press the configured global shortcut. The default is `Alt+Space`.
2. Type part of a snippet key, source prefix, or filename.
3. Use `ArrowUp` and `ArrowDown` to choose a result.
4. Press `Enter` to paste the selected snippet into the active app.
5. Press `Cmd+C` to copy the snippet instead.
6. Press `Cmd+Enter` to reveal the source file in Finder.
7. Press `Esc` to close the launcher.

The launcher searches across direct snippets and imported directories. Directory snippets use their configured prefix, such as `codex:forum` or `general:clean-code`, so related snippets stay grouped while still being searchable by the final filename.

![SkillSpotlight search results for forum](assets/readme/spotlight-search-forum.png)

## Adding Snippets

SkillSpotlight supports two kinds of snippets.

Direct snippets are best for short reusable text that you manage inside the app. Open Preferences, go to Snippets, enter a key and value, then add it. For example, a key like `email-signoff` can paste your preferred sign-off, or `review-note` can paste a common code review comment.

Directory snippets are best for existing skill libraries or prompt folders. Add a directory, choose a prefix, and each file becomes a searchable snippet.

## Preferences

Open Preferences from the launcher footer or with `Cmd+,`.

In the Snippets tab, add one-off direct snippets or import a directory. Every supported file in an imported directory becomes a snippet, and the directory prefix can be edited after import.

![SkillSpotlight preferences showing snippets and directory sources](assets/readme/preferences-snippets.png)

Other preference tabs let you:

- switch between light and dark themes
- record a different global shortcut
- inspect, reveal, and reload the local config file

## Development

Requirements:

- macOS
- Node.js 20+
- Rust/Cargo

Install dependencies:

```bash
npm install
```

Run the desktop app in development:

```bash
npm start
```

Run the frontend-only dev server:

```bash
npm run dev:frontend
```

Run checks and tests:

```bash
npm run check
npm test
npm run test:e2e
```

Build the macOS app and DMG:

```bash
npm run build
```

Build artifacts are written under:

```text
src-tauri/target/release/bundle/
```

## Config

SkillSpotlight stores its default config at:

```text
~/Library/Application Support/skillspotlight-tauri/config.json
```

Use `SS_CONFIG_PATH` for isolated development or testing.

## Naming

Use `SkillSpotlight` for the visible app name. For package names, binary names, repository slugs, and CLI-style references, `skill-spotlight` is easier to scan than a camel-case form and matches common command-line naming conventions.

## Release

See `RELEASE.md` for the release checklist and artifact verification steps.
