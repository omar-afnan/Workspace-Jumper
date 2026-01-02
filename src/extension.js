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
const STORAGE_KEY = 'workspace-jumper.workspaces';
const MAX_HISTORY = 10;
function activate(context) {
    console.log('workspace-jumper activated');
    // Status bar button
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.text = '$(briefcase) WorkSnap';
    statusBar.tooltip = 'Jump to Workspace';
    statusBar.command = 'workspace-jumper.jump';
    statusBar.show();
    context.subscriptions.push(statusBar);
    // Auto-resume last workspace (if VS Code opened without folder)
    const autoResume = context.globalState.get(STORAGE_KEY, [])[0];
    if (autoResume && !vscode.workspace.workspaceFolders?.length) {
        setTimeout(() => {
            vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(autoResume.path), false);
        }, 500); // half-second delay to ensure VS Code initialized
    }
    // Register command
    const disposable = vscode.commands.registerCommand('workspace-jumper.jump', async () => {
        saveCurrentWorkspace(context);
        await showWorkspacePicker(context);
    });
    context.subscriptions.push(disposable);
}
function saveCurrentWorkspace(context) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0)
        return;
    const folderPath = folders[0].uri.fsPath;
    const folderName = path.basename(folderPath);
    const workspaces = context.globalState.get(STORAGE_KEY, []);
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
async function showWorkspacePicker(context) {
    const workspaces = context.globalState.get(STORAGE_KEY, []);
    if (workspaces.length === 0) {
        vscode.window.showInformationMessage('No saved workspaces yet.');
        return;
    }
    const pick = await vscode.window.showQuickPick(workspaces.map(ws => ({
        label: ws.name,
        description: ws.path
    })), {
        placeHolder: 'Select a workspace to open'
    });
    if (!pick)
        return;
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(pick.description), false);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map