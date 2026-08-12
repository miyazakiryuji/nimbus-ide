/**
 * 別のエージェントの結果と並べて比べる。
 *
 * 守りたいのは **「どちらが良いかを言わない」**こと。
 * 機械が決められるのは「両方が同じ行を触った」という事実まで。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	buildComparePrompt,
	compareChanges,
	conflicting,
	describeComparison,
	overlappingLines,
	parseNameStatus
} from '../core/agentCompare';

const A = parseNameStatus(['M\tsrc/app.ts', 'A\tsrc/new.ts', 'R100\tsrc/old.ts\tsrc/moved.ts'].join('\n'));
const B = parseNameStatus(['M\tsrc/app.ts', 'M\tsrc/other.ts', 'D\tsrc/gone.ts'].join('\n'));

test('name-status を読む。改名は新しい方を見る', () => {
	assert.deepStrictEqual(A, [
		{ path: 'src/app.ts', status: 'modified' },
		{ path: 'src/new.ts', status: 'added' },
		{ path: 'src/moved.ts', status: 'renamed' }
	]);
});

const COMPARISON = compareChanges(A, B);

test('両方・片方だけを分ける', () => {
	assert.deepStrictEqual(COMPARISON, {
		both: ['src/app.ts'],
		onlyA: ['src/moved.ts', 'src/new.ts'],
		onlyB: ['src/gone.ts', 'src/other.ts']
	});
});

const DIFF_A = ['+++ b/src/app.ts', '@@ -1,0 +10,3 @@', '+++ b/src/new.ts', '@@ -0,0 +1,2 @@'].join('\n');
const DIFF_B = ['+++ b/src/app.ts', '@@ -1,0 +12,3 @@', '+++ b/src/other.ts', '@@ -0,0 +1,2 @@'].join('\n');

test('同じファイルでも、離れた行なら重ならない', () => {
	// A は 10-12 行、B は 12-14 行 → 12 行だけ重なる
	assert.deepStrictEqual(overlappingLines(DIFF_A, DIFF_B), [
		{ file: 'src/app.ts', sharedLines: 1, linesA: 3, linesB: 3 }
	]);

	const apart = ['+++ b/src/app.ts', '@@ -1,0 +100,2 @@'].join('\n');
	assert.deepStrictEqual(conflicting(overlappingLines(DIFF_A, apart)), []);
});

test('一覧は件数と、同じ行を触ったファイルを出す', () => {
	assert.strictEqual(
		describeComparison(COMPARISON, overlappingLines(DIFF_A, DIFF_B), 'Claude', '別ツール'),
		[
			'両方が触ったファイル 1 件（うち同じ行 1 件）',
			'  Claude だけ: 2 件',
			'  別ツール だけ: 2 件',
			'  同じ行: src/app.ts（1 行）'
		].join('\n')
	);
});

test('投入する文は、どちらが良いかを聞かない', () => {
	const prompt = buildComparePrompt(COMPARISON, overlappingLines(DIFF_A, DIFF_B), 'Claude', '別ツール');
	assert.ok(prompt.includes('**違いを整理してください。**'), prompt);
	assert.ok(prompt.includes('**両立するか**'), prompt);
	assert.ok(prompt.includes('**どちらが良いかは書かないでください。**'), prompt);
	assert.ok(!prompt.includes('どちらを採る'), prompt);
	assert.strictEqual(buildComparePrompt({ both: [], onlyA: [], onlyB: [] }, [], 'A', 'B'), '');
});
