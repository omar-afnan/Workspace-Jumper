"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
//  CONSTANTS
const STORAGE_KEY = 'workspace-jumper.workspaces';
const ENCRYPTION_KEY_ID = 'workspace-jumper.encryptionKey';
const MAX_HISTORY = 10;
const ALGORITHM = 'aes-256-gcm';
// Cache for encryption key to avoid repeated SecretStorage calls
let encryptionKeyCache = null;
//  ENCRYPTION HELPERS 
// Generate a random encryption key
function generateEncryptionKey() {
    return crypto.randomBytes(32).toString('hex');
}
// Get or create encryption key using SecretStorage (with caching)
async function getEncryptionKey(secrets) {
    if (encryptionKeyCache) {
        return encryptionKeyCache;
    }
    let key = await secrets.get(ENCRYPTION_KEY_ID);
    if (!key) {
        key = generateEncryptionKey();
        await secrets.store(ENCRYPTION_KEY_ID, key);
    }
    encryptionKeyCache = key;
    return key;
}
// Encrypt a string using AES-256-GCM
function encrypt(text, keyHex) {
    const key = Buffer.from(keyHex, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    // Format: iv:authTag:encryptedData
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}
// Decrypt a string using AES-256-GCM
function decrypt(encryptedData, keyHex) {
    try {
        const key = Buffer.from(keyHex, 'hex');
        const parts = encryptedData.split(':');
        if (parts.length !== 3) {
            throw new Error('Invalid encrypted data format');
        }
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
    catch (error) {
        console.error('Decryption failed:', error);
        return '';
    }
}
// Generate unique ID for workspace
function generateId() {
    return crypto.randomBytes(8).toString('hex');
}
//  CONFIGURATION HELPERS 
function getConfig() {
    const config = vscode.workspace.getConfiguration('worksnap');
    return {
        autoResumeEnabled: config.get('autoResumeEnabled', true),
        maxHistory: config.get('maxHistory', MAX_HISTORY)
    };
}
//  MAIN EXTENSION 
function activate(context) {
    console.log('WorkSnap activated - Privacy-focused workspace manager');
    const secrets = context.secrets;
    const config = getConfig();
    // Preload encryption key for instant first-time access
    getEncryptionKey(secrets).catch(err => {
        console.error('Failed to preload encryption key:', err);
    });
    // Status bar button
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.text = '$(briefcase) WorkSnap';
    statusBar.tooltip = 'Jump to Workspace (Ctrl+Alt+W)';
    statusBar.command = 'workspace-jumper.jump';
    statusBar.show();
    context.subscriptions.push(statusBar);
    // Auto-resume last workspace (if enabled and VS Code opened without folder)
    if (config.autoResumeEnabled && !vscode.workspace.workspaceFolders?.length) {
        handleAutoResume(context, secrets);
    }
    // Register main jump command
    const jumpCommand = vscode.commands.registerCommand('workspace-jumper.jump', async () => {
        await saveCurrentWorkspace(context, secrets);
        await showWorkspacePicker(context, secrets);
    });
    // Register command to edit workspace (nickname, sensitive flag)
    const editCommand = vscode.commands.registerCommand('workspace-jumper.editWorkspace', async () => {
        await editWorkspace(context, secrets);
    });
    // Register command to remove a workspace from history
    const removeCommand = vscode.commands.registerCommand('workspace-jumper.removeWorkspace', async () => {
        await removeWorkspace(context, secrets);
    });
    // Register command to clear all workspace history
    const clearCommand = vscode.commands.registerCommand('workspace-jumper.clearHistory', async () => {
        const confirm = await vscode.window.showWarningMessage('Are you sure you want to clear all workspace history?', 'Yes', 'No');
        if (confirm === 'Yes') {
            await context.globalState.update(STORAGE_KEY, []);
            vscode.window.showInformationMessage('Workspace history cleared.');
        }
    });
    // Register command to toggle sensitive flag on current workspace
    const toggleSensitiveCommand = vscode.commands.registerCommand('workspace-jumper.toggleSensitive', async () => {
        await toggleCurrentWorkspaceSensitive(context, secrets);
    });
    context.subscriptions.push(jumpCommand, editCommand, removeCommand, clearCommand, toggleSensitiveCommand);
    // Register dashboard webview command (WorkSnap Dashboard)
    context.subscriptions.push(vscode.commands.registerCommand('worksnap.openDashboard', () => {
        openDashboard(context);
    }));
    // Register a sidebar view provider so the dashboard appears in the left Activity Bar
    class WorkSnapViewProvider {
        ctx;
        _view;
        constructor(ctx) {
            this.ctx = ctx;
        }
        async resolveWebviewView(webviewView) {
            this._view = webviewView;
            webviewView.webview.options = { enableScripts: true };
            await this.refreshView();
            webviewView.webview.onDidReceiveMessage(async (msg) => {
                switch (msg.type) {
                    case 'resume':
                        vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(msg.path), false);
                        break;
                    case 'clear':
                        await this.ctx.globalState.update(STORAGE_KEY, []);
                        await this.refreshView();
                        vscode.window.showInformationMessage('WorkSnap: All workspace history cleared');
                        break;
                    case 'remove':
                        {
                            const list = this.ctx.globalState.get(STORAGE_KEY, []);
                            const filtered = list.filter(w => w.id !== msg.id);
                            await this.ctx.globalState.update(STORAGE_KEY, filtered);
                            await this.refreshView();
                            vscode.window.showInformationMessage('WorkSnap: Workspace removed');
                        }
                        break;
                    case 'addCurrent':
                        {
                            const folders = vscode.workspace.workspaceFolders;
                            if (!folders || folders.length === 0) {
                                vscode.window.showWarningMessage('No folder is currently open.');
                                return;
                            }
                            const folderPath = folders[0].uri.fsPath;
                            const secrets = this.ctx.secrets;
                            const key = await getEncryptionKey(secrets);
                            const list = this.ctx.globalState.get(STORAGE_KEY, []);
                            // Check if workspace already exists
                            const existing = list.find(ws => decrypt(ws.encryptedPath, key) === folderPath);
                            if (existing) {
                                vscode.window.showInformationMessage(`WorkSnap: "${existing.nickname}" is already in your workspace history`);
                                return;
                            }
                            // Ask for nickname
                            const nickname = await vscode.window.showInputBox({
                                prompt: 'Enter a nickname for this workspace',
                                value: folderPath.split(/[\\/]/).pop() || 'Workspace',
                                validateInput: (val) => val.trim() ? null : 'Nickname cannot be empty'
                            });
                            if (!nickname)
                                return;
                            const encrypted = encrypt(folderPath, key);
                            const newSession = {
                                id: crypto.randomBytes(8).toString('hex'),
                                nickname: nickname.trim(),
                                encryptedPath: encrypted,
                                lastOpened: new Date().toISOString(),
                                isSensitive: false
                            };
                            const maxHistory = vscode.workspace.getConfiguration('worksnap').get('maxHistory', 10);
                            const updated = [newSession, ...list].slice(0, maxHistory);
                            await this.ctx.globalState.update(STORAGE_KEY, updated);
                            await this.refreshView();
                            vscode.window.showInformationMessage(`WorkSnap: Added "${nickname}" to workspace history`);
                        }
                        break;
                    case 'edit':
                        {
                            const list = this.ctx.globalState.get(STORAGE_KEY, []);
                            const workspace = list.find(w => w.id === msg.id);
                            if (!workspace)
                                return;
                            const choice = await vscode.window.showQuickPick([
                                { label: '$(edit) Edit Nickname', action: 'nickname' },
                                { label: `$(${workspace.isSensitive ? 'unlock' : 'lock'}) ${workspace.isSensitive ? 'Remove' : 'Mark as'} Sensitive`, action: 'sensitive' }
                            ], { placeHolder: `Edit "${workspace.nickname}"` });
                            if (!choice)
                                return;
                            if (choice.action === 'nickname') {
                                const newName = await vscode.window.showInputBox({
                                    prompt: 'Enter new nickname',
                                    value: workspace.nickname,
                                    validateInput: (val) => val.trim() ? null : 'Nickname cannot be empty'
                                });
                                if (!newName)
                                    return;
                                workspace.nickname = newName.trim();
                            }
                            else if (choice.action === 'sensitive') {
                                workspace.isSensitive = !workspace.isSensitive;
                            }
                            await this.ctx.globalState.update(STORAGE_KEY, list);
                            await this.refreshView();
                            vscode.window.showInformationMessage('WorkSnap: Workspace updated');
                        }
                        break;
                }
            });
        }
        async refreshView() {
            if (!this._view)
                return;
            const secrets = this.ctx.secrets;
            const encryptionKey = await getEncryptionKey(secrets);
            const workspaces = this.ctx.globalState.get(STORAGE_KEY, []);
            const rows = workspaces.map(ws => {
                const decrypted = decrypt(ws.encryptedPath, encryptionKey) || '';
                return `
					<div class="card">
						<div class="title">${folderIcon(5)} ${escapeHtml(ws.nickname)} ${ws.isSensitive ? lockIcon() : ''}</div>
						<div class="path">${escapeHtml(ws.nickname)}</div>
						<div class="actions">
							<button data-path="${encodeURIComponent(decrypted)}" onclick="resume(this)">${playIcon()} Resume</button>
							<button onclick="edit('${ws.id}')">${editIcon()} Edit</button>
							<button onclick="remove('${ws.id}')">${removeIcon()}</button>
						</div>
					</div>
				`;
            }).join('');
            this._view.webview.html = getDashboardHtml(this._view.webview, this.ctx, rows);
        }
    }
    const provider = new WorkSnapViewProvider(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('worksnap.sidebarView', provider));
    // Command to reveal the WorkSnap activity bar container (focus the left side view)
    context.subscriptions.push(vscode.commands.registerCommand('worksnap.openSidebar', async () => {
        try {
            await vscode.commands.executeCommand('workbench.view.extension.worksnap');
        }
        catch (e) {
            // fallback: try opening view directly
            await vscode.commands.executeCommand('workbench.action.openView', 'worksnap.sidebarView');
        }
    }));
    // Development-only: auto-reload Extension Development Host when source files change
    if (context.extensionMode === vscode.ExtensionMode.Development) {
        try {
            // Watch common source folders and key files. Debounce to avoid rapid reloads.
            const watcher = vscode.workspace.createFileSystemWatcher('**/{src,dist,media,package.json,tsconfig.json}/**/*');
            let reloadTimer = undefined;
            const scheduleReload = () => {
                if (reloadTimer)
                    clearTimeout(reloadTimer);
                reloadTimer = setTimeout(async () => {
                    try {
                        vscode.window.showInformationMessage('WorkSnap: source changed — reloading Extension Development Host...');
                        await vscode.commands.executeCommand('workbench.action.reloadWindow');
                    }
                    catch (e) {
                        console.error('Auto-reload failed:', e);
                    }
                }, 600);
            };
            watcher.onDidChange(scheduleReload);
            watcher.onDidCreate(scheduleReload);
            watcher.onDidDelete(scheduleReload);
            context.subscriptions.push(watcher);
        }
        catch (err) {
            console.error('Failed to enable dev auto-reload watcher:', err);
        }
    }
}
//  DASHBOARD WEBVIEW 
async function openDashboard(context) {
    const panel = vscode.window.createWebviewPanel('worksnapDashboard', 'WorkSnap', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
    const refreshDashboard = async () => {
        const secrets = context.secrets;
        const encryptionKey = await getEncryptionKey(secrets);
        const workspaces = context.globalState.get(STORAGE_KEY, []);
        const rows = workspaces.map(ws => {
            const decrypted = decrypt(ws.encryptedPath, encryptionKey) || '';
            return `
				<div class="card">
					<div class="title">${folderIcon()} ${escapeHtml(ws.nickname)} ${ws.isSensitive ? lockIcon() : ''}</div>
					<div class="path">${escapeHtml(ws.nickname)}</div>
					<div class="actions">
						<button data-path="${encodeURIComponent(decrypted)}" onclick="resume(this)">${playIcon()} Resume</button>
						<button onclick="edit('${ws.id}')">${editIcon()} Edit</button>
						<button onclick="remove('${ws.id}')">${removeIcon()}</button>
					</div>
				</div>
			`;
        }).join('');
        panel.webview.html = getDashboardHtml(panel.webview, context, rows);
    };
    await refreshDashboard();
    panel.webview.onDidReceiveMessage(async (msg) => {
        switch (msg.type) {
            case 'resume':
                vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(msg.path), false);
                break;
            case 'clear':
                await context.globalState.update(STORAGE_KEY, []);
                await refreshDashboard();
                vscode.window.showInformationMessage('WorkSnap: All workspace history cleared');
                break;
            case 'remove':
                {
                    const list = context.globalState.get(STORAGE_KEY, []);
                    const filtered = list.filter(w => w.id !== msg.id);
                    await context.globalState.update(STORAGE_KEY, filtered);
                    await refreshDashboard();
                    vscode.window.showInformationMessage('WorkSnap: Workspace removed');
                }
                break;
            case 'addCurrent':
                {
                    const folders = vscode.workspace.workspaceFolders;
                    if (!folders || folders.length === 0) {
                        vscode.window.showWarningMessage('No folder is currently open.');
                        return;
                    }
                    const folderPath = folders[0].uri.fsPath;
                    const secrets = context.secrets;
                    const key = await getEncryptionKey(secrets);
                    const list = context.globalState.get(STORAGE_KEY, []);
                    // Check if workspace already exists
                    const existing = list.find(ws => decrypt(ws.encryptedPath, key) === folderPath);
                    if (existing) {
                        vscode.window.showInformationMessage(`WorkSnap: "${existing.nickname}" is already in your workspace history`);
                        return;
                    }
                    // Ask for nickname
                    const nickname = await vscode.window.showInputBox({
                        prompt: 'Enter a nickname for this workspace',
                        value: folderPath.split(/[\\/]/).pop() || 'Workspace',
                        validateInput: (val) => val.trim() ? null : 'Nickname cannot be empty'
                    });
                    if (!nickname)
                        return;
                    const encrypted = encrypt(folderPath, key);
                    const newSession = {
                        id: crypto.randomBytes(8).toString('hex'),
                        nickname: nickname.trim(),
                        encryptedPath: encrypted,
                        lastOpened: new Date().toISOString(),
                        isSensitive: false
                    };
                    const maxHistory = vscode.workspace.getConfiguration('worksnap').get('maxHistory', 10);
                    const updated = [newSession, ...list].slice(0, maxHistory);
                    await context.globalState.update(STORAGE_KEY, updated);
                    await refreshDashboard();
                    vscode.window.showInformationMessage(`WorkSnap: Added "${nickname}" to workspace history`);
                }
                break;
            case 'edit':
                {
                    const list = context.globalState.get(STORAGE_KEY, []);
                    const workspace = list.find(w => w.id === msg.id);
                    if (!workspace)
                        return;
                    const choice = await vscode.window.showQuickPick([
                        { label: '$(edit) Edit Nickname', action: 'nickname' },
                        { label: `$(${workspace.isSensitive ? 'unlock' : 'lock'}) ${workspace.isSensitive ? 'Remove' : 'Mark as'} Sensitive`, action: 'sensitive' }
                    ], { placeHolder: `Edit "${workspace.nickname}"` });
                    if (!choice)
                        return;
                    if (choice.action === 'nickname') {
                        const newName = await vscode.window.showInputBox({
                            prompt: 'Enter new nickname',
                            value: workspace.nickname,
                            validateInput: (val) => val.trim() ? null : 'Nickname cannot be empty'
                        });
                        if (!newName)
                            return;
                        workspace.nickname = newName.trim();
                    }
                    else if (choice.action === 'sensitive') {
                        workspace.isSensitive = !workspace.isSensitive;
                    }
                    await context.globalState.update(STORAGE_KEY, list);
                    await refreshDashboard();
                    vscode.window.showInformationMessage('WorkSnap: Workspace updated');
                }
                break;
        }
    });
}
function getDashboardHtml(webview, context, rows) {
    return `<!DOCTYPE html>
	<html>
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<style>
			body { font-family: sans-serif; background: #0f172a; color: #e5e7eb; padding: 16px; }
			h2 { margin: 0 0 6px 0 }
			.card { background: #1e293b; padding: 12px; margin-bottom: 10px; border-radius: 10px; }
			.title { font-weight: 600; margin-bottom: 4px }
			.path { color: #94a3b8; font-size: 12px; margin-bottom: 8px }
			.actions { display: flex; gap: 8px }
			button { background: #3b82f6; color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer }
			.footer {
            margin-top: 12px;
            display:flex;
            gap:10px }
			.small {
            background: #334155;
            padding:8px 10px;
            border-radius:8px }
		</style>
	</head>
	<body>
		<h2> WorkSnap</h2>
		<p>Jump between workspaces instantly</p>
		${rows || '<p>No workspaces saved.</p>'}
		<div class="footer">
			<button class="small" onclick="addCurrent()"> Add Current Workspace</button>
			<button class="small" onclick="clearAll()"> Clear History</button>
		</div>
		<script>
			const vscode = acquireVsCodeApi();
			function resume(el) {
				const p = decodeURIComponent(el.getAttribute('data-path'));
				vscode.postMessage({ type: 'resume', path: p });
			}
			function clearAll() { vscode.postMessage({ type: 'clear' }); }
			function remove(id) { vscode.postMessage({ type: 'remove', id }); }
			function edit(id) { vscode.postMessage({ type: 'edit', id }); }
			function addCurrent() { vscode.postMessage({ type: 'addCurrent' }); }
		</script>
	</body>
	</html>`;
}
function escapeHtml(input) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };
    return input.replace(/[&<>"']/g, (c) => map[c] ?? c);
}
// Inline SVG icons (offline-friendly)
function folderIcon() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;margin-right:6px"><path d="M3 7C3 5.89543 3.89543 5 5 5H9L11 7H19C20.1046 7 21 7.89543 21 9V18C21 19.1046 20.1046 20 19 20H5C3.89543 20 3 19.1046 3 18V7Z" fill="#90cdf4"/></svg>`;
}
function lockIcon() {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;margin-left:6px"><path d="M17 9H16V7C16 4.79086 14.2091 3 12 3C9.79086 3 8 4.79086 8 7V9H7C5.89543 9 5 9.89543 5 11V19C5 20.1046 5.89543 21 7 21H17C18.1046 21 19 20.1046 19 19V11C19 9.89543 18.1046 9 17 9ZM10 9V7C10 5.89543 10.8954 5 12 5C13.1046 5 14 5.89543 14 7V9H10Z" fill="#f6ad55"/></svg>`;
}
function playIcon() {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;margin-right:6px"><path d="M8 5V19L19 12L8 5Z" fill="#86efac"/></svg>`;
}
function editIcon() {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;margin-right:6px"><path d="M3 17.25V21H6.75L17.81 9.94L14.06 6.19L3 17.25Z" fill="#c7b9ff"/><path d="M20.71 7.04C21.1 6.65 21.1 6.02 20.71 5.63L18.37 3.29C17.98 2.9 17.35 2.9 16.96 3.29L15.13 5.12L18.88 8.87L20.71 7.04Z" fill="#c7b9ff"/></svg>`;
}
function removeIcon() {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle"><path d="M9 3H15L16 5H21V7H3V5H8L9 3Z" fill="#f87171"/><path d="M6 9H18V19C18 20.1046 17.1046 21 16 21H8C6.89543 21 6 20.1046 6 19V9Z" fill="#fecaca"/></svg>`;
}
//  AUTO-RESUME 
async function handleAutoResume(context, secrets) {
    const workspaces = context.globalState.get(STORAGE_KEY, []);
    if (workspaces.length === 0)
        return;
    const lastWorkspace = workspaces[0];
    const encryptionKey = await getEncryptionKey(secrets);
    const workspacePath = decrypt(lastWorkspace.encryptedPath, encryptionKey);
    if (!workspacePath)
        return;
    // Check if sensitive - ask for confirmation
    if (lastWorkspace.isSensitive) {
        const confirm = await vscode.window.showWarningMessage(`Resume sensitive workspace "${lastWorkspace.nickname}"?`, 'Yes', 'No');
        if (confirm !== 'Yes')
            return;
    }
    // Open workspace immediately (no artificial delay)
    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspacePath), false);
}
//  SAVE WORKSPACE 
async function saveCurrentWorkspace(context, secrets) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0)
        return;
    const folderPath = folders[0].uri.fsPath;
    const folderName = path.basename(folderPath);
    const encryptionKey = await getEncryptionKey(secrets);
    const config = getConfig();
    const workspaces = context.globalState.get(STORAGE_KEY, []);
    // Optimization: Decrypt all paths in one batch to check for duplicates
    let existingIndex = -1;
    let existingWorkspace = null;
    // Decrypt all paths at once for comparison
    const decryptedPaths = workspaces.map(ws => decrypt(ws.encryptedPath, encryptionKey));
    for (let i = 0; i < decryptedPaths.length; i++) {
        if (decryptedPaths[i] === folderPath) {
            existingIndex = i;
            existingWorkspace = workspaces[i];
            break;
        }
    }
    // Remove existing entry if found
    const filtered = existingIndex >= 0
        ? workspaces.filter((_, idx) => idx !== existingIndex)
        : workspaces;
    // Create new entry (preserve nickname and sensitive flag if existed)
    const newEntry = {
        id: existingWorkspace?.id || generateId(),
        nickname: existingWorkspace?.nickname || folderName,
        encryptedPath: encrypt(folderPath, encryptionKey),
        lastOpened: new Date().toISOString(),
        isSensitive: existingWorkspace?.isSensitive || false
    };
    // Add to front
    filtered.unshift(newEntry);
    // Keep only max history
    await context.globalState.update(STORAGE_KEY, filtered.slice(0, config.maxHistory));
}
//  WORKSPACE PICKER 
async function showWorkspacePicker(context, secrets) {
    const workspaces = context.globalState.get(STORAGE_KEY, []);
    if (workspaces.length === 0) {
        vscode.window.showInformationMessage('No saved workspaces yet. Open a folder to add it to history.');
        return;
    }
    // Build quick pick items WITHOUT decrypting paths yet (lazy decryption)
    const items = workspaces.map(ws => {
        const sensitiveIcon = ws.isSensitive ? '$(lock) ' : '';
        return {
            label: `${sensitiveIcon}${ws.nickname}`,
            description: ws.isSensitive ? '(sensitive)' : '',
            detail: `Last opened: ${new Date(ws.lastOpened).toLocaleString()}`,
            workspace: ws
        };
    });
    const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a workspace to open',
        matchOnDescription: false
    });
    if (!pick)
        return;
    // Confirm if sensitive
    if (pick.workspace.isSensitive) {
        const confirm = await vscode.window.showWarningMessage(`This workspace is marked as sensitive. Open "${pick.workspace.nickname}"?`, 'Yes', 'No');
        if (confirm !== 'Yes')
            return;
    }
    // Only decrypt the selected workspace path
    const encryptionKey = await getEncryptionKey(secrets);
    const workspacePath = decrypt(pick.workspace.encryptedPath, encryptionKey);
    if (!workspacePath) {
        vscode.window.showErrorMessage('Failed to decrypt workspace path');
        return;
    }
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspacePath), false);
}
//  EDIT WORKSPACE 
async function editWorkspace(context, secrets) {
    const workspaces = context.globalState.get(STORAGE_KEY, []);
    if (workspaces.length === 0) {
        vscode.window.showInformationMessage('No workspaces to edit.');
        return;
    }
    const encryptionKey = await getEncryptionKey(secrets);
    // Select workspace to edit
    const items = workspaces.map(ws => ({
        label: ws.nickname,
        description: ws.isSensitive ? '$(lock) sensitive' : '',
        workspace: ws
    }));
    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a workspace to edit'
    });
    if (!selected)
        return;
    // Choose what to edit
    const action = await vscode.window.showQuickPick([
        { label: '$(edit) Edit Nickname', action: 'nickname' },
        { label: selected.workspace.isSensitive ? '$(unlock) Remove Sensitive Flag' : '$(lock) Mark as Sensitive', action: 'sensitive' }
    ], {
        placeHolder: 'What would you like to edit?'
    });
    if (!action)
        return;
    const wsIndex = workspaces.findIndex(w => w.id === selected.workspace.id);
    if (wsIndex < 0)
        return;
    if (action.action === 'nickname') {
        const newNickname = await vscode.window.showInputBox({
            prompt: 'Enter a new nickname for this workspace',
            value: selected.workspace.nickname,
            validateInput: (value) => value.trim() ? null : 'Nickname cannot be empty'
        });
        if (newNickname) {
            workspaces[wsIndex].nickname = newNickname.trim();
            await context.globalState.update(STORAGE_KEY, workspaces);
            vscode.window.showInformationMessage(`Workspace renamed to "${newNickname}"`);
        }
    }
    else if (action.action === 'sensitive') {
        workspaces[wsIndex].isSensitive = !workspaces[wsIndex].isSensitive;
        await context.globalState.update(STORAGE_KEY, workspaces);
        const status = workspaces[wsIndex].isSensitive ? 'marked as sensitive' : 'no longer marked as sensitive';
        vscode.window.showInformationMessage(`Workspace "${selected.workspace.nickname}" is now ${status}`);
    }
}
//  REMOVE WORKSPACE 
async function removeWorkspace(context, secrets) {
    const workspaces = context.globalState.get(STORAGE_KEY, []);
    if (workspaces.length === 0) {
        vscode.window.showInformationMessage('No workspaces to remove.');
        return;
    }
    const items = workspaces.map(ws => ({
        label: ws.nickname,
        description: ws.isSensitive ? '$(lock) sensitive' : '',
        workspace: ws
    }));
    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a workspace to remove from history'
    });
    if (!selected)
        return;
    const filtered = workspaces.filter(w => w.id !== selected.workspace.id);
    await context.globalState.update(STORAGE_KEY, filtered);
    vscode.window.showInformationMessage(`Workspace "${selected.workspace.nickname}" removed from history.`);
}
//  TOGGLE SENSITIVE ON CURRENT 
async function toggleCurrentWorkspaceSensitive(context, secrets) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showInformationMessage('No workspace currently open.');
        return;
    }
    const folderPath = folders[0].uri.fsPath;
    const encryptionKey = await getEncryptionKey(secrets);
    const workspaces = context.globalState.get(STORAGE_KEY, []);
    // Find current workspace
    let foundIndex = -1;
    for (let i = 0; i < workspaces.length; i++) {
        const decryptedPath = decrypt(workspaces[i].encryptedPath, encryptionKey);
        if (decryptedPath === folderPath) {
            foundIndex = i;
            break;
        }
    }
    if (foundIndex < 0) {
        vscode.window.showInformationMessage('Current workspace not in history. Use Jump to Workspace first.');
        return;
    }
    workspaces[foundIndex].isSensitive = !workspaces[foundIndex].isSensitive;
    await context.globalState.update(STORAGE_KEY, workspaces);
    const status = workspaces[foundIndex].isSensitive ? 'marked as sensitive 🔒' : 'no longer sensitive 🔓';
    vscode.window.showInformationMessage(`Current workspace is now ${status}`);
}
function deactivate() {
    // No network connections to close - fully offline extension
}
//# sourceMappingURL=extension.js.map
