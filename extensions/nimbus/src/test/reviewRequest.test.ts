/**
 * レビュー依頼の文（T-211）の単体テスト。
 *
 * **テストから読ませる**（何を期待しているかが先に分かる）を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { readingOrder, renderReviewRequest } from '../core/reviewRequest';
import { parseNumstat, summarize } from '../core/changeStats';

const stats = summarize(parseNumstat(['50\t2\tsrc/big.ts', '5\t0\tsrc/test/small.test.ts'].join('\n')));

test('読む順はテストから（大きい順ではない）', () => {
	assert.deepStrictEqual(readingOrder(stats), ['src/test/small.test.ts', 'src/big.ts']);
});

test('意図が無ければ、書く場所を空けて示す', () => {
	assert.ok(renderReviewRequest({ branch: 'a', base: 'b', stats }).startsWith('（何のための変更かを 1 行で'));
});

test('意図があればそれを先頭に置く', () => {
	assert.ok(renderReviewRequest({ branch: 'a', base: 'b', stats, intent: '課金の判定を直しました' }).startsWith('課金の判定を直しました'));
});

test('規模と、あれば URL を添える', () => {
	const text = renderReviewRequest({ branch: 'a', base: 'b', stats, url: 'https://example.com/pr/1' });
	assert.deepStrictEqual(
		['2 ファイル（+55 / -2）', 'https://example.com/pr/1'].map((s) => text.includes(s)),
		[true, true]
	);
});

test('テストが無いときは、そのことを自分から書く', () => {
	const noTests = summarize(parseNumstat('10\t0\tsrc/a.ts'));
	assert.ok(renderReviewRequest({ branch: 'a', base: 'b', stats: noTests }).includes('テストは変えていません'));
});

test('テストがあるときは、あると書く', () => {
	assert.ok(renderReviewRequest({ branch: 'a', base: 'b', stats }).includes('テストも一緒に変えてあります'));
});

test('見てほしい観点は、指定したときだけ出す', () => {
	assert.ok(!renderReviewRequest({ branch: 'a', base: 'b', stats }).includes('とくに見てほしい'));
	assert.ok(renderReviewRequest({ branch: 'a', base: 'b', stats, focus: '境界値' }).includes('とくに見てほしいところ: 境界値'));
});
