/**
 * コピーしたエラー文の判定。
 *
 * **迷ったら反応しない**が要件。関係ないコピーのたびに聞かれると、通知ごと切られる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildClipboardPrompt, hintHeadline, looksLikeError } from '../core/clipboardHints';

test('言い切れる目印があるものだけをエラーと見る', () => {
	assert.deepStrictEqual(
		[
			'TypeError: Cannot read properties of undefined (reading "x")',
			'Traceback (most recent call last):\n  File "a.py", line 3',
			'panic: runtime error: index out of range',
			'error[E0308]: mismatched types'
		].map(looksLikeError),
		[true, true, true, true]
	);
});

test('普通の文やコードには反応しない', () => {
	assert.deepStrictEqual(
		[
			'const a = 1;',
			'このあたりを直したいと思っています。よろしくお願いします。',
			'error'
		].map(looksLikeError),
		[false, false, false]
	);
});

test('短すぎる・長すぎるものは相手にしない', () => {
	assert.strictEqual(looksLikeError('Error: x'), false);
	assert.strictEqual(looksLikeError(`TypeError: ${'x'.repeat(20001)}`), false);
});

test('見出しに中身を出さない（クリップボードを画面に晒さない）', () => {
	const secret = 'TypeError: token=abcdef の処理で失敗\n  at f (a.ts:1:1)';
	const headline = hintHeadline(secret);
	assert.ok(!headline.includes('abcdef'), headline);
	assert.strictEqual(headline, 'コピーした内容がエラーのようです（2 行）。調べますか？');
});

test('投入する文はエラーをそのまま囲む', () => {
	const prompt = buildClipboardPrompt('  TypeError: x  ');
	assert.ok(prompt.includes('````\nTypeError: x\n````'), prompt);
	assert.ok(prompt.startsWith('コピーしたエラーです。'), prompt);
});
