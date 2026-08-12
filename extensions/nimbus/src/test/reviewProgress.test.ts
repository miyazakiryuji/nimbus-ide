/**
 * レビューの進み（T-160）の単体テスト。
 *
 * 芯は「**見たあとに変わったら、見ていないのと同じ**」。ここを外すと嘘の進捗になる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { fingerprint, markReviewed, prune, renderProgress, statusFor, unmark } from '../core/reviewProgress';

const empty = { marks: [] };

test('印を付けると「見た」になる', () => {
	const state = markReviewed(empty, 'a.ts', '中身', 1);
	assert.deepStrictEqual(statusFor(state, [{ path: 'a.ts', content: '中身' }]), [
		{ path: 'a.ts', reviewed: true, changedSinceReview: false }
	]);
});

test('見たあとに変わっていたら、見ていない扱いに戻る', () => {
	const state = markReviewed(empty, 'a.ts', '中身', 1);
	assert.deepStrictEqual(statusFor(state, [{ path: 'a.ts', content: '変わった中身' }]), [
		{ path: 'a.ts', reviewed: false, changedSinceReview: true }
	]);
});

test('印を外せる', () => {
	const state = unmark(markReviewed(empty, 'a.ts', 'x', 1), 'a.ts');
	assert.deepStrictEqual(state.marks, []);
});

test('同じファイルに 2 度印を付けても 1 つ', () => {
	const state = markReviewed(markReviewed(empty, 'a.ts', 'x', 1), 'a.ts', 'y', 2);
	assert.deepStrictEqual(state.marks.map((m) => m.at), [2]);
});

test('差分から消えたファイルの印は捨てる', () => {
	const state = markReviewed(markReviewed(empty, 'a.ts', 'x', 1), 'b.ts', 'y', 2);
	assert.deepStrictEqual(prune(state, ['a.ts']).marks.map((m) => m.path), ['a.ts']);
});

test('指紋は中身が変われば変わる', () => {
	assert.notStrictEqual(fingerprint('あ'), fingerprint('い'));
});

test('進みと、見直しが要るものを数える', () => {
	const state = markReviewed(empty, 'a.ts', '古い', 1);
	const text = renderProgress(statusFor(state, [{ path: 'a.ts', content: '新しい' }, { path: 'b.ts', content: 'x' }]));
	assert.deepStrictEqual(
		['見た: **0 / 2**', '見たあとに変わった: 1', '🔄', '⬜️'].map((s) => text.includes(s)),
		[true, true, true, true]
	);
});

test('見るものが無ければ、その旨だけを書く', () => {
	assert.ok(renderProgress([]).includes('見るものがありません'));
});
