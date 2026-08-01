# Change Log

All notable changes to Warpspace will be documented in this file.

## [1.3.0] - 2026-08-01

### Changed
- Renamed extension from SpaceShift to **Warpspace**. Command ids, setting keys and
  stored history are unchanged, so existing settings and keybindings keep working.

### Fixed
- **Delete button in the dashboard did nothing.** The inline `onclick="remove(...)"`
  handler resolved to the browser's built-in `Element.remove()`, so the card
  disappeared from the view but the workspace stayed in history and came back on
  the next refresh.
- **Sensitive workspaces could be opened without confirmation** from the dashboard.
  The confirmation prompt previously existed only in the Quick Pick flow; it now
  applies to every entry point (picker, dashboard, auto-resume).
- **Clear History in the dashboard wiped everything with no confirmation.** It now
  shows the same modal confirmation as the command palette version.
- **Dashboard and sidebar could drift out of sync.** Every mutation now broadcasts a
  change event, and the dashboard panel subscribes to it.
- Opening the dashboard repeatedly stacked duplicate panels instead of revealing
  the existing one.
- The development auto-reload watcher matched files in whatever project the
  Extension Development Host had open, causing reload storms. It is now scoped to
  the extension's own `dist/` output.

### Added
- Stale entry detection: workspaces whose folder has been moved or deleted are
  flagged in both the dashboard and the picker, with a one-click option to remove
  them from history.
- Undecryptable entries (for example after the SecretStorage key is lost) are now
  shown as recoverable broken cards rather than blank rows with a dead Open button.

### Security
- Added a strict Content-Security-Policy and script nonce to both webviews.
  All inline event handlers were replaced with a single delegated listener.
- The `LICENSE` file previously contained only the words "MIT License" in UTF-16
  with no license text. It now contains the full MIT license, and `package.json`
  declares `"license": "MIT"`.

### Internal
- `vscode:prepublish` now type checks, lints and produces a minified esbuild
  bundle. Previously it shipped unbundled `tsc` output and `esbuild.js` was unused.
- ESLint is now actually installed and runnable; `npm test` runs type check, lint
  and unit tests.
- The publish workflow now skips publishing when the version has not changed,
  instead of failing on every push that touched `src/`.
- Removed dead files: duplicate `src/dashboard.css`, committed build artifacts in
  `src/test/`, the Yeoman boilerplate integration test, and the `icon:node` script
  that pointed at a nonexistent file.
- Enabled stricter TypeScript checks (`noUnusedLocals`, `noUnusedParameters`,
  `noImplicitReturns`, `noFallthroughCasesInSwitch`).

## [1.2.2] - 2026-05-14

### Changed
- Renamed extension from WorkSnap to SpaceShift

## [1.2.1] - 2026-05-14

### Changed
- Version bump for marketplace publish

## [1.1.9] - 2024-01-12

### Fixed
- Fixed README.md encoding issue that caused garbled text on VS Code Marketplace
- Improved sidebar CSS for narrow panel widths - layout now adapts gracefully
- Added responsive breakpoints for very narrow sidebars (text wrapping, icon-only mode)
- Reduced padding and font sizes for better space efficiency
- Fixed word-wrap issues for long workspace names and paths

### Changed
- Optimized CSS for better performance on narrow sidebar panels
- Improved visual consistency across different sidebar widths
- Cleaned up project: removed boilerplate files and old .vsix packages
- Fixed displayName formatting in package.json

## [1.1.5] - 2024-01-09

### 🐛 Fixed - CRITICAL Production Issues
- **Fixed icons not showing in production/marketplace** - Codicons CSS and fonts now properly bundled in `.vsix` package
- **Fixed blank sidebar in production** - Added proper activation events (`onView:worksnap.sidebarView`, `onStartupFinished`)
- **Fixed activity bar icon not rendering** - Converted to monochrome SVG using `currentColor` for proper VSCode theming

### 📝 Changed
- Updated `.vscodeignore` to include `@vscode/codicons` in package (was excluded, causing missing icons)
- Improved README with comprehensive documentation, troubleshooting, and feature descriptions
- Added detailed troubleshooting section for common issues

### 🔍 Technical Details
**Why it worked in debug but not production:**
- Debug mode loads files directly from workspace (including `node_modules`)
- Production `.vsix` excluded `node_modules/**` which removed codicons fonts/CSS
- Activity bar icons must be monochrome SVG (colored SVGs fail in production)
- Missing activation events prevented extension from loading when clicking activity bar

## [1.1.4] - 2024-01-09

### 🐛 Fixed
- Fixed activity bar icon path to use SVG instead of PNG
- Added view icon and contextual title

## [1.1.3] - 2024-01-08

### ✨ Added
- Initial public release
- AES-256-GCM encrypted workspace history
- Quick workspace switching with keyboard shortcuts
- Sidebar dashboard with webview
- Auto-resume last workspace
- Sensitive workspace protection
- Custom workspace nicknames

### 🔒 Security
- Completely offline, no network requests
- Encrypted workspace paths using VS Code SecretStorage
- No telemetry or tracking

---

## Version History Summary

- **1.3.0** - Renamed to Warpspace; fixed delete button, sensitive-workspace bypass
  and missing confirmations; added CSP, stale entry detection and a real LICENSE
- **1.2.2** - Renamed from WorkSnap to SpaceShift
- **1.1.9** - Responsive CSS fixes, README encoding fix, project cleanup
- **1.1.5** - Production fixes (icons, activation, sidebar rendering)
- **1.1.4** - Icon path fixes
- **1.1.3** - Initial release
