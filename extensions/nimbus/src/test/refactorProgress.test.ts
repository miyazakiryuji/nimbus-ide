/**
 * 段階的リファクタの進捗。
 *
 * 見たいのは「残り何箇所か」だけ。分母は始めたときの件数で固定し、
 * 途中で増えても壊れないようにする。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	buildRefactorPrompt,
	parseGrepCounts,
	progressOf,
	rankRemaining,
	renderProgress,
	totalOf,
	type RefactorTrack
} from '../core/refactorProgress';

const TRACK: RefactorTrack = {
	id: '1',
	label: 'getUserById を廃止',
	pattern: 'getUserById\\(',
	initial: 120,
	createdAt: 0
};

test('git grep -c の出力をファイルごとの件数にする', () => {
	const counts = parseGrepCounts('src/a.ts:3\nsrc/b/c.ts:1\n壊れた行\n\nsrc/zero.ts:0\n');
	assert.deepStrictEqual([...counts], [['src/a.ts', 3], ['src/b/c.ts', 1]]);
	assert.strictEqual(totalOf(counts), 4);
});

test('パスにコロンが含まれても最後のコロンで割る', () => {
	assert.deepStrictEqual([...parseGrepCounts('src/a:b.ts:2')], [['src/a:b.ts', 2]]);
});

test('進捗は「始めたときの件数」を分母にする', () => {
	assert.deepStrictEqual(progressOf(TRACK, 72), { track: TRACK, remaining: 72, done: 48, percent: 40 });
});

test('残りが増えても壊れない（置換済みは 0 で止める）', () => {
	assert.deepStrictEqual(
		[progressOf(TRACK, 200).done, progressOf(TRACK, 0).percent],
		[0, 100]
	);
});

test('一覧の 1 行は、進み具合と残りを両方言う', () => {
	assert.strictEqual(renderProgress(progressOf(TRACK, 72)), '██░░░ 48/120（残り 72）  getUserById を廃止');
});

test('残っている場所は多い順に並べ、上限で切る', () => {
	const counts = new Map([['src/a.ts', 1], ['src/b.ts', 5], ['src/c.ts', 5]]);
	assert.deepStrictEqual(rankRemaining(counts, 2), [
		{ file: 'src/b.ts', count: 5 },
		{ file: 'src/c.ts', count: 5 }
	]);
});

test('続きを頼む文は、残りの場所と「一度にやらない」を含む', () => {
	const prompt = buildRefactorPrompt(progressOf(TRACK, 72), [{ file: 'src/b.ts', count: 5 }]);
	assert.ok(prompt.includes('いま 48/120 箇所まで終わっていて、残りは 72 箇所です。'), prompt);
	assert.ok(prompt.includes('- src/b.ts（5 箇所）'), prompt);
	assert.ok(prompt.includes('**一度に全部やらないでください。**'), prompt);
	assert.strictEqual(buildRefactorPrompt(progressOf(TRACK, 0), []), '');
});
