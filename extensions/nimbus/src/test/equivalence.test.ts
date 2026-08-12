/**
 * 移行前後の等価性確認。
 *
 * 頼み方がすべての機能なので、**外してはいけない一文**が入っているかを固定する。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildCharacterizationPrompt, buildEquivalencePrompt } from '../core/equivalence';

const TARGET = { file: 'src/a.ts', symbol: 'parse', code: 'export function parse() {}', fromHead: false };

test('移行前は「正しい仕様」ではなく「いまのとおり」を頼む', () => {
	const prompt = buildCharacterizationPrompt(TARGET);
	assert.ok(prompt.includes('**いまの振る舞いを固定するテスト**'), prompt);
	assert.ok(prompt.includes('**仕様として正しいかは問いません。**'), prompt);
	assert.ok(prompt.includes('対象: src/a.ts（parse）'), prompt);
	assert.ok(prompt.includes('export function parse() {}'), prompt);
});

test('作業ツリーが書き換わっているときは、HEAD を使ったと明記する', () => {
	const prompt = buildCharacterizationPrompt({ ...TARGET, fromHead: true });
	assert.ok(prompt.includes('（作業ツリーは既に変わっているため、HEAD の内容を渡しています）'), prompt);
});

test('長いソースは切って、残りを読ませる', () => {
	const long = Array.from({ length: 320 }, (_, i) => `line ${i}`).join('\n');
	const prompt = buildCharacterizationPrompt({ ...TARGET, code: long });
	assert.ok(prompt.includes('残り 20 行はファイルを読んでください'), prompt);
	assert.ok(!prompt.includes('line 300'), prompt);
});

test('移行後は、落ちたテストを「変わった証拠」として仕分けさせる', () => {
	const prompt = buildEquivalencePrompt(TARGET);
	assert.ok(prompt.includes('落ちたテストは**振る舞いが変わった証拠**です。'), prompt);
	assert.ok(prompt.includes('**通すためにテストを緩めないでください。**'), prompt);
});

test('シンボルが分からないときはファイル名だけで頼む', () => {
	const prompt = buildEquivalencePrompt({ file: 'src/a.ts', code: '', fromHead: false });
	assert.ok(prompt.startsWith('移行の前に書いた「振る舞いを固定するテスト」を走らせて、src/a.ts が'), prompt);
});
