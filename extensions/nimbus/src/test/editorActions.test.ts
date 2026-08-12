/**
 * エディタから頼むときの文面。
 *
 * 場所を先に、コードを後に。場所さえ渡っていれば、必要なぶんは自分で読みに行ける。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	buildSelectionPrompt,
	intentChoices,
	shouldShowLens,
	truncateCode
} from '../core/editorActions';

test('選択範囲は場所つきで渡す', () => {
	assert.strictEqual(
		buildSelectionPrompt({ file: 'src/a.ts', startLine: 10, endLine: 12, code: 'const a = 1;' }, 'explain'),
		[
			'このコードが何をしているのか、なぜこう書かれているのかを説明してください。',
			'',
			'対象: src/a.ts:10–12',
			'',
			'````',
			'const a = 1;',
			'````'
		].join('\n')
	);
});

test('コードレンズから来たときはシンボル名も添える', () => {
	const prompt = buildSelectionPrompt(
		{ file: 'src/a.ts', startLine: 1, endLine: 4, code: 'x', symbol: 'createSession' },
		'refactor'
	);
	assert.ok(prompt.includes('対象: src/a.ts:1–4（createSession）'), prompt);
	assert.ok(prompt.startsWith('このコードを、**振る舞いを変えずに**整理してください。'), prompt);
});

test('自由入力のときは、書いた指示がそのまま先頭に来る', () => {
	const prompt = buildSelectionPrompt(
		{ file: 'src/a.ts', startLine: 1, endLine: 1, code: 'x' },
		'ask',
		'  ここだけ非同期にして  '
	);
	assert.ok(prompt.startsWith('ここだけ非同期にして\n'), prompt);
});

test('長い選択は切って、残りはファイルを読ませる', () => {
	const long = Array.from({ length: 250 }, (_, i) => `line ${i}`).join('\n');
	assert.deepStrictEqual(truncateCode(long, 2), { code: 'line 0\nline 1', omitted: 248 });
	assert.ok(buildSelectionPrompt({ file: 'a.ts', startLine: 1, endLine: 250, code: long }, 'explain').includes('残り 50 行'));
});

test('コードレンズは関数・メソッド・クラス・コンストラクタにだけ出す', () => {
	assert.deepStrictEqual(
		[4, 5, 8, 11, 12, 13].map(shouldShowLens),
		[true, true, true, true, false, false]
	);
});

test('選べる依頼は 4 つ', () => {
	assert.deepStrictEqual(intentChoices().map((choice) => choice.intent), ['explain', 'refactor', 'test', 'ask']);
});
