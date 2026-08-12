/**
 * セッション中の繰り返し検出。
 *
 * 判定そのものは `core/repeatedInstructions.ts`（既存）に任せているので、
 * ここでは**その入口を通しても同じ結果になる**ことだけを確かめる。
 * 「いつ聞くか」（同じものを二度勧めない）は VS Code 側の状態なので、
 * ここでは純関数の振る舞いを固定する。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { findRepeatedInstructions } from '../core/repeatedInstructions';

test('同じ指示を 3 回書くと拾える（セッション中の入力でも同じ）', () => {
	const messages = [
		'コミットメッセージは日本語で書いてください。',
		'ログを英語にして。コミットメッセージは日本語で書いてください。',
		'コミットメッセージは日本語で書いてください。'
	];
	const repeated = findRepeatedInstructions(messages);
	assert.ok(repeated.length >= 1, JSON.stringify(repeated));
	assert.strictEqual(repeated[0].text, 'コミットメッセージは日本語で書いてください。');
	assert.ok(repeated[0].count >= 3, `count=${repeated[0].count}`);
});

test('同じメッセージの中の重複は 1 回と数える', () => {
	const twiceInOne = ['コミットメッセージは日本語で書いてください。コミットメッセージは日本語で書いてください。'];
	assert.deepStrictEqual(findRepeatedInstructions(twiceInOne), []);
});
