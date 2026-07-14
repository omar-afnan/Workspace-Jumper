import * as crypto from 'crypto';

// ─── INTERFACES ────────────────────────────────────────────────────────────────
// Shared, VS Code-API-free types and pure helper functions.
// Kept separate from extension.ts so they can be unit tested without
// depending on (or mocking) the `vscode` module.

export interface WorkspaceSession {
	id: string;
	nickname: string;
	encryptedPath: string;
	lastOpened: string;
	isSensitive: boolean;
}

export const ALGORITHM = 'aes-256-gcm';

// ─── ENCRYPTION ────────────────────────────────────────────────────────────────

export function generateEncryptionKey(): string {
	return crypto.randomBytes(32).toString('hex');
}

export function encrypt(text: string, keyHex: string): string {
	const key = Buffer.from(keyHex, 'hex');
	const iv = crypto.randomBytes(16);
	const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
	let encrypted = cipher.update(text, 'utf8', 'hex');
	encrypted += cipher.final('hex');
	const authTag = cipher.getAuthTag();
	return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decrypt(encryptedData: string, keyHex: string): string {
	try {
		const key = Buffer.from(keyHex, 'hex');
		const parts = encryptedData.split(':');
		if (parts.length !== 3) { throw new Error('Invalid encrypted data format'); }
		const iv = Buffer.from(parts[0], 'hex');
		const authTag = Buffer.from(parts[1], 'hex');
		const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
		decipher.setAuthTag(authTag);
		let decrypted = decipher.update(parts[2], 'hex', 'utf8');
		decrypted += decipher.final('utf8');
		return decrypted;
	} catch {
		return '';
	}
}

export function generateId(): string {
	return crypto.randomBytes(8).toString('hex');
}

// ─── HTML HELPERS ──────────────────────────────────────────────────────────────

export function escapeHtml(input: string): string {
	const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
	return input.replace(/[&<>"']/g, (c) => map[c] ?? c);
}

export function buildCardHtml(ws: WorkspaceSession, decrypted: string): string {
	const displayPath = decrypted.split(/[\\/]/).slice(-2).join('/');
	const lockIcon = ws.isSensitive ? '<span class="codicon codicon-lock sensitive-icon"></span>' : '';
	return `
		<div class="card">
			<div class="card-header">
				<div class="title">
					<span class="codicon codicon-folder"></span>
					<span class="workspace-name">${escapeHtml(ws.nickname)}</span>
					${lockIcon}
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
		</div>`;
}
