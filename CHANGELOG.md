# Change Log

All notable changes to WorkSnap will be documented in this file.

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

- **1.1.5** - Production fixes (icons, activation, sidebar rendering)
- **1.1.4** - Icon path fixes
- **1.1.3** - Initial release
