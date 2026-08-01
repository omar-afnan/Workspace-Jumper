import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import {
	encrypt,
	decrypt,
	generateEncryptionKey,
	generateId,
	generateNonce,
	escapeHtml,
	buildCardHtml,
	WorkspaceSession
} from '../utils';

// These tests cover the pure, VS Code-API-free logic in src/utils.ts.
// They run under Node's built-in test runner (no `vscode` module required),
// unlike src/test/extension.test.ts which needs the @vscode/test-electron harness.

describe('encrypt/decrypt', () => {
	test('round-trips plaintext with a generated key', () => {
		const key = generateEncryptionKey();
		const plaintext = 'C:\\Users\\dev\\projects\\my-secret-project';
		const encrypted = encrypt(plaintext, key);
		assert.equal(decrypt(encrypted, key), plaintext);
	});

	test('round-trips unicode and empty strings', () => {
		const key = generateEncryptionKey();
		assert.equal(decrypt(encrypt('', key), key), '');
		assert.equal(decrypt(encrypt('日本語/emoji-🚀/path', key), key), '日本語/emoji-🚀/path');
	});

	test('produces a different ciphertext each time (random IV)', () => {
		const key = generateEncryptionKey();
		const a = encrypt('same input', key);
		const b = encrypt('same input', key);
		assert.notEqual(a, b);
	});

	test('encrypted payload has the expected iv:authTag:cipherText shape', () => {
		const key = generateEncryptionKey();
		const encrypted = encrypt('hello', key);
		const parts = encrypted.split(':');
		assert.equal(parts.length, 3);
		assert.match(parts[0], /^[0-9a-f]{32}$/); // 16-byte IV as hex
		assert.match(parts[1], /^[0-9a-f]{32}$/); // 16-byte GCM auth tag as hex
	});

	test('decrypt returns empty string for garbage input', () => {
		const key = generateEncryptionKey();
		assert.equal(decrypt('not-encrypted-data', key), '');
		assert.equal(decrypt('a:b', key), '');
		assert.equal(decrypt('', key), '');
	});

	test('decrypt returns empty string when the wrong key is used', () => {
		const key = generateEncryptionKey();
		const otherKey = generateEncryptionKey();
		const encrypted = encrypt('sensitive path', key);
		assert.equal(decrypt(encrypted, otherKey), '');
	});

	test('decrypt returns empty string when ciphertext is tampered with (auth tag mismatch)', () => {
		const key = generateEncryptionKey();
		const encrypted = encrypt('sensitive path', key);
		const [iv, authTag, cipherText] = encrypted.split(':');
		// Flip the last hex character of the cipher text to simulate tampering.
		const tamperedChar = cipherText.at(-1) === '0' ? '1' : '0';
		const tampered = `${iv}:${authTag}:${cipherText.slice(0, -1)}${tamperedChar}`;
		assert.equal(decrypt(tampered, key), '');
	});
});

describe('generateEncryptionKey / generateId', () => {
	test('generateEncryptionKey returns a 64-char hex string (32 bytes)', () => {
		const key = generateEncryptionKey();
		assert.match(key, /^[0-9a-f]{64}$/);
	});

	test('generateEncryptionKey is not deterministic', () => {
		assert.notEqual(generateEncryptionKey(), generateEncryptionKey());
	});

	test('generateId returns a 16-char hex string (8 bytes)', () => {
		const id = generateId();
		assert.match(id, /^[0-9a-f]{16}$/);
	});

	test('generateId is not deterministic', () => {
		assert.notEqual(generateId(), generateId());
	});

	test('generateNonce returns base64 and is not deterministic', () => {
		const nonce = generateNonce();
		assert.match(nonce, /^[A-Za-z0-9+/]+={0,2}$/);
		assert.notEqual(generateNonce(), generateNonce());
	});
});

describe('escapeHtml', () => {
	test('escapes all HTML-significant characters', () => {
		assert.equal(
			escapeHtml(`<script>alert('xss')</script> & "quotes"`),
			'&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt; &amp; &quot;quotes&quot;'
		);
	});

	test('leaves plain text untouched', () => {
		assert.equal(escapeHtml('My Project 123'), 'My Project 123');
	});

	test('handles empty string', () => {
		assert.equal(escapeHtml(''), '');
	});
});

