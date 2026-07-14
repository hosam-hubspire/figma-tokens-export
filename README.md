# Export Design Tokens

A local Figma plugin that exports **W3C Design Tokens** from any open Figma file, and can **push them to GitHub**.

## What it exports

Nested W3C Design Tokens JSON (`$type` / `$value`) for COLOR, FLOAT, STRING, and BOOLEAN variables — including aliases like `{brand.blue}` — one token tree per collection × mode.

Only **local** variables in the current file are exported.

## Install in Figma (any project)

1. Open Figma Desktop (or browser) in **Design** or **Dev** mode.
2. Go to **Resources → Plugins → Development → Import plugin from manifest…**
3. Select this folder’s `manifest.json`:
   `/Users/hosamashraf/Documents/figma-tokens-export/manifest.json`
4. If you already imported an older version, **re-import** the same file (required after `networkAccess` / capability changes).
5. Run it from **Plugins → Development → Export Design Tokens** (not the Export button inside the Variables panel).

Works in Design mode and Dev Mode (`editorType`: `figma` + `dev`).

## Usage

1. Run **Export Design Tokens**.
2. Select collections.
3. **Export & download** for a local JSON file, or **Push to GitHub**.

### Output shape (abridged)

```json
{
  "fileName": "My Design System",
  "files": [
    {
      "fileName": "Colors.Light.tokens.json",
      "collectionName": "Colors",
      "modeName": "Light",
      "tokens": {
        "bg": {
          "primary": {
            "$type": "color",
            "$value": "{brand.blue}"
          }
        }
      }
    }
  ]
}
```

## Push to GitHub

| Input | Behavior |
| --- | --- |
| Repo **name** only (e.g. `sweet-tea-tokens`) | Uses owner/org (default `hosam-hubspire`). Creates a **private** repo if missing, then commits the token file. |
| `owner/repo` or full GitHub **URL** | Uses that repo (creates it as private if missing). |

### Setup

1. Create a GitHub [personal access token](https://github.com/settings/tokens) with the **`repo`** scope  
   (classic PAT, or fine-grained with Contents: Read/Write + Administration: Read/Write if you want create-repo).
2. In the plugin **GitHub** section:
   - Paste the token → **Save settings**
   - Owner / org: `hosam-hubspire` (or another account/org you can write to)
   - Repo name or URL
   - File path (default `tokens/design-tokens.json`)
   - Branch (default `main`)
3. Click **Push to GitHub**.

Missing repos are always created as **private**. The token is stored in Figma `clientStorage` on your machine (not in the design file). Use **Clear token** to remove it.

## Files

- `manifest.json` — plugin registration + GitHub API network access
- `code.js` — W3C token export + GitHub create/push
- `ui.html` — plugin panel UI

No build step or npm install required.

## Requirements

- A Figma file that uses [Variables](https://help.figma.com/hc/en-us/articles/15339669396759)
- Plugin development access (import from manifest)
- GitHub token with repo write access (for push)
