import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
	WorkspaceSession,
	generateEncryptionKey,
	encrypt,
	decrypt,
	generateId,
	escapeHtml,
	buildCardHtml
} from './utils';

// ─── INTERFACES ────────────────────────────────────────────────────────────────

interface WorkspaceConfig {
	autoResumeEnabled: boolean;
	maxHistory: number;
}

interface EditAction extends vscode.QuickPickItem {
	action: 'nickname' | 'sensitive';
}

interface WorkspacePickItem extends vscode.QuickPickItem {
	workspace: WorkspaceSession;
}

// ─── CONSTANTS ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'workspace-jumper.workspaces';
const ENCRYPTION_KEY_ID = 'workspace-jumper.encryptionKey';
const MAX_HISTORY = 10;

let encryptionKeyCache: string | null = null;

const workspaceHistoryChanged = new vscode.EventEmitter<void>();
export const onWorkspaceHistoryChanged = workspaceHistoryChanged.event;

// ─── ENCRYPTION ────────────────────────────────────────────────────────────────

async function getEncryptionKey(secrets: vscode.SecretStorage): Promise<string> {
	if (encryptionKeyCache) { return encryptionKeyCache; }
	let key = await secrets.get(ENCRYPTION_KEY_ID);
	if (!key) {
		key = generateEncryptionKey();
		await secrets.store(ENCRYPTION_KEY_ID, key);
	}
	encryptionKeyCache = key;
	return key;
}

// ─── CONFIG ────────────────────────────────────────────────────────────────────

function getConfig(): WorkspaceConfig {
	const config = vscode.workspace.getConfiguration('worksnap');
	return {
		autoResumeEnabled: config.get<boolean>('autoResumeEnabled', true),
		maxHistory: config.get<number>('maxHistory', MAX_HISTORY)
	};
}


