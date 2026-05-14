# SpaceShift - Workspace Manager

SpaceShift is a VS Code extension that makes switching between projects fast, secure, and hassle-free. It lets you jump between workspaces instantly while keeping your workspace history encrypted and fully private.

You can switch to any saved workspace with a simple keyboard shortcut, and SpaceShift automatically remembers and restores your last session. All workspace paths are protected using strong AES-256-GCM encryption, and everything works completely offline - no tracking, no telemetry, and no network requests.

The extension also gives you full control over your workspace history. You can rename workspaces, mark sensitive ones, remove entries, or clear history whenever you want. A clean dashboard UI is available through the Activity Bar, Status Bar, or Command Palette, making workspace management quick and intuitive.

---

## Features

- **Quick Switching**: Jump to saved workspaces with `Ctrl+Alt+W` (Windows/Linux) or `Cmd+Alt+W` (Mac)
- **Privacy and Security**: AES-256-GCM encrypted workspace paths, offline-first, sensitive workspace protection
- **Auto-Save and Resume**: Track and restore last workspace automatically; configurable history limit
- **Workspace Management**: Rename, toggle sensitive flag, remove, or clear workspace history
- **Dashboard and UI**: Access via Activity Bar, Status Bar, or Command Palette

---

## Installation

### From VS Code Marketplace (Recommended)
1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X`)
3. Search for "SpaceShift"
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

---

## Commands and Shortcuts

| Command | Shortcut |
|---------|----------|
| Jump to Workspace | `Ctrl+Alt+W` / `Cmd+Alt+W` |
| Toggle Sensitive Flag | `Ctrl+Alt+S` / `Cmd+Alt+S` |
| Open Dashboard | Activity Bar or Status Bar |
| Edit, Remove, Clear | Dashboard buttons |

---

## Privacy

- Completely offline, no network requests
- Only uses VS Code's secure SecretStorage API
- Open source and auditable

---

## License

MIT License - see [LICENSE](LICENSE) for details

---

**Made for developers who work on multiple projects**

