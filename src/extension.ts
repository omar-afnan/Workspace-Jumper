import * as vscode from 'vscode';
import * as path from 'path';

interface WorkspaceSession {
	name: string;
	path: string;
	lastOpened: string;
}

const STORAGE_KEY = 'workspace-jumper.workspaces';

export function activate(context: vscode.ExtensionContext) {
	console.log('workspace-jumper activated');

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

	const workspaces =
		context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);

	// Remove duplicate entry if exists
	const filtered = workspaces.filter(ws => ws.path !== folderPath);

	filtered.unshift({
		name: folderName,
		path: folderPath,
		lastOpened: new Date().toISOString()
	});

	context.globalState.update(STORAGE_KEY, filtered);
}

async function showWorkspacePicker(context: vscode.ExtensionContext) {
	const workspaces =
		context.globalState.get<WorkspaceSession[]>(STORAGE_KEY, []);

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
