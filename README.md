# Warpspace - Workspace Manager

Warpspace is a VS Code extension that makes switching between projects fast, secure, and hassle-free. It lets you warp between workspaces instantly while keeping your workspace history encrypted and fully private.

You can switch to any saved workspace with a simple keyboard shortcut, and Warpspace automatically remembers and restores your last session. All workspace paths are protected using strong AES-256-GCM encryption, and everything works completely offline - no tracking, no telemetry, and no network requests.

The extension also gives you full control over your workspace history. You can rename workspaces, mark sensitive ones, remove entries, or clear history whenever you want. A clean dashboard UI is available through the Activity Bar, Status Bar, or Command Palette, making workspace management quick and intuitive.

---

## Features

- **Quick Switching**: Warp to saved workspaces with `Ctrl+Alt+W` (Windows/Linux) or `Cmd+Alt+W` (Mac)
- **Privacy and Security**: AES-256-GCM encrypted workspace paths, offline-first, sensitive workspace protection
- **Auto-Save and Resume**: Track and restore last workspace automatically; configurable history limit
- **Workspace Management**: Rename, toggle sensitive flag, remove, or clear workspace history
- **Stale Entry Detection**: Workspaces whose folder has been moved or deleted are flagged, and you are offered a one-click cleanup
- **Dashboard and UI**: Access via Activity Bar, Status Bar, or Command Palette

---

## Installation

### From VS Code Marketplace (Recommended)
1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X`)
3. Search for "Warpspace"
4. Click Install

### From VSIX
1. Download the `.vsix` file from [Releases](https://github.com/omar-afnan/workspace-jumper/releases)
2. In VS Code: Extensions, then click the `...` menu, then Install from VSIX
3. Select the downloaded file

### Development
```bash
git clone https://github.com/omar-afnan/workspace-jumper
cd workspace-jumper
npm install
npm run compile
# Press F5 to launch Extension Development Host
```

Useful scripts:

| Script | What it does |
|--------|--------------|
| `npm run check-types` | Type check without emitting |
| `npm run lint` | ESLint over `src` |
| `npm run test:unit` | Unit tests for the pure logic in `src/utils.ts` |
| `npm test` | Type check + lint + unit tests |
| `npm run bundle` | Production esbuild bundle into `dist/` |
| `npm run package` | Verify, then build a `.vsix` |

---

## Commands and Shortcuts

| Command | Shortcut |
|---------|----------|
| Jump to Workspace | `Ctrl+Alt+W` / `Cmd+Alt+W` |
| Toggle Sensitive Flag | `Ctrl+Alt+S` / `Cmd+Alt+S` |
| Open Dashboard | Activity Bar or Status Bar |
| Edit, Remove, Clear | Dashboard buttons |

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `worksnap.autoResumeEnabled` | `true` | Resume the last workspace when VS Code opens without a folder |
| `worksnap.maxHistory` | `10` | Maximum number of workspaces to keep in history (1-50) |

> Setting and command identifiers keep their original `worksnap` / `workspace-jumper` prefixes so that existing settings and keybindings continue to work across the rename.

---

## Privacy

- Completely offline, no network requests
- Workspace paths are encrypted with AES-256-GCM; the key lives in VS Code's secure SecretStorage API
- Webviews run under a strict Content-Security-Policy with no inline scripts
- Workspaces marked sensitive require confirmation before opening, from every entry point
- Open source and auditable

---

## License

MIT License - see [LICENSE](LICENSE) for details

---

**Made for developers who work on multiple projects**
