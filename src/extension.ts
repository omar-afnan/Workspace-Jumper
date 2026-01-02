import * as vscode from 'vscode';
import * as path from 'path';

interface WorkspaceSession {
	name: string;
	path: string;
	lastOpened: string;
}

const STORAGE_KEY = 'workspace-jumper.workspaces';
const MAX_HISTORY = 10;

export function activate(context: vscode.ExtensionContext) {
	console.log('workspace-jumper activated');

	// Status bar button
	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBar.text = '$(briefcase) WorkSnap';
	statusBar.tooltip = 'Jump to Workspace';
	statusBar.command = 'workspace-jumper.jump';
	statusBar.show();
	context.subscriptions.push(statusBar);

	// Auto-resume last workspace (if VS Code opened without folder)
	const autoResume = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, [])[0];
	if (autoResume && !vscode.workspace.workspaceFolders?.length) {
		setTimeout(() => {
			vscode.commands.executeCommand(
				'vscode.openFolder',
				vscode.Uri.file(autoResume.path),
				false
			);
		}, 500); // half-second delay to ensure VS Code initialized
	}

	// Register command
	const disposable = vscode.commands.registerCommand(
		'workspace-jumper.jump',
		async () => {
			saveCurrentWorkspace(context);
			await showWorkspacePicker(context);
		}
	);
	context.subscriptions.push(disposable);
}

function saveCurrentWorkspace(context: vscode.ExtensionContext) {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) return;

	const folderPath = folders[0].uri.fsPath;
	const folderName = path.basename(folderPath);

	const workspaces = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);

	// Remove duplicate entry if exists
	const filtered = workspaces.filter(ws => ws.path !== folderPath);

	// Add new workspace at front
	filtered.unshift({
		name: folderName,
		path: folderPath,
		lastOpened: new Date().toISOString()
	});

	// Keep only last 10 workspaces
	context.globalState.update(STORAGE_KEY, filtered.slice(0, MAX_HISTORY));
}

async function showWorkspacePicker(context: vscode.ExtensionContext) {
	const workspaces = context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);

	if (workspaces.length === 0) {
		vscode.window.showInformationMessage('No saved workspaces yet.');
		return;
	}

	const pick = await vscode.window.showQuickPick(
		workspaces.map(ws => ({
			label: ws.name,
			description: ws.path
		})),
		{
			placeHolder: 'Select a workspace to open'
		}
	);

	if (!pick) return;

	await vscode.commands.executeCommand(
		'vscode.openFolder',
		vscode.Uri.file(pick.description!),
		false
	);
}

export function deactivate() { }
