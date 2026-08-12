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

test('62 文字すべてが出る（偏りを取り除く処理で末尾を切り落としていないこと）', () => {
	// 乱数から文字へ写すときに範囲を間違えると、アルファベットの後ろのほうだけが
	// 出なくなる。2000 本ぶん（64,000 文字）あれば、出ない文字があるのは実装の誤り
	const seen = new Set<string>();
	for (let i = 0; i < 2000; i++) {
		for (const char of createNonce()) {
			seen.add(char);
		}
	}
	assert.strictEqual(seen.size, 62, `出なかった文字がある: ${seen.size}/62`);
});
