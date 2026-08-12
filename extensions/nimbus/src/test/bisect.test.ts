/**
 * 二分探索デバッグ（T-183）の単体テスト。
 *
 * 「あと何回で決まるか」が分かることが要点なので、回数と収束を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { culprit, narrow, nextIndex, remainingSteps, renderBisect } from '../core/bisect';

const commits = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'];
const start = { commits, goodIndex: 0, badIndex: 7 };

test('次に見るのは真ん中', () => {
	assert.strictEqual(nextIndex(start), 3);
});

test('残り回数を log2 で見積もる', () => {
	assert.deepStrictEqual(
		[remainingSteps(start), remainingSteps({ commits, goodIndex: 0, badIndex: 2 })],
		[3, 1]
	);
});

test('good なら下限が、bad なら上限が動く', () => {
	assert.deepStrictEqual(
		[narrow(start, 3, 'good').goodIndex, narrow(start, 3, 'bad').badIndex],
		[3, 3]
	);
});

test('範囲が詰まったら犯人が確定する', () => {
	const narrowed = { commits, goodIndex: 3, badIndex: 4 };
	assert.deepStrictEqual([nextIndex(narrowed), culprit(narrowed)], [undefined, 'c4']);
});

test('確定したら git show の行を出す', () => {
	assert.ok(renderBisect({ commits, goodIndex: 3, badIndex: 4 }).includes('git show c4'));
});

test('確定前は、残り回数と次に見る場所を出す', () => {
	const text = renderBisect(start);
	assert.deepStrictEqual(
		['候補: **6 コミット**', '残り **3 回**', 'git checkout c3'].map((s) => text.includes(s)),
		[true, true, true]
	);
});

test('何度か狭めれば必ず 1 つに決まる', () => {
	let state = start;
	let guard = 0;
	while (nextIndex(state) !== undefined && guard++ < 10) {
		// c5 で壊れたことにする
		const index = nextIndex(state) as number;
		state = narrow(state, index, index >= 5 ? 'bad' : 'good');
	}
	assert.strictEqual(culprit(state), 'c5');
});
