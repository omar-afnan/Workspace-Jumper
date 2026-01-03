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

interface WorkspaceConfig {
	autoResumeEnabled: boolean;
	maxHistory: number;
}

//  CONSTANTS 
const STORAGE_KEY = 'workspace-jumper.workspaces';
const ENCRYPTION_KEY_ID = 'workspace-jumper.encryptionKey';
const MAX_HISTORY = 10;
const ALGORITHM = 'aes-256-gcm';

//  ENCRYPTION HELPERS 
// Generate a random encryption key
function generateEncryptionKey(): string {
	return crypto.randomBytes(32).toString('hex');
}

// Get or create encryption key using SecretStorage
async function getEncryptionKey(secrets: vscode.SecretStorage): Promise<string> {
	let key = await secrets.get(ENCRYPTION_KEY_ID);
	if (!key) {
		key = generateEncryptionKey();
		await secrets.store(ENCRYPTION_KEY_ID, key);
	}
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

// ============ CONFIGURATION HELPERS ============
function getConfig(): WorkspaceConfig {
	const config = vscode.workspace.getConfiguration('worksnap');
	return {
		autoResumeEnabled: config.get<boolean>('autoResumeEnabled', true),
		maxHistory: config.get<number>('maxHistory', MAX_HISTORY)
	};
}

// ============ MAIN EXTENSION ============
export function activate(context: vscode.ExtensionContext) {
	console.log('WorkSnap activated - Privacy-focused workspace manager');

	const secrets = context.secrets;
	const config = getConfig();

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
}

// ============ AUTO-RESUME ============
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

	setTimeout(() => {
		vscode.commands.executeCommand(
			'vscode.openFolder',
			vscode.Uri.file(workspacePath),
			false
		);
	}, 500);
}

// ============ SAVE WORKSPACE ============
async function saveCurrentWorkspace(context: vscode.ExtensionContext, secrets: vscode.SecretStorage) {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) return;

	const folderPath = folders[0].uri.fsPath;
	const folderName = path.basename(folderPath);
	const encryptionKey = await getEncryptionKey(secrets);
	const config = getConfig();

	const workspaces = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);

	// Check if this workspace already exists (by decrypting and comparing paths)
	let existingIndex = -1;
	let existingWorkspace: WorkspaceSession | null = null;

	for (let i = 0; i < workspaces.length; i++) {
		const decryptedPath = decrypt(workspaces[i].encryptedPath, encryptionKey);
		if (decryptedPath === folderPath) {
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
}

// ============ WORKSPACE PICKER ============
async function showWorkspacePicker(context: vscode.ExtensionContext, secrets: vscode.SecretStorage) {
	const workspaces = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);

	if (workspaces.length === 0) {
		vscode.window.showInformationMessage('No saved workspaces yet. Open a folder to add it to history.');
		return;
	}

	const encryptionKey = await getEncryptionKey(secrets);

	// Build quick pick items
	const items = workspaces.map(ws => {
		const decryptedPath = decrypt(ws.encryptedPath, encryptionKey);
		const sensitiveIcon = ws.isSensitive ? '$(lock) ' : '';
		return {
			label: `${sensitiveIcon}${ws.nickname}`,
			description: ws.isSensitive ? '(sensitive)' : decryptedPath,
			detail: `Last opened: ${new Date(ws.lastOpened).toLocaleString()}`,
			workspace: ws,
			path: decryptedPath
		};
	});

	const pick = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a workspace to open',
		matchOnDescription: true
	});

	if (!pick || !pick.path) return;

	// Confirm if sensitive
	if (pick.workspace.isSensitive) {
		const confirm = await vscode.window.showWarningMessage(
			`This workspace is marked as sensitive. Open "${pick.workspace.nickname}"?`,
			'Yes', 'No'
		);
		if (confirm !== 'Yes') return;
	}

	await vscode.commands.executeCommand(
		'vscode.openFolder',
		vscode.Uri.file(pick.path),
		false
	);
}

// ============ EDIT WORKSPACE ============
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
			vscode.window.showInformationMessage(`Workspace renamed to "${newNickname}"`);
		}
	} else if (action.action === 'sensitive') {
		workspaces[wsIndex].isSensitive = !workspaces[wsIndex].isSensitive;
		await context.globalState.update(STORAGE_KEY, workspaces);
		const status = workspaces[wsIndex].isSensitive ? 'marked as sensitive' : 'no longer marked as sensitive';
		vscode.window.showInformationMessage(`Workspace "${selected.workspace.nickname}" is now ${status}`);
	}
}

// ============ REMOVE WORKSPACE ============
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
	vscode.window.showInformationMessage(`Workspace "${selected.workspace.nickname}" removed from history.`);
}

// ============ TOGGLE SENSITIVE ON CURRENT ============
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

	const status = workspaces[foundIndex].isSensitive ? 'marked as sensitive 🔒' : 'no longer sensitive 🔓';
	vscode.window.showInformationMessage(`Current workspace is now ${status}`);
}

export function deactivate() {
	// No network connections to close - fully offline extension
}
