import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import {
	encrypt,
	decrypt,
	generateEncryptionKey,
	generateId,
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
});
