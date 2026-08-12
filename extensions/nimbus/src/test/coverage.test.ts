/**
 * カバレッジ差分。
 *
 * 見たいのは「この変更で足した行が実行されたか」だけ。
 * 計測対象でない行（空行・コメント）を未カバー扱いすると、直しようのない指摘で埋まる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	buildCoveragePrompt,
	formatLineRanges,
	parseAddedLines,
	renderCoverageDiff,
	uncoveredAmong
} from '../core/coverage';

const DIFF = [
	'diff --git a/src/a.ts b/src/a.ts',
	'--- a/src/a.ts',
	'+++ b/src/a.ts',
	'@@ -10,0 +11,2 @@',
	'+const a = 1;',
	'+const b = 2;',
	'@@ -20,1 +22,1 @@',
	'-old',
	'+new',
	'diff --git a/src/removed.ts b/src/removed.ts',
	'--- a/src/removed.ts',
	'+++ /dev/null',
	'@@ -1,3 +0,0 @@',
	'-gone'
].join('\n');

test('git diff -U0 から、足された行だけを取り出す', () => {
	assert.deepStrictEqual([...parseAddedLines(DIFF)], [['src/a.ts', [11, 12, 22]]]);
});

test('削除だけの hunk と、消えたファイルは数えない', () => {
	const onlyDeletes = ['+++ b/src/b.ts', '@@ -5,2 +5,0 @@', '-x', '-y'].join('\n');
	assert.deepStrictEqual([...parseAddedLines(onlyDeletes)], []);
});

test('計測されていない行は未カバーにしない', () => {
	const executed = new Map([
		[11, true],
		[12, false]
		// 22 行目は計測対象外（空行・コメントなど）
	]);
	assert.deepStrictEqual(uncoveredAmong([11, 12, 22], executed), { uncovered: [12], measured: 2 });
});

test('連番は範囲に畳む', () => {
	assert.strictEqual(formatLineRanges([14, 15, 22, 23, 24, 30, 30]), '14–15, 22–24, 30');
	assert.strictEqual(formatLineRanges([]), '');
});

test('未カバーがあるファイルだけを出す', () => {
	assert.strictEqual(
		renderCoverageDiff([
			{ file: 'src/a.ts', added: [11, 12, 13], uncovered: [12, 13], measured: 3 },
			{ file: 'src/b.ts', added: [1], uncovered: [], measured: 1 }
		]),
		'src/a.ts — 追加 3 行中 2 行が未カバー: 12–13'
	);
});

test('全部通っていれば、そう言う。実行そのものが無ければ促す', () => {
	assert.strictEqual(
		renderCoverageDiff([{ file: 'src/a.ts', added: [1, 2], uncovered: [], measured: 2 }]),
		'足した行のうち計測できた 2 行は、すべてテストで実行されています。'
	);
	assert.ok(renderCoverageDiff([]).startsWith('カバレッジを計測した実行が見つかりません'));
});

test('投入する文は場所を挙げてテストを頼む。未カバーが無ければ何も作らない', () => {
	const prompt = buildCoveragePrompt([{ file: 'src/a.ts', added: [11, 12], uncovered: [12], measured: 2 }]);
	assert.ok(prompt.includes('- src/a.ts:12'), prompt);
	assert.strictEqual(buildCoveragePrompt([{ file: 'src/a.ts', added: [1], uncovered: [], measured: 1 }]), '');
});
