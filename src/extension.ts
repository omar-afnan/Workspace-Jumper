import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';

//  INTERFACES
interface WorkspaceSession {
	id: string;              // Unique identifier
	nickname: string;        // User-friendly name (can be custom)
	encryptedPath: string;   // Encrypted workspace path
	lastOpened: string;
	isSensitive: boolean;    // Mark as sensitive for confirmation prompt
}

// Event emitter for workspace history changes
const workspaceHistoryChanged = new vscode.EventEmitter<void>();
export const onWorkspaceHistoryChanged = workspaceHistoryChanged.event;

interface WorkspaceConfig {
	autoResumeEnabled: boolean;
	maxHistory: number;
}

//  CONSTANTS
const STORAGE_KEY = 'workspace-jumper.workspaces';
const ENCRYPTION_KEY_ID = 'workspace-jumper.encryptionKey';
const MAX_HISTORY = 10;
const ALGORITHM = 'aes-256-gcm';

// Cache for encryption key to avoid repeated SecretStorage calls
let encryptionKeyCache: string | null = null;

//  ENCRYPTION HELPERS 
// Generate a random encryption key
function generateEncryptionKey(): string {
	return crypto.randomBytes(32).toString('hex');
}

// Get or create encryption key using SecretStorage (with caching)
async function getEncryptionKey(secrets: vscode.SecretStorage): Promise<string> {
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
function encrypt(text: string, keyHex: string): string {
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
function decrypt(encryptedData: string, keyHex: string): string {
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
	} catch (error) {
		console.error('Decryption failed:', error);
		return '';
	}
}

// Generate unique ID for workspace
function generateId(): string {
	return crypto.randomBytes(8).toString('hex');
}

//  CONFIGURATION HELPERS 
function getConfig(): WorkspaceConfig {
	const config = vscode.workspace.getConfiguration('worksnap');
	return {
		autoResumeEnabled: config.get<boolean>('autoResumeEnabled', true),
		maxHistory: config.get<number>('maxHistory', MAX_HISTORY)
	};
}

//  MAIN EXTENSION 
export function activate(context: vscode.ExtensionContext) {
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
	const jumpCommand = vscode.commands.registerCommand(
		'workspace-jumper.jump',
		async () => {
			await saveCurrentWorkspace(context, secrets);
			await showWorkspacePicker(context, secrets);
		}
	);

	// Register command to edit workspace (nickname, sensitive flag)
	const editCommand = vscode.commands.registerCommand(
		'workspace-jumper.editWorkspace',
		async () => {
			await editWorkspace(context, secrets);
		}
	);

	// Register command to remove a workspace from history
	const removeCommand = vscode.commands.registerCommand(
		'workspace-jumper.removeWorkspace',
		async () => {
			await removeWorkspace(context, secrets);
		}
	);

	// Register command to clear all workspace history
	const clearCommand = vscode.commands.registerCommand(
		'workspace-jumper.clearHistory',
		async () => {
			const confirm = await vscode.window.showWarningMessage(
				'Are you sure you want to clear all workspace history?',
				'Yes', 'No'
			);
			if (confirm === 'Yes') {
				await context.globalState.update(STORAGE_KEY, []);
				workspaceHistoryChanged.fire(); // Notify sidebar to refresh
				vscode.window.showInformationMessage('Workspace history cleared.');
			}
		}
	);

	// Register command to toggle sensitive flag on current workspace
	const toggleSensitiveCommand = vscode.commands.registerCommand(
		'workspace-jumper.toggleSensitive',
		async () => {
			await toggleCurrentWorkspaceSensitive(context, secrets);
		}
	);

	context.subscriptions.push(jumpCommand, editCommand, removeCommand, clearCommand, toggleSensitiveCommand);

	// Register dashboard webview command (WorkSnap Dashboard)
	context.subscriptions.push(
		vscode.commands.registerCommand('worksnap.openDashboard', () => {
			openDashboard(context);
		})
	);

	// Register a sidebar view provider so the dashboard appears in the left Activity Bar
	class WorkSnapViewProvider implements vscode.WebviewViewProvider {
		private _view?: vscode.WebviewView;

		constructor(private readonly ctx: vscode.ExtensionContext) {
			// Listen for workspace history changes and refresh the view
			onWorkspaceHistoryChanged(() => {
				this.refreshView();
			});
		}

		public async resolveWebviewView(webviewView: vscode.WebviewView) {
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
							const list = this.ctx.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);
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
							const list = this.ctx.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);

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

							if (!nickname) return;

							const encrypted = encrypt(folderPath, key);
							const newSession: WorkspaceSession = {
								id: crypto.randomBytes(8).toString('hex'),
								nickname: nickname.trim(),
								encryptedPath: encrypted,
								lastOpened: new Date().toISOString(),
								isSensitive: false
							};

							const maxHistory = vscode.workspace.getConfiguration('worksnap').get<number>('maxHistory', 10);
							const updated = [newSession, ...list].slice(0, maxHistory);
							await this.ctx.globalState.update(STORAGE_KEY, updated);
							await this.refreshView();
							vscode.window.showInformationMessage(`WorkSnap: Added "${nickname}" to workspace history`);
						}
						break;
					case 'edit':
						{
							const list = this.ctx.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);
							const workspace = list.find(w => w.id === msg.id);
							if (!workspace) return;

							const choice = await vscode.window.showQuickPick([
								{ label: '$(edit) Edit Nickname', action: 'nickname' },
								{ label: `$(${workspace.isSensitive ? 'unlock' : 'lock'}) ${workspace.isSensitive ? 'Remove' : 'Mark as'} Sensitive`, action: 'sensitive' }
							], { placeHolder: `Edit "${workspace.nickname}"` });

							if (!choice) return;

							if (choice.action === 'nickname') {
								const newName = await vscode.window.showInputBox({
									prompt: 'Enter new nickname',
									value: workspace.nickname,
									validateInput: (val) => val.trim() ? null : 'Nickname cannot be empty'
								});
								if (!newName) return;
								workspace.nickname = newName.trim();
							} else if (choice.action === 'sensitive') {
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

		private async refreshView() {
			if (!this._view) return;

			const secrets = this.ctx.secrets;
			const encryptionKey = await getEncryptionKey(secrets);
			const workspaces = this.ctx.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);

			const rows = workspaces.map(ws => {
				const decrypted = decrypt(ws.encryptedPath, encryptionKey) || '';
				const displayPath = decrypted.split(/[\\/]/).slice(-2).join('/'); // Show last 2 path segments
				return `
					<div class="card">
						<div class="card-header">
							<div class="title">
								<span class="codicon codicon-folder"></span>
								<span class="workspace-name">${escapeHtml(ws.nickname)}</span>
								${ws.isSensitive ? '<span class="codicon codicon-lock" style="color:#f59e0b"></span>' : ''}
							</div>
						</div>
						<div class="path">${escapeHtml(displayPath)}</div>
						<div class="actions">
							<button class="btn-primary" data-path="${encodeURIComponent(decrypted)}" onclick="resume(this)">
								<span class="codicon codicon-play"></span> Open
							</button>
							<button class="btn-icon" onclick="edit('${ws.id}')" title="Edit">
								<span class="codicon codicon-edit"></span>
							</button>
							<button class="btn-icon btn-icon-danger" onclick="remove('${ws.id}')" title="Delete">
								<span class="codicon codicon-trash"></span>
							</button>
						</div>
					</div>
				`;
			}).join('');

			this._view.webview.html = getDashboardHtml(this._view.webview, this.ctx, rows);
		}
	}

	const provider = new WorkSnapViewProvider(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('worksnap.sidebarView', provider, {
			webviewOptions: {
				retainContextWhenHidden: true
			}
		}),
		workspaceHistoryChanged // Dispose event emitter on deactivation
	);

	// Command to reveal the WorkSnap activity bar container (focus the left side view)
	context.subscriptions.push(
		vscode.commands.registerCommand('worksnap.openSidebar', async () => {
			try {
				await vscode.commands.executeCommand('workbench.view.extension.worksnap');
			} catch (e) {
				// fallback: try opening view directly
				await vscode.commands.executeCommand('workbench.action.openView', 'worksnap.sidebarView');
			}
		})
	);

	// Development-only: auto-reload Extension Development Host when source files change
	if (context.extensionMode === vscode.ExtensionMode.Development) {
		try {
			// Watch common source folders and key files. Debounce to avoid rapid reloads.
			const watcher = vscode.workspace.createFileSystemWatcher('**/{src,dist,media,package.json,tsconfig.json}/**/*');
			let reloadTimer: any = undefined;
			const scheduleReload = () => {
				if (reloadTimer) clearTimeout(reloadTimer);
				reloadTimer = setTimeout(async () => {
					try {
						vscode.window.showInformationMessage('WorkSnap: source changed — reloading Extension Development Host...');
						await vscode.commands.executeCommand('workbench.action.reloadWindow');
					} catch (e) {
						console.error('Auto-reload failed:', e);
					}
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

//  DASHBOARD WEBVIEW 
async function openDashboard(context: vscode.ExtensionContext) {
	const panel = vscode.window.createWebviewPanel(
		'worksnapDashboard',
		'WorkSnap',
		vscode.ViewColumn.One,
		{ enableScripts: true, retainContextWhenHidden: true }
	);

	const refreshDashboard = async () => {
		const secrets = context.secrets;
		const encryptionKey = await getEncryptionKey(secrets);
		const workspaces = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);

		const rows = workspaces.map(ws => {
			const decrypted = decrypt(ws.encryptedPath, encryptionKey) || '';
			const displayPath = decrypted.split(/[\\/]/).slice(-2).join('/');
			return `
				<div class="card">
					<div class="card-header">
						<div class="title">
							<span class="codicon codicon-folder"></span>
							<span class="workspace-name">${escapeHtml(ws.nickname)}</span>
							${ws.isSensitive ? '<span class="codicon codicon-lock" style="color:#f59e0b"></span>' : ''}
						</div>
					</div>
					<div class="path">${escapeHtml(displayPath)}</div>
					<div class="actions">
						<button class="btn-primary" data-path="${encodeURIComponent(decrypted)}" onclick="resume(this)">
							<span class="codicon codicon-play"></span> Open
						</button>
						<button class="btn-secondary" onclick="edit('${ws.id}')">
							<span class="codicon codicon-edit"></span>
						</button>
						<button class="btn-danger" onclick="remove('${ws.id}')">
							<span class="codicon codicon-trash"></span>
						</button>
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
				vscode.commands.executeCommand(
					'vscode.openFolder',
					vscode.Uri.file(msg.path),
					false
				);
				break;

			case 'clear':
				await context.globalState.update(STORAGE_KEY, []);
				await refreshDashboard();
				vscode.window.showInformationMessage('WorkSnap: All workspace history cleared');
				break;
			case 'remove':
				{
					const list = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);
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
					const list = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);

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

					if (!nickname) return;

					const encrypted = encrypt(folderPath, key);
					const newSession: WorkspaceSession = {
						id: crypto.randomBytes(8).toString('hex'),
						nickname: nickname.trim(),
						encryptedPath: encrypted,
						lastOpened: new Date().toISOString(),
						isSensitive: false
					};

					const maxHistory = vscode.workspace.getConfiguration('worksnap').get<number>('maxHistory', 10);
					const updated = [newSession, ...list].slice(0, maxHistory);
					await context.globalState.update(STORAGE_KEY, updated);
					await refreshDashboard();
					vscode.window.showInformationMessage(`WorkSnap: Added "${nickname}" to workspace history`);
				}
				break;
			case 'edit':
				{
					const list = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);
					const workspace = list.find(w => w.id === msg.id);
					if (!workspace) return;

					const choice = await vscode.window.showQuickPick([
						{ label: '$(edit) Edit Nickname', action: 'nickname' },
						{ label: `$(${workspace.isSensitive ? 'unlock' : 'lock'}) ${workspace.isSensitive ? 'Remove' : 'Mark as'} Sensitive`, action: 'sensitive' }
					], { placeHolder: `Edit "${workspace.nickname}"` });

					if (!choice) return;

					if (choice.action === 'nickname') {
						const newName = await vscode.window.showInputBox({
							prompt: 'Enter new nickname',
							value: workspace.nickname,
							validateInput: (val) => val.trim() ? null : 'Nickname cannot be empty'
						});
						if (!newName) return;
						workspace.nickname = newName.trim();
					} else if (choice.action === 'sensitive') {
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

function getDashboardHtml(webview: vscode.Webview, context: vscode.ExtensionContext, rows: string) {
	const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));
	const fontUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.ttf'));
	const clipboardIconUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'Clipboard-Task-Pending-Action--Streamline-Plump.png'));

	return `<!DOCTYPE html>
	<html>
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<link href="${codiconsUri}" rel="stylesheet" />
		<style>
			@font-face {
				font-family: 'codicon';
				src: url('${fontUri}') format('truetype');
			}
		</style>
		<style>
			* { margin: 0; padding: 0; box-sizing: border-box; }

			body {
				font-family: var(--vscode-font-family);
				background: var(--vscode-sideBar-background);
				color: var(--vscode-foreground);
				padding: 8px;
				font-size: 13px;
				min-width: 0;
				overflow-x: hidden;
			}

			.header {
				margin-bottom: 12px;
			}

			.header h2 {
				font-size: 13px;
				font-weight: 600;
				margin-bottom: 2px;
				color: var(--vscode-foreground);
				display: flex;
				align-items: center;
				flex-wrap: nowrap;
				white-space: nowrap;
				overflow: hidden;
			}

			.header p {
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
			}

			.card {
				background: var(--vscode-editor-background);
				border: 1px solid var(--vscode-panel-border);
				padding: 10px;
				margin-bottom: 6px;
				border-radius: 4px;
				min-width: 0;
				overflow: hidden;
			}

			.card:hover {
				background: var(--vscode-list-hoverBackground);
			}

			.card-header {
				margin-bottom: 6px;
				min-width: 0;
			}

			.title {
				display: flex;
				align-items: flex-start;
				gap: 6px;
				font-weight: 600;
				font-size: 12px;
				margin-bottom: 2px;
				min-width: 0;
			}

			.title .codicon {
				flex-shrink: 0;
			}

			.workspace-name {
				flex: 1;
				min-width: 0;
				word-wrap: break-word;
				overflow-wrap: break-word;
				hyphens: auto;
			}

			.path {
				color: var(--vscode-descriptionForeground);
				font-size: 10px;
				margin-bottom: 8px;
				padding-left: 20px;
				word-wrap: break-word;
				overflow-wrap: break-word;
				hyphens: auto;
				min-width: 0;
			}

			.actions {
				display: flex;
				gap: 4px;
				flex-wrap: wrap;
				min-width: 0;
			}

			button {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				gap: 4px;
				border: none;
				padding: 5px 8px;
				border-radius: 2px;
				cursor: pointer;
				font-size: 11px;
				font-family: var(--vscode-font-family);
				transition: background 0.1s;
				white-space: nowrap;
				min-width: 0;
			}

			button:hover {
				opacity: 0.9;
			}

			.btn-primary {
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				flex: 1 1 auto;
				min-width: 60px;
			}

			.btn-primary:hover {
				background: var(--vscode-button-hoverBackground);
			}

			.btn-secondary {
				background: var(--vscode-button-secondaryBackground);
				color: var(--vscode-button-secondaryForeground);
			}

			.btn-secondary:hover {
				background: var(--vscode-button-secondaryHoverBackground);
			}

			.btn-danger {
				background: transparent;
				color: var(--vscode-errorForeground);
				border: none;
				padding: 4px 6px;
			}

			.btn-danger:hover {
				background: rgba(245, 127, 0, 0.2);
				opacity: 1;
			}

			.btn-icon {
				background: var(--vscode-button-secondaryBackground);
				color: var(--vscode-button-secondaryForeground);
				padding: 5px 6px;
				min-width: 28px;
				flex-shrink: 0;
			}

			.btn-icon:hover {
				background: var(--vscode-button-secondaryHoverBackground);
			}

			.btn-icon-danger {
				color: var(--vscode-errorForeground);
			}

			.btn-icon-danger:hover {
				background: rgba(244, 67, 54, 0.2);
			}

			.footer {
				margin-top: 10px;
				display: flex;
				flex-direction: column;
				gap: 4px;
			}

			.footer button {
				width: 100%;
				justify-content: center;
				background: var(--vscode-button-secondaryBackground);
				color: var(--vscode-button-secondaryForeground);
				font-size: 11px;
				padding: 6px 8px;
			}

			.footer button:hover {
				background: var(--vscode-button-secondaryHoverBackground);
			}

			.empty-state {
				text-align: center;
				padding: 20px 12px;
				color: var(--vscode-descriptionForeground);
			}

			.empty-state .codicon {
				font-size: 36px;
				margin-bottom: 10px;
				opacity: 0.5;
			}

			/* Responsive adjustments for very narrow sidebars */
			@media (max-width: 200px) {
				body {
					padding: 6px;
				}

				.header h2 {
					font-size: 12px;
				}

				.card {
					padding: 8px;
				}

				.title {
					font-size: 11px;
				}

				.path {
					font-size: 9px;
					padding-left: 0;
				}

				.actions {
					flex-direction: column;
					gap: 4px;
				}

				.btn-primary {
					width: 100%;
				}

				.btn-icon {
					min-width: 24px;
					padding: 4px;
				}

				button .btn-text {
					display: none;
				}
			}

			/* Hide button text on small widths, show only icons */
			@media (max-width: 160px) {
				.btn-primary .codicon + span,
				.footer button .codicon + span {
					display: none;
				}

				.header p {
					display: none;
				}

				.path {
					display: none;
				}
			}
		</style>
	</head>
	<body>
		<div class="header">
			<h2><img src="${clipboardIconUri}" width="24" height="24" style="vertical-align:middle;margin-right:8px;display:inline-block" alt="WorkSnap"> WorkSnap</h2>
			<p>Jump between workspaces instantly</p>
		</div>

		${rows || `
			<div class="empty-state">
				<div class="codicon codicon-folder-opened"></div>
				<p>No workspaces saved yet.</p>
			</div>
		`}

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

function escapeHtml(input: string) {
	const map: Record<string, string> = {
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;'
	};

	return input.replace(/[&<>"']/g, (c) => map[c] ?? c);
}

// Helper function for custom PNG icons (if needed in future)
function customIcon(webview: vscode.Webview, context: vscode.ExtensionContext, filename: string) {
	const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', filename));
	return `<img src="${iconUri}" width="14" height="14" style="vertical-align:middle;margin-right:6px" alt="icon">`;
}

//  AUTO-RESUME 
async function handleAutoResume(context: vscode.ExtensionContext, secrets: vscode.SecretStorage) {
	const workspaces = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);
	if (workspaces.length === 0) return;

	const lastWorkspace = workspaces[0];
	const encryptionKey = await getEncryptionKey(secrets);
	const workspacePath = decrypt(lastWorkspace.encryptedPath, encryptionKey);

	if (!workspacePath) return;

	// Check if sensitive - ask for confirmation
	if (lastWorkspace.isSensitive) {
		const confirm = await vscode.window.showWarningMessage(
			`Resume sensitive workspace "${lastWorkspace.nickname}"?`,
			'Yes', 'No'
		);
		if (confirm !== 'Yes') return;
	}

	// Open workspace immediately (no artificial delay)
	vscode.commands.executeCommand(
		'vscode.openFolder',
		vscode.Uri.file(workspacePath),
		false
	);
}

//  SAVE WORKSPACE 
async function saveCurrentWorkspace(context: vscode.ExtensionContext, secrets: vscode.SecretStorage) {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) return;

	const folderPath = folders[0].uri.fsPath;
	const folderName = path.basename(folderPath);
	const encryptionKey = await getEncryptionKey(secrets);
	const config = getConfig();

	const workspaces = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);

	// Optimization: Decrypt all paths in one batch to check for duplicates
	let existingIndex = -1;
	let existingWorkspace: WorkspaceSession | null = null;

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
	const newEntry: WorkspaceSession = {
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

	// Notify sidebar to refresh
	workspaceHistoryChanged.fire();
}

//  WORKSPACE PICKER 
async function showWorkspacePicker(context: vscode.ExtensionContext, secrets: vscode.SecretStorage) {
	const workspaces = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);

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

	if (!pick) return;

	// Confirm if sensitive
	if (pick.workspace.isSensitive) {
		const confirm = await vscode.window.showWarningMessage(
			`This workspace is marked as sensitive. Open "${pick.workspace.nickname}"?`,
			'Yes', 'No'
		);
		if (confirm !== 'Yes') return;
	}

	// Only decrypt the selected workspace path
	const encryptionKey = await getEncryptionKey(secrets);
	const workspacePath = decrypt(pick.workspace.encryptedPath, encryptionKey);

	if (!workspacePath) {
		vscode.window.showErrorMessage('Failed to decrypt workspace path');
		return;
	}

	await vscode.commands.executeCommand(
		'vscode.openFolder',
		vscode.Uri.file(workspacePath),
		false
	);
}

//  EDIT WORKSPACE 

async function editWorkspace(context: vscode.ExtensionContext, secrets: vscode.SecretStorage) {
	const workspaces = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);

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

	if (!selected) return;

	// Choose what to edit
	const action = await vscode.window.showQuickPick([
		{ label: '$(edit) Edit Nickname', action: 'nickname' },
		{ label: selected.workspace.isSensitive ? '$(unlock) Remove Sensitive Flag' : '$(lock) Mark as Sensitive', action: 'sensitive' }
	], {
		placeHolder: 'What would you like to edit?'
	});

	if (!action) return;

	const wsIndex = workspaces.findIndex(w => w.id === selected.workspace.id);
	if (wsIndex < 0) return;

	if (action.action === 'nickname') {
		const newNickname = await vscode.window.showInputBox({
			prompt: 'Enter a new nickname for this workspace',
			value: selected.workspace.nickname,
			validateInput: (value) => value.trim() ? null : 'Nickname cannot be empty'
		});

		if (newNickname) {
			workspaces[wsIndex].nickname = newNickname.trim();
			await context.globalState.update(STORAGE_KEY, workspaces);
			workspaceHistoryChanged.fire(); // Notify sidebar to refresh
			vscode.window.showInformationMessage(`Workspace renamed to "${newNickname}"`);
		}
	} else if (action.action === 'sensitive') {
		workspaces[wsIndex].isSensitive = !workspaces[wsIndex].isSensitive;
		await context.globalState.update(STORAGE_KEY, workspaces);
		workspaceHistoryChanged.fire(); // Notify sidebar to refresh
		const status = workspaces[wsIndex].isSensitive ? 'marked as sensitive' : 'no longer marked as sensitive';
		vscode.window.showInformationMessage(`Workspace "${selected.workspace.nickname}" is now ${status}`);
	}
}

//  REMOVE WORKSPACE 
async function removeWorkspace(context: vscode.ExtensionContext, secrets: vscode.SecretStorage) {
	const workspaces = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);

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

	if (!selected) return;

	const filtered = workspaces.filter(w => w.id !== selected.workspace.id);
	await context.globalState.update(STORAGE_KEY, filtered);
	workspaceHistoryChanged.fire(); // Notify sidebar to refresh
	vscode.window.showInformationMessage(`Workspace "${selected.workspace.nickname}" removed from history.`);
}

//  TOGGLE SENSITIVE ON CURRENT 
async function toggleCurrentWorkspaceSensitive(context: vscode.ExtensionContext, secrets: vscode.SecretStorage) {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) {
		vscode.window.showInformationMessage('No workspace currently open.');
		return;
	}

	const folderPath = folders[0].uri.fsPath;
	const encryptionKey = await getEncryptionKey(secrets);
	const workspaces = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);

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
	workspaceHistoryChanged.fire(); // Notify sidebar to refresh

	const status = workspaces[foundIndex].isSensitive ? 'marked as sensitive 🔒' : 'no longer sensitive 🔓';
	vscode.window.showInformationMessage(`Current workspace is now ${status}`);
}

export function deactivate() {
	// No network connections to close - fully offline extension
}
