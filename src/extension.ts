import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
	WorkspaceSession,
	WorkspaceStatus,
	generateEncryptionKey,
	generateNonce,
	encrypt,
	decrypt,
	generateId,
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

// User-facing product name. Storage keys, command ids and configuration keys
// deliberately keep their `workspace-jumper` prefix for consistency across
// the extension. This ensures settings and keybindings remain stable.
const APP_NAME = 'Warpspace';

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
	const config = vscode.workspace.getConfiguration('workspace-jumper');
	return {
		autoResumeEnabled: config.get<boolean>('autoResumeEnabled', true),
		maxHistory: config.get<number>('maxHistory', MAX_HISTORY)
	};
}

// ─── WORKSPACE STATUS ──────────────────────────────────────────────────────────

/**
 * Decrypts a stored entry and reports whether it is actually usable.
 * `decrypt` returns '' on any failure (wrong key, tampering, bad format), which
 * is indistinguishable from a legitimately empty path — so an empty result is
 * always treated as undecryptable.
 */
function resolveWorkspace(ws: WorkspaceSession, key: string): { path: string; status: WorkspaceStatus } {
	const decrypted = decrypt(ws.encryptedPath, key);
	if (!decrypted) { return { path: '', status: 'undecryptable' }; }
	if (!fs.existsSync(decrypted)) { return { path: decrypted, status: 'missing' }; }
	return { path: decrypted, status: 'ok' };
}

/** Renders every stored workspace as a card, annotated with its on-disk status. */
function buildRows(workspaces: WorkspaceSession[], key: string): string {
	return workspaces
		.map(ws => {
			const { path: decrypted, status } = resolveWorkspace(ws, key);
			return buildCardHtml(ws, decrypted, status);
		})
		.join('');
}

/**
 * Gate for opening a workspace flagged sensitive. Applied on every open path
 * (picker, dashboard, auto-resume) so the flag means the same thing everywhere.
 */
async function confirmSensitiveOpen(ws: WorkspaceSession): Promise<boolean> {
	if (!ws.isSensitive) { return true; }
	const confirm = await vscode.window.showWarningMessage(
		`Open sensitive workspace "${ws.nickname}"?`,
		{ modal: true },
		'Open'
	);
	return confirm === 'Open';
}

/** Opens a folder, guarding against a path that has since disappeared. */
async function openWorkspacePath(workspacePath: string): Promise<void> {
	if (!fs.existsSync(workspacePath)) {
		vscode.window.showErrorMessage(`${APP_NAME}: That folder no longer exists on disk.`);
		return;
	}
	await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspacePath), false);
}


function getDashboardHtml(
	webview: vscode.Webview,
	context: vscode.ExtensionContext,
	rows: string
): string {
	const codiconsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css')
	);
	const cssUri = webview.asWebviewUri(
		vscode.Uri.joinPath(context.extensionUri, 'media', 'dashboard.css')
	);
	const appIconUri = webview.asWebviewUri(
		vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg')
	);
	const heroImageUri = webview.asWebviewUri(
		vscode.Uri.joinPath(context.extensionUri, 'media', 'img.png')
	);

	const nonce = generateNonce();
	const csp = [
		`default-src 'none'`,
		`img-src ${webview.cspSource}`,
		`style-src ${webview.cspSource}`,
		`font-src ${webview.cspSource}`,
		`script-src 'nonce-${nonce}'`
	].join('; ');

	const emptyState = `
		<div class="empty-state">
			<img src="${heroImageUri}" alt="Workspace Jumper" class="hero-image" />
			<div class="codicon codicon-folder-opened"></div>
			<p>No workspaces saved yet.</p>
			<p class="hint">Open a workspace and click "Add Current Workspace" to get started.</p>
		</div>`;

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<link href="${codiconsUri}" rel="stylesheet" />
	<link href="${cssUri}" rel="stylesheet" />
