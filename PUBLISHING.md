# Publishing Checklist for WorkSnap

## 🚨 CRITICAL: Why Debug Works But Production Doesn't

### Common Issues:
1. **Missing assets in `.vsix`** - `.vscodeignore` excludes files
2. **Colored icons** - Activity bar icons must be monochrome
3. **Missing activation events** - Extension won't load when needed
4. **Wrong resource paths** - Must use `webview.asWebviewUri()`

---

## ✅ Pre-Publish Checklist

### 1. Update Version Number
- [ ] Update `version` in `package.json`
- [ ] Update `CHANGELOG.md` with changes
- [ ] Commit version bump

### 2. Verify `.vscodeignore`
- [ ] Check that required assets are NOT excluded
- [ ] Codicons must be included: `!node_modules/@vscode/codicons/**`
- [ ] Media files must be included
- [ ] Verify with: `npm run package` and check output

### 3. Test Icon Rendering
- [ ] Activity bar icon is **monochrome SVG** using `currentColor`
- [ ] Icon viewBox is `0 0 16 16` (standard size)
- [ ] No colored strokes or fills in SVG
- [ ] Test in both light and dark themes

### 4. Verify Activation Events
```json
"activationEvents": [
  "onView:worksnap.sidebarView",
  "onStartupFinished"
]
```
- [ ] Activation events are present
- [ ] Extension activates when clicking activity bar icon
- [ ] Extension activates on startup if needed

### 5. Test Webview Resources
- [ ] All CSS/fonts load in webview
- [ ] Icons render correctly (codicons)
- [ ] Images load correctly
- [ ] Check browser console for 404 errors

### 6. Build & Package
```bash
npm run compile
npm run package
```
- [ ] No build errors
- [ ] Check package size (should be ~800KB with codicons)
- [ ] Verify `.vsix` contains `node_modules/@vscode/codicons/`

### 7. Test Installed Extension
- [ ] Uninstall old version
- [ ] Install from `.vsix` file
- [ ] Reload VS Code
- [ ] Test ALL features:
  - [ ] Activity bar icon shows
  - [ ] Sidebar opens and renders correctly
  - [ ] Icons (edit/delete) are visible
  - [ ] Workspace switching works
  - [ ] Commands work from palette

### 8. Compare Debug vs Production
- [ ] Open Extension Development Host (F5)
- [ ] Open regular VS Code with installed extension
- [ ] UI should look **identical** in both
- [ ] If different, check console for errors

### 9. Final Checks
- [ ] README.md is up to date
- [ ] CHANGELOG.md documents changes
- [ ] Screenshots are current
- [ ] License file exists
- [ ] Repository URL is correct

### 10. Publish
```bash
vsce publish
```
- [ ] Publish to marketplace
- [ ] Create GitHub release
- [ ] Tag version in git
- [ ] Update marketplace description if needed

---

## 🔍 Debugging Production Issues

### Icons Not Showing?
1. Check `.vscodeignore` - codicons must be included
2. Verify package contains `node_modules/@vscode/codicons/`
3. Check webview `localResourceRoots` includes codicons path
4. Check browser console for 404 errors

### Extension Not Activating?
1. Check `activationEvents` in `package.json`
2. Add `onView:yourViewId` for sidebar views
3. Add `onStartupFinished` for startup activation
4. Check VS Code version compatibility

### Webview Blank?
1. Check `resolveWebviewView()` is called
2. Verify `webview.html` is set
3. Check `enableScripts: true` in webview options
4. Check browser console for errors

### Activity Bar Icon Missing?
1. Icon must be **monochrome SVG**
2. Use `fill="currentColor"` or pure black/white
3. No colored strokes (`stroke="#007acc"` won't work)
4. ViewBox should be `0 0 16 16`

---

## 📦 What Gets Packaged?

### Included:
- `dist/` - Compiled extension code
- `media/` - Icons, images
- `node_modules/@vscode/codicons/` - Icon fonts (via `.vscodeignore` exception)
- `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`

### Excluded (via `.vscodeignore`):
- `src/` - TypeScript source
- `node_modules/**` (except codicons)
- `.vscode/`, `.vscode-test/`
- `*.ts`, `*.map` files
- Build scripts

---

## 🎯 Quick Test Commands

```bash
# Build
npm run compile

# Package
npm run package

# Check package contents
vsce ls --tree

# Publish (dry run)
vsce publish --dry-run

# Publish for real
vsce publish
```

---

## 📝 Notes

- Always test the **installed** extension, not just debug mode
- Debug mode is more forgiving and loads files differently
- Production uses only what's in the `.vsix` package
- When in doubt, check the package contents with `vsce ls --tree`

