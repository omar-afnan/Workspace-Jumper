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

export function generateNonce(): string {
	return crypto.randomBytes(16).toString('base64');
}

// ─── HTML HELPERS ──────────────────────────────────────────────────────────────

export function escapeHtml(input: string): string {
	const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
	return input.replace(/[&<>"']/g, (c) => map[c] ?? c);
}

/**
 * Health of a stored workspace entry, decided by the caller (which has fs access).
 * - `ok`       — path decrypted and exists on disk
 * - `missing`  — path decrypted but the folder is gone (moved/deleted)
 * - `undecryptable` — decryption failed, usually a lost/rotated SecretStorage key
 */
export type WorkspaceStatus = 'ok' | 'missing' | 'undecryptable';

export function buildCardHtml(
	ws: WorkspaceSession,
	decrypted: string,
	status: WorkspaceStatus = 'ok'
): string {
	const displayPath = decrypted.split(/[\\/]/).slice(-2).join('/');
	const lockIcon = ws.isSensitive ? '<span class="codicon codicon-lock sensitive-icon"></span>' : '';

	// Buttons are wired up by delegated listeners in the webview script (see
	// getDashboardHtml). Inline on* handlers cannot be used under the CSP, and
	// an inline `onclick="remove(...)"` would in any case resolve to
	// Element.prototype.remove rather than our own function.
	const idAttr = escapeHtml(ws.id);

	const openButton = status === 'ok'
		? `<button class="btn-primary" data-action="resume" data-path="${encodeURIComponent(decrypted)}">
					<span class="codicon codicon-play"></span> Open
				</button>`
		: `<button class="btn-primary" disabled title="${status === 'missing' ? 'Folder no longer exists on disk' : 'Path could not be decrypted'}">
					<span class="codicon codicon-play"></span> Open
				</button>`;

	const warning = status === 'missing'
		? `<div class="card-warning"><span class="codicon codicon-warning"></span> Folder no longer exists on disk</div>`
		: status === 'undecryptable'
			? `<div class="card-warning"><span class="codicon codicon-warning"></span> Could not decrypt this path &mdash; remove it and re-add the workspace</div>`
			: '';

	const pathRow = status === 'undecryptable'
		? '<div class="path path-unavailable">path unavailable</div>'
		: `<div class="path">${escapeHtml(displayPath)}</div>`;

	return `
		<div class="card${status === 'ok' ? '' : ' card-broken'}">
			<div class="card-header">
				<div class="title">
					<span class="codicon codicon-folder"></span>
					<span class="workspace-name">${escapeHtml(ws.nickname)}</span>
					${lockIcon}
				</div>
			</div>
			${pathRow}
			${warning}
			<div class="actions">
				${openButton}
				<button class="btn-icon" data-action="edit" data-id="${idAttr}" title="Edit">
					<span class="codicon codicon-edit"></span>
				</button>
				<button class="btn-icon btn-icon-danger" data-action="remove" data-id="${idAttr}" title="Delete">
					<span class="codicon codicon-trash"></span>
				</button>
			</div>
		</div>`;
}