</head>
<body>
	<div class="header">
		<h2>
			<img class="app-icon" src="${appIconUri}" width="24" height="24" alt="" />
			${APP_NAME}
		</h2>
		<p>Jump between workspaces instantly</p>
	</div>

	${rows || emptyState}

	<div class="footer">
		<button data-action="addCurrent">
			<span class="codicon codicon-add"></span> Add Current Workspace
		</button>
		<button data-action="clear">
			<span class="codicon codicon-clear-all"></span> Clear History
		</button>
	</div>

	<script nonce="${nonce}">
		(function () {
			const vscode = acquireVsCodeApi();

			// Single delegated listener. Avoids inline on* handlers (blocked by the
			// CSP) and the name collision between a global remove() and
			// Element.prototype.remove that silently broke the delete button.
			document.addEventListener('click', function (event) {
				const target = event.target.closest('[data-action]');
				if (!target || target.disabled) { return; }

				switch (target.getAttribute('data-action')) {
					case 'resume':
						vscode.postMessage({
							type: 'resume',
							path: decodeURIComponent(target.getAttribute('data-path'))
						});
						break;
					case 'edit':
						vscode.postMessage({ type: 'edit', id: target.getAttribute('data-id') });
						break;
					case 'remove':
						vscode.postMessage({ type: 'remove', id: target.getAttribute('data-id') });
						break;
					case 'addCurrent':
						vscode.postMessage({ type: 'addCurrent' });
						break;
					case 'clear':
						vscode.postMessage({ type: 'clear' });
						break;
				}
			});
		}());
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
		case 'resume': {
			if (!msg.path) { break; }
			// Re-read the entry from storage: the sensitive flag lives there, not
			// in the message, so a stale webview cannot bypass the confirmation.
			const key = await getEncryptionKey(context.secrets);
			const list = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);
			const entry = list.find(ws => decrypt(ws.encryptedPath, key) === msg.path);
			if (entry && !(await confirmSensitiveOpen(entry))) { break; }
			await openWorkspacePath(msg.path);
			break;
		}

		case 'clear': {
			const confirm = await vscode.window.showWarningMessage(
				'Clear all workspace history?',
				{ modal: true, detail: 'This removes every saved workspace. It cannot be undone.' },
				'Clear History'
			);
			if (confirm !== 'Clear History') { break; }
			await context.globalState.update(STORAGE_KEY, []);
			workspaceHistoryChanged.fire();
			await refresh();
			vscode.window.showInformationMessage(`${APP_NAME}: All workspace history cleared`);
			break;
		}

		case 'remove': {
			const list = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);
			await context.globalState.update(STORAGE_KEY, list.filter(w => w.id !== msg.id));
			workspaceHistoryChanged.fire();
			await refresh();
			vscode.window.showInformationMessage(`${APP_NAME}: Workspace removed`);
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
				vscode.window.showInformationMessage(`${APP_NAME}: "${existing.nickname}" is already in your workspace history`);
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
			await context.globalState.update(STORAGE_KEY, [newSession, ...list].slice(0, getConfig().maxHistory));
			workspaceHistoryChanged.fire();
			await refresh();
			vscode.window.showInformationMessage(`${APP_NAME}: Added "${nickname.trim()}" to workspace history`);
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
			workspaceHistoryChanged.fire();
			await refresh();
			vscode.window.showInformationMessage(`${APP_NAME}: Workspace updated`);
			break;
		}
	}
}

// ─── SIDEBAR VIEW PROVIDER ─────────────────────────────────────────────────────

class WarpspaceViewProvider implements vscode.WebviewViewProvider {
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
		this._view.webview.html = getDashboardHtml(
			this._view.webview,
			this.ctx,
			buildRows(workspaces, encryptionKey)
		);
	}
}

// ─── DASHBOARD PANEL ───────────────────────────────────────────────────────────

let dashboardPanel: vscode.WebviewPanel | undefined;

async function openDashboard(context: vscode.ExtensionContext): Promise<void> {
	// Reuse the existing panel rather than stacking duplicates.
	if (dashboardPanel) {
		dashboardPanel.reveal(vscode.ViewColumn.One);
		return;
	}

	const panel = vscode.window.createWebviewPanel(
		'workspaceJumperDashboard',
		APP_NAME,
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
	dashboardPanel = panel;

	const refresh = async () => {
		const encryptionKey = await getEncryptionKey(context.secrets);
		const workspaces = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);
		panel.webview.html = getDashboardHtml(panel.webview, context, buildRows(workspaces, encryptionKey));
	};

	await refresh();

	// Keep the panel in step with changes made from the picker or the sidebar.
	const subscription = onWorkspaceHistoryChanged(() => { refresh(); });

	panel.webview.onDidReceiveMessage(async (msg) => {
		await handleWebviewMessage(msg, context, refresh);
	});

	panel.onDidDispose(() => {
		subscription.dispose();
		dashboardPanel = undefined;
	});
}

