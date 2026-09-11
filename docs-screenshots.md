# Screenshots

Images referenced by the root README, which becomes the marketplace detail page.

Expected files:

| File | Shows |
|------|-------|
| `quick-switcher.png` | The `Ctrl+Alt+W` Quick Pick listing saved workspaces |
| `dashboard.png` | The sidebar dashboard with several workspace cards |

## Capturing

- Use a dark theme; it matches how most people view the marketplace.
- Target ~1200px wide. Avoid full-desktop screenshots - crop to the panel.
- Use placeholder workspace nicknames. Real folder paths leak client and
  employer names, which is the exact thing this extension exists to protect.
- Include at least one workspace marked sensitive so the lock icon is visible.

Marketplace images must be reachable over HTTPS. Relative paths work because
the repository is public and vsce rewrites them to raw.githubusercontent.com
URLs at publish time.