describe('buildCardHtml', () => {
	const baseWs: WorkspaceSession = {
		id: 'abc123',
		nickname: 'My Project',
		encryptedPath: 'irrelevant-for-this-test',
		lastOpened: new Date().toISOString(),
		isSensitive: false
	};

	test('escapes a malicious nickname so it cannot break out of the HTML text node', () => {
		const malicious = '<img src=x onerror=alert(1)>';
		const html = buildCardHtml({ ...baseWs, nickname: malicious }, 'C:\\Users\\dev\\proj');
		assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
		assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
	});

	test('shows only the last two path segments as the display path', () => {
		const html = buildCardHtml(baseWs, 'C:\\Users\\dev\\workspaces\\my-project');
		assert.ok(html.includes('workspaces/my-project'));
		assert.ok(!html.includes('C:\\Users\\dev'));
	});

	test('renders the lock icon only when isSensitive is true', () => {
		const sensitiveHtml = buildCardHtml({ ...baseWs, isSensitive: true }, 'C:\\p');
		const normalHtml = buildCardHtml({ ...baseWs, isSensitive: false }, 'C:\\p');
		assert.ok(sensitiveHtml.includes('sensitive-icon'));
		assert.ok(!normalHtml.includes('sensitive-icon'));
	});

	test('URL-encodes the decrypted path used for the "Open" button', () => {
		const html = buildCardHtml(baseWs, 'C:\\Users\\dev\\my project');
		assert.ok(html.includes(encodeURIComponent('C:\\Users\\dev\\my project')));
	});

	test('uses data-action attributes rather than inline on* handlers', () => {
		// Inline handlers are blocked by the webview CSP, and an inline
		// onclick="remove(...)" would resolve to Element.prototype.remove
		// instead of our handler - silently breaking the delete button.
		const html = buildCardHtml(baseWs, 'C:\\Users\\dev\\proj');
		assert.ok(!html.includes('onclick'));
		assert.ok(html.includes('data-action="resume"'));
		assert.ok(html.includes('data-action="edit"'));
		assert.ok(html.includes('data-action="remove"'));
	});

	test('carries the workspace id on the edit and remove buttons', () => {
		const html = buildCardHtml(baseWs, 'C:\\p');
		assert.ok(html.includes('data-action="edit" data-id="abc123"'));
		assert.ok(html.includes('data-action="remove" data-id="abc123"'));
	});

	test('escapes the id so a crafted entry cannot break out of the attribute', () => {
		const html = buildCardHtml({ ...baseWs, id: '" onload="alert(1)' }, 'C:\\p');
		// The quotes must be neutralised, which leaves `onload=` as inert text
		// inside the attribute value rather than a new attribute.
		assert.ok(html.includes('data-id="&quot; onload=&quot;alert(1)"'));
		assert.ok(!html.includes('onload="alert(1)"'));
	});

	describe('status handling', () => {
		test('an ok entry has an enabled Open button and no warning', () => {
			const html = buildCardHtml(baseWs, 'C:\\Users\\dev\\proj', 'ok');
			assert.ok(!html.includes('disabled'));
			assert.ok(!html.includes('card-warning'));
			assert.ok(!html.includes('card-broken'));
		});

		test('a missing folder disables Open and explains why', () => {
			const html = buildCardHtml(baseWs, 'C:\\Users\\dev\\gone', 'missing');
			assert.ok(html.includes('disabled'));
			assert.ok(html.includes('card-broken'));
			assert.ok(html.includes('no longer exists on disk'));
			// The dead path must not be wired up as an openable target.
			assert.ok(!html.includes('data-action="resume"'));
		});

		test('an undecryptable entry hides the path and disables Open', () => {
			const html = buildCardHtml(baseWs, '', 'undecryptable');
			assert.ok(html.includes('disabled'));
			assert.ok(html.includes('path-unavailable'));
			assert.ok(html.includes('Could not decrypt'));
			assert.ok(!html.includes('data-action="resume"'));
		});

		test('a broken entry can still be edited and removed', () => {
			const html = buildCardHtml(baseWs, '', 'undecryptable');
			assert.ok(html.includes('data-action="edit"'));
			assert.ok(html.includes('data-action="remove"'));
		});
	});
});
