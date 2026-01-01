import * as vscode from 'vscode';
import * as path from 'path';

interface WorkspaceSession {
	name: string;
	path: string;
	openFiles: string[];
	lastOpened: string;
}

export function activate(context: vscode.ExtensionContext) {

	saveWorkspaceSession(context);

	const disposable = vscode.commands.registerCommand(
		'workspace-jumper.jump',
		() => jumpToWorkspace(context)
	);

	context.subscriptions.push(disposable);
}

function saveWorkspaceSession(context: vscode.ExtensionContext) {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) return;

	const folderPath = folders[0].uri.fsPath;
	const folderName = path.basename(folderPath);

	const openFiles = vscode.window.tabGroups.all
		.flatMap(group => group.tabs)
		.map(tab => (tab.input as any)?.uri?.fsPath)
		.filter(Boolean);

	const session: WorkspaceSession = {
		name: folderName,
		path: folderPath,
		openFiles,
		lastOpened: new Date().toISOString()
	};

	context.globalState.update('lastWorkspace', session);
}

async function jumpToWorkspace(context: vscode.ExtensionContext) {
	const session = context.globalState.get<WorkspaceSession>('lastWorkspace');

	if (!session) {
		vscode.window.showInformationMessage('No workspace saved.');
		return;
	}

	const choice = await vscode.window.showInformationMessage(
		'Resume previous workspace?',
		session.name,
		'Cancel'
	);

	if (choice === session.name) {
		await vscode.commands.executeCommand(
			'vscode.openFolder',
			vscode.Uri.file(session.path),
			false
		);
	}
}

export function deactivate() { }
