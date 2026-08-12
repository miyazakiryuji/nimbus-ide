/**
 * レビュー済み／未レビューの管理（T-160）の単体テスト。
 *
 * この機能の値打ちは「**見たあとに変わったものを、見たままにしない**」ところにある。
 * そこを外すと「確認したつもりの見落とし」を作る道具になってしまうので、重点的に押さえる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	buildEntries,
	fingerprint,
	formatProgress,
	progressOf,
	pruneMarks,
	withMark,
	type ReviewMarks
} from '../core/reviewState';

const files = (pairs: [string, string][]): Map<string, string> => new Map(pairs);

test('指紋は中身が同じなら同じ、違えば違う', () => {
	assert.strictEqual(fingerprint('abc'), fingerprint('abc'));
	assert.notStrictEqual(fingerprint('abc'), fingerprint('abd'));
	// 長さも混ぜているので、並べ替えただけの文字列も区別できる
	assert.notStrictEqual(fingerprint('ab'), fingerprint('ba'));
});

test('印が無いファイルは未レビュー', () => {
	const entries = buildEntries(files([['a.ts', 'x']]), {});
	assert.deepStrictEqual(
		entries.map((e) => [e.path, e.reviewed, e.changedSinceReview]),
		[['a.ts', false, false]]
	);
});

test('見たときの指紋と一致すればレビュー済み', () => {
	const marks: ReviewMarks = { 'a.ts': fingerprint('x') };
	assert.deepStrictEqual(
		buildEntries(files([['a.ts', 'x']]), marks).map((e) => [e.reviewed, e.changedSinceReview]),
		[[true, false]]
	);
});

test('見たあとに中身が変わったら、レビュー済みは外れる（ここが要）', () => {
	const marks: ReviewMarks = { 'a.ts': fingerprint('古い') };
	assert.deepStrictEqual(
		buildEntries(files([['a.ts', '新しい']]), marks).map((e) => [e.reviewed, e.changedSinceReview]),
		[[false, true]]
	);
});

test('並びは 見たあとに変わった → 未レビュー → 済み', () => {
	const marks: ReviewMarks = { 'stale.ts': fingerprint('古い'), 'done.ts': fingerprint('d') };
	const entries = buildEntries(
		files([['done.ts', 'd'], ['fresh.ts', 'f'], ['stale.ts', '新しい']]),
		marks
	);
	assert.deepStrictEqual(entries.map((e) => e.path), ['stale.ts', 'fresh.ts', 'done.ts']);
});

test('進み具合を数える', () => {
	const marks: ReviewMarks = { 'a.ts': fingerprint('a'), 'b.ts': fingerprint('古い') };
	const entries = buildEntries(files([['a.ts', 'a'], ['b.ts', '新しい'], ['c.ts', 'c']]), marks);
	assert.deepStrictEqual(progressOf(entries), { total: 3, reviewed: 1, stale: 1 });
});

test('印を付けたり外したりできる', () => {
	const [entry] = buildEntries(files([['a.ts', 'x']]), {});
	const marked = withMark({}, entry, true);
	assert.deepStrictEqual(marked, { 'a.ts': fingerprint('x') });
	assert.deepStrictEqual(withMark(marked, entry, false), {});
});

test('印を付け直すと、そのときの中身で覚え直す', () => {
	const marks: ReviewMarks = { 'a.ts': fingerprint('古い') };
	const [entry] = buildEntries(files([['a.ts', '新しい']]), marks);
	const updated = withMark(marks, entry, true);
	assert.deepStrictEqual(
		buildEntries(files([['a.ts', '新しい']]), updated).map((e) => [e.reviewed, e.changedSinceReview]),
		[[true, false]]
	);
});

test('変更が無くなったファイルの印は捨てる（コミット後に溜め込まない）', () => {
	assert.deepStrictEqual(pruneMarks({ 'a.ts': 'x', 'b.ts': 'y' }, ['a.ts']), { 'a.ts': 'x' });
	assert.deepStrictEqual(pruneMarks({}, ['a.ts']), {});
});

test('進み具合の 1 行は、変わったものがあるときだけそれを添える', () => {
	assert.deepStrictEqual(
		[
			formatProgress({ total: 0, reviewed: 0, stale: 0 }),
			formatProgress({ total: 5, reviewed: 2, stale: 0 }),
			formatProgress({ total: 5, reviewed: 2, stale: 1 })
		],
		['変更なし', '2/5 済み', '2/5 済み · 見たあとに変わった 1']
	);
});
