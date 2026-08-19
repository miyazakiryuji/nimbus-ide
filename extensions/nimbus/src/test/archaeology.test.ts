/**
 * 考古学モード。
 *
 * `git blame --line-porcelain` は、**同じコミットが続くとヘッダを省略する**。
 * そこを取りこぼすと、行ごとに作者が消えたり日付が空になったりする。
 *
 * 守っている修正（T-274）: T-079 / T-174
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildArchaeologyPrompt, describeCommit, groupByCommit, parseBlamePorcelain } from '../core/archaeology';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

const BLAME = [
	`${A} 10 10 2`,
	'author 宮崎',
	'author-time 1755000000',
	'summary 最初の実装',
	'filename src/a.ts',
	'\tconst a = 1;',
	`${A} 11 11`,
	'\tconst b = 2;',
	`${B} 12 12 1`,
	'author 別の人',
	'author-time 1755100000',
	'summary 境界を直す',
	'filename src/a.ts',
	'\tif (a >= b) {}'
].join('\n');

test('省略されたヘッダは直前のコミットの情報を引き継ぐ', () => {
	const lines = parseBlamePorcelain(BLAME);
	assert.deepStrictEqual(
		lines.map((line) => [line.line, line.commit.slice(0, 1), line.author, line.summary]),
		[
			[10, 'a', '宮崎', '最初の実装'],
			[11, 'a', '宮崎', '最初の実装'],
			[12, 'b', '別の人', '境界を直す']
		]
	);
});

test('コミット単位にまとめ、新しい順に並べる', () => {
	const groups = groupByCommit(parseBlamePorcelain(BLAME));
	assert.deepStrictEqual(
		groups.map((group) => [group.summary, group.lines]),
		[['境界を直す', [12]], ['最初の実装', [10, 11]]]
	);
});

test('1 行の表示は日付・要約・作者・行数を持つ', () => {
	const [newest] = groupByCommit(parseBlamePorcelain(BLAME));
	assert.strictEqual(describeCommit(newest), `${newest.date}  境界を直す  (別の人 · 1 行)`);
});

test('投入する文は「なぜ」を聞き、推測を禁じる', () => {
	const groups = groupByCommit(parseBlamePorcelain(BLAME));
	const prompt = buildArchaeologyPrompt('src/a.ts', 10, 12, groups, 'const a = 1;');
	assert.ok(prompt.startsWith('src/a.ts:10–12 が**なぜこうなっているのか**を調べてください。'), prompt);
	assert.ok(prompt.includes('**推測を事実として書かないでください。**'), prompt);
	assert.ok(prompt.includes('`bbbbbbbb`'), prompt);
	assert.strictEqual(buildArchaeologyPrompt('src/a.ts', 1, 1, [], ''), '');
});

test('空の出力でも落ちない', () => {
	assert.deepStrictEqual(parseBlamePorcelain(''), []);
	assert.deepStrictEqual(groupByCommit([]), []);
});
