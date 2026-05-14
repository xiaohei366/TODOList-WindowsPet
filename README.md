# TODOList Windows Codex Pet

[中文文档](README.zh-CN.md)

Windows desktop pet TODO manager built with Electron, React, and TypeScript. It keeps TODO data in a readable Markdown file and reuses Codex-compatible pet packages from the local Codex pet ecosystem.

## Features

- Transparent always-on-top Windows desktop pet.
- Codex pet package compatibility: `pet.json` plus `spritesheet.webp`.
- Automatic pet discovery from `%USERPROFILE%\.codex\pets`.
- App pet discovery from `%APPDATA%\TOList\pets`.
- npm-installed pet package discovery from `%APPDATA%\TOList\pet-packages`.
- Markdown-backed TODO storage at `%USERPROFILE%\Documents\TOList\todos.md`.
- Human-readable TODO hierarchy: year, month, day.
- Floating TODO panel above the pet, with up to three visible items and scroll support.
- Motivational TODO header showing how many tasks have been completed today.
- Visible system tray icon with Show / Hide, Open TODO Markdown, and quick Quit actions.
- Right-click pet actions for showing or hiding the TODO panel, opening the Markdown source file, importing pet zip packages, refreshing pets, switching pet styles, and quitting.
- Right-click TODO actions use a native menu for editing, marking done, deleting, toggling the `[!]` red marker, and `Adjust Priority > Move Up / Move Down`.
- Long-press TODO sorting within the same day is still supported for direct drag ordering.
- Completed TODOs are rendered with strikethrough and moved to the end of the day.
- Pet state changes based on TODO state: `review` for active TODOs, `idle` when clear, `waving` on hover or after adding, and directional running while dragging.
- Pet animations use Codex-compatible rows and frames with a calmer desktop playback cadence.

## Requirements

- Windows 10 or newer.
- Node.js 24+ recommended.
- npm 11+ recommended.

## Development

Install dependencies:

```powershell
npm install
```

Run the app in development mode:

```powershell
npm run dev
```

Run tests:

```powershell
npm test
```

Run TypeScript checking:

```powershell
npm run typecheck
```

Build a portable Windows executable:

```powershell
npm run build
```

The portable executable is generated at:

```text
release/TOList-Desktop-Pet-0.1.0.exe
```

## Markdown TODO Format

The default source file is:

```powershell
%USERPROFILE%\Documents\TOList\todos.md
```

The app stores TODOs in this format:

```markdown
# 2026

## 2026-05

### 2026-05-11 Monday

- [ ] [!] Important item
- [ ] [order:1] Display-priority item
- [ ] Normal item
- [x] [done:2026-05-11] ~~Finished item~~
```

Rules:

- `#` headings are years.
- `##` headings are months in `YYYY-MM`.
- `###` headings are days in `YYYY-MM-DD Weekday`.
- `[!]` marks a TODO as red/high priority.
- `[order:n]` stores display priority for active visible TODOs, including cross-date ordering between overdue and today.
- `[done:YYYY-MM-DD]` records the local date when a TODO was completed, so legacy TODOs finished today count toward today's completed total.
- Completed items use `[x]` and strikethrough.
- Deleting a TODO removes its Markdown line.

## Pet Package Format

A compatible pet folder contains:

```text
pet.json
spritesheet.webp
```

Example `pet.json`:

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "A short human-readable description.",
  "spritesheetPath": "spritesheet.webp",
  "kind": "person"
}
```

Spritesheet requirements:

- Atlas size: `1536x1872`.
- Layout: `8` columns by `9` rows.
- Cell size: `192x208`.
- State row order:
  - `idle`
  - `running-right`
  - `running-left`
  - `waving`
  - `jumping`
  - `failed`
  - `waiting`
  - `running`
  - `review`

More installation details are in [docs/pet-pack-installation.md](docs/pet-pack-installation.md).

## Installing Pet Packs

Install from npm:

```powershell
npm install <pet-package> --prefix "$env:APPDATA\TOList\pet-packages"
```

Then right-click the pet and choose `Refresh Pets`.

Install from a local zip:

1. Create a zip containing `pet.json` and `spritesheet.webp`.
2. Right-click the pet.
3. Choose `Import Pet Zip`.

Reuse existing Codex pets by placing them under:

```powershell
%USERPROFILE%\.codex\pets
```

## Project Structure

```text
src/main/             Electron main process, Markdown storage, pet registry
src/preload/          Safe IPC bridge exposed to the renderer
src/renderer/         React desktop pet UI
src/shared/           Shared types
tests/                Vitest coverage for TODO storage, pet registry, animation helpers
docs/                 Pet package installation documentation
```

## Current Scope

This is a local-first Windows desktop app. It does not include account sync, cloud storage, recurring TODOs, reminders, or an emotional/personality system.
