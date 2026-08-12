/**
 * Webview の CSP に載せる nonce。
 * 使い回されると CSP の意味が無くなるので、毎回変わることを固定する。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { createNonce } from '../webview/nonce';

test('英数字だけの 32 文字を返す', () => {
	const nonce = createNonce();
	assert.strictEqual(nonce.length, 32);
	assert.match(nonce, /^[A-Za-z0-9]{32}$/);
});

test('呼ぶたびに違う値になる（使い回すと CSP の意味が無い）', () => {
	const values = new Set(Array.from({ length: 50 }, () => createNonce()));
	assert.strictEqual(values.size, 50);
});
