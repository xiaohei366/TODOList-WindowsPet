# Codex-Compatible Pet Pack Installation

TOList Desktop Pet reads the same package shape used by Codex pets: a folder containing `pet.json` and `spritesheet.webp`.

## Required Pet Format

`pet.json`:

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

- File name defaults to `spritesheet.webp`; a different relative path can be set with `spritesheetPath`.
- Atlas size must be `1536x1872`.
- Atlas layout must be `8` columns by `9` rows.
- Each cell is `192x208`.
- Unused cells after a row's final frame should be transparent.

Animation row order:

| Row | State | Used columns |
| --- | --- | --- |
| 0 | `idle` | 0-5 |
| 1 | `running-right` | 0-7 |
| 2 | `running-left` | 0-7 |
| 3 | `waving` | 0-3 |
| 4 | `jumping` | 0-4 |
| 5 | `failed` | 0-7 |
| 6 | `waiting` | 0-5 |
| 7 | `running` | 0-5 |
| 8 | `review` | 0-5 |

## Reusing Codex Community Pets

The app automatically scans:

```powershell
%USERPROFILE%\.codex\pets
```

Any existing Codex pet folder under that path is available in the desktop pet right-click menu after the app starts or after choosing `Refresh Pets`.

## Installing With npm

Install a community pet package into the app package root:

```powershell
npm install <pet-package> --prefix "$env:APPDATA\TOList\pet-packages"
```

The app scans these npm package shapes:

```text
%APPDATA%\TOList\pet-packages\node_modules\<pet-package>\pet.json
%APPDATA%\TOList\pet-packages\node_modules\<pet-package>\pets\<pet-id>\pet.json
%APPDATA%\TOList\pet-packages\node_modules\@scope\<pet-package>\pet.json
%APPDATA%\TOList\pet-packages\node_modules\@scope\<pet-package>\pets\<pet-id>\pet.json
```

After installation, right-click the pet and choose `Refresh Pets`.

## Installing From a Local Zip

Create a zip with this structure:

```text
pet.json
spritesheet.webp
```

Then right-click the desktop pet and choose `Import Pet Zip`.

Imported pets are unpacked to:

```powershell
%APPDATA%\TOList\pets\<pet-id>
```

You can also manually unzip a pet folder there and choose `Refresh Pets`.

## Priority and Conflicts

When multiple packages use the same `id`, the app keeps the first match in this order:

1. `%APPDATA%\TOList\pets`
2. `%USERPROFILE%\.codex\pets`
3. `%APPDATA%\TOList\pet-packages`

Use unique `id` values for community packages to avoid conflicts.