function getDashboardHtml(
	webview: vscode.Webview,
	context: vscode.ExtensionContext,
	rows: string
): string {
	const codiconsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css')
	);
	const fontUri = webview.asWebviewUri(
		vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.ttf')
	);
	const clipboardIconUri = webview.asWebviewUri(
		vscode.Uri.joinPath(context.extensionUri, 'media', 'Clipboard-Task-Pending-Action--Streamline-Plump.png')
	);

	const cssPath = path.join(context.extensionPath, 'media', 'dashboard.css');
	const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';

	const emptyState = `
		<div class="empty-state">
			<div class="codicon codicon-folder-opened"></div>
			<p>No workspaces saved yet.</p>
		</div>`;

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<link href="${codiconsUri}" rel="stylesheet" />
	<style>
		@font-face { font-family: 'codicon'; src: url('${fontUri}') format('truetype'); }
		.sensitive-icon { color: #f59e0b; }
		${css}
	</style>
</head>
<body>
	<div class="header">
		<h2>
			<img src="${clipboardIconUri}" width="24" height="24" style="vertical-align:middle;margin-right:8px;display:inline-block" alt="SpaceShift">
			SpaceShift
		</h2>
		<p>Jump between workspaces instantly</p>
	</div>

	${rows || emptyState}

	<div class="footer">
		<button onclick="addCurrent()">
			<span class="codicon codicon-add"></span> Add Current Workspace
		</button>
		<button onclick="clearAll()">
			<span class="codicon codicon-clear-all"></span> Clear History
		</button>
	</div>

	<script>
		const vscode = acquireVsCodeApi();
		function resume(el) {
			vscode.postMessage({ type: 'resume', path: decodeURIComponent(el.getAttribute('data-path')) });
		}
		function clearAll() { vscode.postMessage({ type: 'clear' }); }
		function remove(id) { vscode.postMessage({ type: 'remove', id }); }
		function edit(id) { vscode.postMessage({ type: 'edit', id }); }
		function addCurrent() { vscode.postMessage({ type: 'addCurrent' }); }
	</script>
</body>
</html>`;
}

// ─── WEBVIEW MESSAGE HANDLER ───────────────────────────────────────────────────

async function handleWebviewMessage(
	msg: { type: string; path?: string; id?: string },
	context: vscode.ExtensionContext,
	refresh: () => Promise<void>
): Promise<void> {
	switch (msg.type) {
		case 'resume':
			if (msg.path) {
				vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(msg.path), false);
			}
			break;

		case 'clear':
			await context.globalState.update(STORAGE_KEY, []);
			await refresh();
			vscode.window.showInformationMessage('SpaceShift: All workspace history cleared');
			break;

		case 'remove': {
			const list = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);
			await context.globalState.update(STORAGE_KEY, list.filter(w => w.id !== msg.id));
			await refresh();
			vscode.window.showInformationMessage('SpaceShift: Workspace removed');
			break;
		}

		case 'addCurrent': {
			const folders = vscode.workspace.workspaceFolders;
			if (!folders || folders.length === 0) {
				vscode.window.showWarningMessage('No folder is currently open.');
				return;
			}
			const folderPath = folders[0].uri.fsPath;
			const key = await getEncryptionKey(context.secrets);
			const list = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);
			const existing = list.find(ws => decrypt(ws.encryptedPath, key) === folderPath);
			if (existing) {
				vscode.window.showInformationMessage(`SpaceShift: "${existing.nickname}" is already in your workspace history`);
				return;
			}
			const nickname = await vscode.window.showInputBox({
				prompt: 'Enter a nickname for this workspace',
				value: folderPath.split(/[\\/]/).pop() || 'Workspace',
				validateInput: (val) => val.trim() ? null : 'Nickname cannot be empty'
			});
			if (!nickname) { return; }
			const newSession: WorkspaceSession = {
				id: generateId(),
				nickname: nickname.trim(),
				encryptedPath: encrypt(folderPath, key),
				lastOpened: new Date().toISOString(),
				isSensitive: false
			};
			const maxHistory = vscode.workspace.getConfiguration('worksnap').get<number>('maxHistory', MAX_HISTORY);
			await context.globalState.update(STORAGE_KEY, [newSession, ...list].slice(0, maxHistory));
			await refresh();
			vscode.window.showInformationMessage(`SpaceShift: Added "${nickname}" to workspace history`);
			break;
		}

		case 'edit': {
			const list = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);
			const workspace = list.find(w => w.id === msg.id);
			if (!workspace) { return; }

			const sensitiveLabel = workspace.isSensitive ? '$(unlock) Remove Sensitive Flag' : '$(lock) Mark as Sensitive';
			const choice = await vscode.window.showQuickPick<EditAction>([
				{ label: '$(edit) Edit Nickname', action: 'nickname' },
				{ label: sensitiveLabel, action: 'sensitive' }
			], { placeHolder: `Edit "${workspace.nickname}"` });

			if (!choice) { return; }

			if (choice.action === 'nickname') {
				const newName = await vscode.window.showInputBox({
					prompt: 'Enter new nickname',
					value: workspace.nickname,
					validateInput: (val) => val.trim() ? null : 'Nickname cannot be empty'
				});
				if (!newName) { return; }
				workspace.nickname = newName.trim();
			} else {
				workspace.isSensitive = !workspace.isSensitive;
			}

			await context.globalState.update(STORAGE_KEY, list);
			await refresh();
			vscode.window.showInformationMessage('SpaceShift: Workspace updated');
			break;
		}
	}
}

// ─── SIDEBAR VIEW PROVIDER ─────────────────────────────────────────────────────

class SpaceShiftViewProvider implements vscode.WebviewViewProvider {
	private _view?: vscode.WebviewView;

	constructor(private readonly ctx: vscode.ExtensionContext) {
		onWorkspaceHistoryChanged(() => { this.refreshView(); });
	}

	public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
		this._view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.ctx.extensionUri, 'media'),
				vscode.Uri.joinPath(this.ctx.extensionUri, 'node_modules', '@vscode/codicons', 'dist')
			]
		};

		await this.refreshView();

		webviewView.webview.onDidReceiveMessage(async (msg) => {
			await handleWebviewMessage(msg, this.ctx, () => this.refreshView());
		});
	}

	async refreshView(): Promise<void> {
		if (!this._view) { return; }
		const encryptionKey = await getEncryptionKey(this.ctx.secrets);
		const workspaces = this.ctx.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);
		const rows = workspaces.map(ws => buildCardHtml(ws, decrypt(ws.encryptedPath, encryptionKey))).join('');
		this._view.webview.html = getDashboardHtml(this._view.webview, this.ctx, rows);
	}
}

// ─── DASHBOARD PANEL ───────────────────────────────────────────────────────────

async function openDashboard(context: vscode.ExtensionContext): Promise<void> {
	const panel = vscode.window.createWebviewPanel(
		'worksnapDashboard',
		'SpaceShift',
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [
				vscode.Uri.joinPath(context.extensionUri, 'media'),
				vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode/codicons', 'dist')
			]
		}
	);

	const refresh = async () => {
		const encryptionKey = await getEncryptionKey(context.secrets);
		const workspaces = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);
		const rows = workspaces.map(ws => buildCardHtml(ws, decrypt(ws.encryptedPath, encryptionKey))).join('');
		panel.webview.html = getDashboardHtml(panel.webview, context, rows);
	};

	await refresh();
	panel.webview.onDidReceiveMessage(async (msg) => {
		await handleWebviewMessage(msg, context, refresh);
	});
}

// ─── ACTIVATE ──────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
	const secrets = context.secrets;
	const config = getConfig();

	getEncryptionKey(secrets).catch(err => { console.error('Failed to preload encryption key:', err); });

	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBar.text = '$(briefcase) SpaceShift';
	statusBar.tooltip = 'Jump to Workspace (Ctrl+Alt+W)';
	statusBar.command = 'workspace-jumper.jump';
	statusBar.show();
	context.subscriptions.push(statusBar);

	if (config.autoResumeEnabled && !vscode.workspace.workspaceFolders?.length) {
		handleAutoResume(context, secrets);
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('workspace-jumper.jump', async () => {
			await saveCurrentWorkspace(context, secrets);
			await showWorkspacePicker(context, secrets);
		}),
		vscode.commands.registerCommand('workspace-jumper.editWorkspace', () => editWorkspace(context, secrets)),
		vscode.commands.registerCommand('workspace-jumper.removeWorkspace', () => removeWorkspace(context, secrets)),
		vscode.commands.registerCommand('workspace-jumper.clearHistory', async () => {
			const confirm = await vscode.window.showWarningMessage(
				'Clear all workspace history?', 'Yes', 'No'
			);
			if (confirm === 'Yes') {
				await context.globalState.update(STORAGE_KEY, []);
				workspaceHistoryChanged.fire();
				vscode.window.showInformationMessage('Workspace history cleared.');
			}
		}),
		vscode.commands.registerCommand('workspace-jumper.toggleSensitive', () => toggleCurrentWorkspaceSensitive(context, secrets)),
		vscode.commands.registerCommand('worksnap.openDashboard', () => openDashboard(context)),
		vscode.commands.registerCommand('worksnap.openSidebar', async () => {
			try {
				await vscode.commands.executeCommand('workbench.view.extension.worksnap');
			} catch {
				await vscode.commands.executeCommand('workbench.action.openView', 'worksnap.sidebarView');
			}
		})
	);

	const provider = new SpaceShiftViewProvider(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('worksnap.sidebarView', provider, {
			webviewOptions: { retainContextWhenHidden: true }
		}),
		workspaceHistoryChanged
	);

	if (context.extensionMode === vscode.ExtensionMode.Development) {
		try {
			const watcher = vscode.workspace.createFileSystemWatcher('**/{src,dist,media,package.json,tsconfig.json}/**/*');
			let reloadTimer: ReturnType<typeof setTimeout> | undefined;
			const scheduleReload = () => {
				if (reloadTimer) { clearTimeout(reloadTimer); }
				reloadTimer = setTimeout(async () => {
					vscode.window.showInformationMessage('SpaceShift: source changed — reloading...');
					await vscode.commands.executeCommand('workbench.action.reloadWindow');
				}, 600);
			};
			watcher.onDidChange(scheduleReload);
			watcher.onDidCreate(scheduleReload);
			watcher.onDidDelete(scheduleReload);
			context.subscriptions.push(watcher);
		} catch (err) {
			console.error('Failed to enable dev auto-reload watcher:', err);
		}
	}
}

// ─── AUTO-RESUME ───────────────────────────────────────────────────────────────

async function handleAutoResume(context: vscode.ExtensionContext, secrets: vscode.SecretStorage): Promise<void> {
	const workspaces = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);
	if (workspaces.length === 0) { return; }

	const last = workspaces[0];
	const encryptionKey = await getEncryptionKey(secrets);
	const workspacePath = decrypt(last.encryptedPath, encryptionKey);
	if (!workspacePath) { return; }

	if (last.isSensitive) {
		const confirm = await vscode.window.showWarningMessage(
			`Resume sensitive workspace "${last.nickname}"?`, 'Yes', 'No'
		);
		if (confirm !== 'Yes') { return; }
	}

	vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspacePath), false);
}

// ─── SAVE WORKSPACE ────────────────────────────────────────────────────────────

async function saveCurrentWorkspace(context: vscode.ExtensionContext, secrets: vscode.SecretStorage): Promise<void> {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) { return; }

	const folderPath = folders[0].uri.fsPath;
	const encryptionKey = await getEncryptionKey(secrets);
	const config = getConfig();
	const workspaces = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);

	const decryptedPaths = workspaces.map(ws => decrypt(ws.encryptedPath, encryptionKey));
	const existingIndex = decryptedPaths.findIndex(p => p === folderPath);
	const existingWorkspace = existingIndex >= 0 ? workspaces[existingIndex] : null;

	const filtered = existingIndex >= 0 ? workspaces.filter((_, i) => i !== existingIndex) : workspaces;

	filtered.unshift({
		id: existingWorkspace?.id ?? generateId(),
		nickname: existingWorkspace?.nickname ?? path.basename(folderPath),
		encryptedPath: encrypt(folderPath, encryptionKey),
		lastOpened: new Date().toISOString(),
		isSensitive: existingWorkspace?.isSensitive ?? false
	});

	await context.globalState.update(STORAGE_KEY, filtered.slice(0, config.maxHistory));
	workspaceHistoryChanged.fire();
}

// ─── WORKSPACE PICKER ──────────────────────────────────────────────────────────

async function showWorkspacePicker(context: vscode.ExtensionContext, secrets: vscode.SecretStorage): Promise<void> {
	const workspaces = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);
	if (workspaces.length === 0) {
		vscode.window.showInformationMessage('No saved workspaces yet. Open a folder to add it to history.');
		return;
	}

	const items: WorkspacePickItem[] = workspaces.map(ws => ({
		label: `${ws.isSensitive ? '$(lock) ' : ''}${ws.nickname}`,
		description: ws.isSensitive ? '(sensitive)' : '',
		detail: `Last opened: ${new Date(ws.lastOpened).toLocaleString()}`,
		workspace: ws
	}));

	const pick = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a workspace to open',
		matchOnDescription: false
	});
	if (!pick) { return; }

	if (pick.workspace.isSensitive) {
		const confirm = await vscode.window.showWarningMessage(
			`Open sensitive workspace "${pick.workspace.nickname}"?`, 'Yes', 'No'
		);
		if (confirm !== 'Yes') { return; }
	}

	const encryptionKey = await getEncryptionKey(secrets);
	const workspacePath = decrypt(pick.workspace.encryptedPath, encryptionKey);
	if (!workspacePath) {
		vscode.window.showErrorMessage('Failed to decrypt workspace path');
		return;
	}

	await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspacePath), false);
}

// ─── EDIT WORKSPACE ────────────────────────────────────────────────────────────

async function editWorkspace(context: vscode.ExtensionContext, _secrets: vscode.SecretStorage): Promise<void> {
	const workspaces = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);
	if (workspaces.length === 0) {
		vscode.window.showInformationMessage('No workspaces to edit.');
		return;
	}

	const items: WorkspacePickItem[] = workspaces.map(ws => ({
		label: ws.nickname,
		description: ws.isSensitive ? '$(lock) sensitive' : '',
		workspace: ws
	}));

	const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select a workspace to edit' });
	if (!selected) { return; }

	const action = await vscode.window.showQuickPick<EditAction>([
		{ label: '$(edit) Edit Nickname', action: 'nickname' },
		{ label: selected.workspace.isSensitive ? '$(unlock) Remove Sensitive Flag' : '$(lock) Mark as Sensitive', action: 'sensitive' }
	], { placeHolder: 'What would you like to edit?' });
	if (!action) { return; }

	const wsIndex = workspaces.findIndex(w => w.id === selected.workspace.id);
	if (wsIndex < 0) { return; }

	if (action.action === 'nickname') {
		const newNickname = await vscode.window.showInputBox({
			prompt: 'Enter a new nickname',
			value: selected.workspace.nickname,
			validateInput: (v) => v.trim() ? null : 'Nickname cannot be empty'
		});
		if (!newNickname) { return; }
		workspaces[wsIndex].nickname = newNickname.trim();
		await context.globalState.update(STORAGE_KEY, workspaces);
		workspaceHistoryChanged.fire();
		vscode.window.showInformationMessage(`Workspace renamed to "${newNickname}"`);
	} else {
		workspaces[wsIndex].isSensitive = !workspaces[wsIndex].isSensitive;
		await context.globalState.update(STORAGE_KEY, workspaces);
		workspaceHistoryChanged.fire();
		const status = workspaces[wsIndex].isSensitive ? 'marked as sensitive' : 'no longer sensitive';
		vscode.window.showInformationMessage(`"${selected.workspace.nickname}" is now ${status}`);
	}
}

// ─── REMOVE WORKSPACE ──────────────────────────────────────────────────────────

async function removeWorkspace(context: vscode.ExtensionContext, _secrets: vscode.SecretStorage): Promise<void> {
	const workspaces = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);
	if (workspaces.length === 0) {
		vscode.window.showInformationMessage('No workspaces to remove.');
		return;
	}

	const items: WorkspacePickItem[] = workspaces.map(ws => ({
		label: ws.nickname,
		description: ws.isSensitive ? '$(lock) sensitive' : '',
		workspace: ws
	}));

	const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select a workspace to remove' });
	if (!selected) { return; }

	await context.globalState.update(STORAGE_KEY, workspaces.filter(w => w.id !== selected.workspace.id));
	workspaceHistoryChanged.fire();
	vscode.window.showInformationMessage(`"${selected.workspace.nickname}" removed from history.`);
}

// ─── TOGGLE SENSITIVE ──────────────────────────────────────────────────────────

async function toggleCurrentWorkspaceSensitive(context: vscode.ExtensionContext, secrets: vscode.SecretStorage): Promise<void> {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) {
		vscode.window.showInformationMessage('No workspace currently open.');
		return;
	}

	const folderPath = folders[0].uri.fsPath;
	const encryptionKey = await getEncryptionKey(secrets);
	const workspaces = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);
	const foundIndex = workspaces.findIndex(ws => decrypt(ws.encryptedPath, encryptionKey) === folderPath);

	if (foundIndex < 0) {
		vscode.window.showInformationMessage('Current workspace not in history. Use Jump to Workspace first.');
		return;
	}

	workspaces[foundIndex].isSensitive = !workspaces[foundIndex].isSensitive;
	await context.globalState.update(STORAGE_KEY, workspaces);
	workspaceHistoryChanged.fire();

	const status = workspaces[foundIndex].isSensitive ? 'marked as sensitive' : 'no longer sensitive';
	vscode.window.showInformationMessage(`Current workspace is now ${status}`);
}

// ─── DEACTIVATE ────────────────────────────────────────────────────────────────

export function deactivate(): void {
	// Fully offline — nothing to tear down
}