// ─── ACTIVATE ──────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
	const secrets = context.secrets;
	const config = getConfig();

	getEncryptionKey(secrets).catch(err => { console.error('Failed to preload encryption key:', err); });

	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBar.text = `$(briefcase) ${APP_NAME}`;
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
		vscode.commands.registerCommand('workspace-jumper.editWorkspace', () => editWorkspace(context)),
		vscode.commands.registerCommand('workspace-jumper.removeWorkspace', () => removeWorkspace(context)),
		vscode.commands.registerCommand('workspace-jumper.clearHistory', async () => {
			const confirm = await vscode.window.showWarningMessage(
				'Clear all workspace history?',
				{ modal: true, detail: 'This removes every saved workspace. It cannot be undone.' },
				'Clear History'
			);
			if (confirm === 'Clear History') {
				await context.globalState.update(STORAGE_KEY, []);
				workspaceHistoryChanged.fire();
				vscode.window.showInformationMessage('Workspace history cleared.');
			}
		}),
		vscode.commands.registerCommand('workspace-jumper.toggleSensitive', () => toggleCurrentWorkspaceSensitive(context, secrets)),
		vscode.commands.registerCommand('workspace-jumper.openDashboard', () => openDashboard(context)),
		vscode.commands.registerCommand('workspace-jumper.openSidebar', async () => {
			try {
				await vscode.commands.executeCommand('workbench.view.extension.workspace-jumper');
			} catch {
				await vscode.commands.executeCommand('workbench.action.openView', 'workspace-jumper.sidebarView');
			}
		})
	);

	const provider = new WarpspaceViewProvider(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('workspace-jumper.sidebarView', provider, {
			webviewOptions: { retainContextWhenHidden: true }
		}),
		workspaceHistoryChanged
	);

	if (context.extensionMode === vscode.ExtensionMode.Development) {
		try {
			// Scoped to this extension's own build output. The previous `**/…`
			// glob matched files in whatever project the dev host had open, which
			// triggered reload storms while editing unrelated code.
			const watcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(context.extensionUri, 'dist/**/*.js')
			);
			let reloadTimer: ReturnType<typeof setTimeout> | undefined;
			const scheduleReload = () => {
				if (reloadTimer) { clearTimeout(reloadTimer); }
				reloadTimer = setTimeout(async () => {
					vscode.window.showInformationMessage(`${APP_NAME}: source changed — reloading...`);
					await vscode.commands.executeCommand('workbench.action.reloadWindow');
				}, 600);
			};
			watcher.onDidChange(scheduleReload);
			watcher.onDidCreate(scheduleReload);
			watcher.onDidDelete(scheduleReload);
			context.subscriptions.push(watcher, new vscode.Disposable(() => {
				if (reloadTimer) { clearTimeout(reloadTimer); }
			}));
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
	const { path: workspacePath, status } = resolveWorkspace(last, encryptionKey);

	// Silently skip auto-resume when the entry is unusable — this runs at
	// startup, where an error popup for a stale entry would just be noise.
	if (status !== 'ok') { return; }

	if (!(await confirmSensitiveOpen(last))) { return; }

	await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspacePath), false);
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

	const encryptionKey = await getEncryptionKey(secrets);

	const items: WorkspacePickItem[] = workspaces.map(ws => {
		const { status } = resolveWorkspace(ws, encryptionKey);
		const notes = [
			ws.isSensitive ? '(sensitive)' : '',
			status === 'missing' ? '$(warning) folder missing' : '',
			status === 'undecryptable' ? '$(warning) cannot decrypt' : ''
		].filter(Boolean).join(' ');
		return {
			label: `${ws.isSensitive ? '$(lock) ' : ''}${ws.nickname}`,
			description: notes,
			detail: `Last opened: ${new Date(ws.lastOpened).toLocaleString()}`,
			workspace: ws
		};
	});

	const pick = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a workspace to open',
		matchOnDescription: false
	});
	if (!pick) { return; }

	const { path: workspacePath, status } = resolveWorkspace(pick.workspace, encryptionKey);

	if (status === 'undecryptable') {
		await offerToRemoveBrokenEntry(
			context,
			pick.workspace,
			`Could not decrypt the path for "${pick.workspace.nickname}". This usually means the stored encryption key is no longer available.`
		);
		return;
	}

	if (status === 'missing') {
		await offerToRemoveBrokenEntry(
			context,
			pick.workspace,
			`"${pick.workspace.nickname}" no longer exists on disk.`
		);
		return;
	}

	if (!(await confirmSensitiveOpen(pick.workspace))) { return; }

	await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspacePath), false);
}

/** Offers to drop an entry that can no longer be opened, so history stays clean. */
async function offerToRemoveBrokenEntry(
	context: vscode.ExtensionContext,
	ws: WorkspaceSession,
	message: string
): Promise<void> {
	const choice = await vscode.window.showWarningMessage(message, 'Remove from History', 'Keep');
	if (choice !== 'Remove from History') { return; }

	const list = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);
	await context.globalState.update(STORAGE_KEY, list.filter(w => w.id !== ws.id));
	workspaceHistoryChanged.fire();
	vscode.window.showInformationMessage(`"${ws.nickname}" removed from history.`);
}

// ─── EDIT WORKSPACE ────────────────────────────────────────────────────────────

async function editWorkspace(context: vscode.ExtensionContext): Promise<void> {
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

async function removeWorkspace(context: vscode.ExtensionContext): Promise<void> {
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
