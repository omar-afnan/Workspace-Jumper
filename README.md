# Workspace Jumper

**Jump between your VS Code workspaces without digging through folders.**

![Workspace Jumper](media/img.png)

Workspace Jumper is a lightweight VS Code extension designed for developers who work across multiple projects. Save your workspaces, switch between them instantly, and automatically resume where you left off.

Everything is **local and offline-first**. There is no tracking, telemetry, or network communication.

## ✨ Features

### ⚡ Quick Workspace Switching

Jump to any saved workspace using a keyboard shortcut:

* **Windows / Linux:** `Ctrl+Alt+W`
* **macOS:** `Cmd+Alt+W`

No need to browse through folders or repeatedly open the same projects.

### 🔐 Privacy First

Workspace Jumper is built to keep your workspace information private.

* Works completely offline
* No telemetry
* No tracking
* No network requests
* Workspace paths are protected with **AES-256-GCM encryption**
* Encryption keys are stored using VS Code's secure `SecretStorage` API
* Open source and fully auditable

### 🔄 Automatic Resume

Workspace Jumper remembers your most recently used workspace and can automatically restore it when VS Code starts without a folder open.

You can enable or disable automatic resume from the extension settings.

### 🗂️ Workspace Management

Keep your workspace history organised directly from the Workspace Jumper dashboard.

You can:

* Rename saved workspaces
* Mark workspaces as sensitive
* Remove individual workspaces
* Clear your entire workspace history
* Configure how many workspaces are remembered

### 🚨 Stale Workspace Detection

Projects move. Folders get renamed. Drives disappear.

Workspace Jumper detects when a saved workspace can no longer be found and marks it as stale, giving you an easy way to clean up old entries.

### 🎛️ Multiple Ways to Access It

Workspace Jumper is available from:

* Activity Bar
* Status Bar
* Command Palette
* Keyboard shortcuts

Use whichever workflow fits you best.

---

## 🚀 Installation

### VS Code Marketplace

1. Open VS Code
2. Open Extensions with `Ctrl+Shift+X`
3. Search for **Workspace Jumper**
4. Click **Install**

### Install from VSIX

You can also install Workspace Jumper manually using a `.vsix` package.

1. Download the latest release
2. Open VS Code
3. Go to **Extensions**
4. Select the `...` menu
5. Choose **Install from VSIX**
6. Select the downloaded file

[View Workspace Jumper releases on GitHub](https://github.com/omar-afnan/workspace-jumper/releases?utm_source=chatgpt.com)

---

## ⌨️ Commands & Shortcuts

| Command               | Shortcut                   |
| --------------------- | -------------------------- |
| Jump to Workspace     | `Ctrl+Alt+W` / `Cmd+Alt+W` |
| Toggle Sensitive Flag | `Ctrl+Alt+S` / `Cmd+Alt+S` |
| Open Dashboard        | Activity Bar / Status Bar  |
| Edit Workspace        | Dashboard                  |
| Remove Workspace      | Dashboard                  |
| Clear History         | Dashboard                  |

---

## ⚙️ Settings

Workspace Jumper keeps configuration simple.

| Setting                              | Default | Description                                                                 |
| ------------------------------------ | ------: | --------------------------------------------------------------------------- |
| `workspace-jumper.autoResumeEnabled` |  `true` | Automatically resume the last workspace when VS Code opens without a folder |
| `workspace-jumper.maxHistory`        |    `10` | Maximum number of workspaces stored in history, from 1 to 50                |

### Existing Configuration

Some internal setting and command identifiers still use the original `worksnap` / `workspace-jumper` prefixes.

These identifiers are intentionally preserved so existing settings and keybindings continue working after the extension's rename.

---

## 🔒 Privacy & Security

Workspace Jumper is designed around a local-first approach.

### No Network Communication

The extension does not require an online service or external backend.

There is:

* No telemetry
* No analytics
* No tracking
* No account
* No cloud workspace database
* No external API

### Encrypted Workspace Paths

Saved workspace paths are encrypted using **AES-256-GCM**.

Encryption keys are stored through VS Code's secure `SecretStorage` API rather than being stored directly alongside the workspace data.

### Sensitive Workspaces

You can mark a workspace as **sensitive**.

Sensitive workspaces require confirmation before they can be opened, regardless of whether they are accessed through the dashboard, keyboard shortcuts, or other extension entry points.

### Webview Security

The dashboard webview uses a strict **Content Security Policy (CSP)** and does not rely on inline scripts.

---

## 🛠️ Development

Clone the repository and install the dependencies:

```bash
git clone https://github.com/omar-afnan/workspace-jumper
cd workspace-jumper
npm install
```

Compile the extension:

```bash
npm run compile
```

Then press **F5** in VS Code to launch the Extension Development Host.

### Available Scripts

| Script                | Description                                     |
| --------------------- | ----------------------------------------------- |
| `npm run check-types` | Type-check without emitting files               |
| `npm run lint`        | Run ESLint over `src`                           |
| `npm run test:unit`   | Run unit tests for the pure logic               |
| `npm test`            | Run type checking, linting, and unit tests      |
| `npm run bundle`      | Create the production esbuild bundle            |
| `npm run package`     | Verify the project and create a `.vsix` package |

---

## 🧠 Why Workspace Jumper?

If you regularly work on multiple projects, you probably know the routine:

> Open VS Code → find the folder → open the project → repeat.

Workspace Jumper turns that into:

> **Pick a workspace → jump in → keep working.**

It's built for developers who constantly move between personal projects, workspaces, experiments, repositories, and side projects.

---

## 🗺️ Roadmap

Potential improvements include:

* Recently used workspaces
* Workspace groups
* Better workspace organisation
* Custom workspace labels
* Improved onboarding
* Additional keyboard-first workflows
* More workspace restore options
* Performance improvements

Have an idea? Open an issue and let me know.

---

## 🤝 Contributing

Contributions, bug reports, feature requests, and feedback are welcome.

If you find a problem or have an idea for improving Workspace Jumper, feel free to open an issue or submit a pull request.

[View the Workspace Jumper repository](https://github.com/omar-afnan/workspace-jumper?utm_source=chatgpt.com)

---

## 📄 License

MIT License.

See [`LICENSE`](LICENSE) for the full license text.

---

**Made for developers who work on multiple projects.** 🚀
