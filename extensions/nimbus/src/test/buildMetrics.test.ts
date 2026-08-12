/**
 * ビルドのようす（T-217 / T-129）の単体テスト。
 *
 * 誤差で騒がないこと、悪化を薄めないことの両立を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { compare, formatBytes, renderComparison, trimHistory } from '../core/buildMetrics';

const rec = (at: number, seconds: number, bytes?: number) => ({ at, seconds, bytes });

test('最初の記録は比べずに、その旨を書く', () => {
	const c = compare(rec(2, 10), []);
	assert.deepStrictEqual({ level: c.level, previous: c.previous }, { level: 'ok', previous: undefined });
	assert.ok(renderComparison(c).includes('これが最初の記録です'));
});

test('比べるのは平均ではなく直近（平均だと悪化が薄まる）', () => {
	const c = compare(rec(10, 20), [rec(1, 5), rec(9, 10)]);
	assert.strictEqual(c.previous?.seconds, 10);
});

test('25% 遅いと watch、50% 遅いと worse', () => {
	assert.deepStrictEqual(
		[compare(rec(2, 13), [rec(1, 10)]).level, compare(rec(2, 16), [rec(1, 10)]).level],
		['watch', 'worse']
	);
});

test('少しの揺れでは騒がない', () => {
	assert.strictEqual(compare(rec(2, 10.5), [rec(1, 10)]).level, 'ok');
});

test('1MB 増えたら watch、5MB 増えたら worse', () => {
	const mb = 1024 * 1024;
	assert.deepStrictEqual(
		[
			compare(rec(2, 10, 11 * mb), [rec(1, 10, 10 * mb)]).level,
			compare(rec(2, 10, 16 * mb), [rec(1, 10, 10 * mb)]).level
		],
		['watch', 'worse']
	);
});

test('大きさを読める形にする', () => {
	assert.deepStrictEqual([formatBytes(1536), formatBytes(5 * 1024 * 1024), formatBytes(-2048)], ['2KB', '5.0MB', '-2KB']);
});

test('記録は新しい順に、決めた数だけ残す', () => {
	assert.deepStrictEqual(trimHistory([rec(1, 1), rec(3, 3), rec(2, 2)], 2).map((r) => r.at), [3, 2]);
});

test('速くなったときは、そう書く', () => {
	assert.ok(renderComparison(compare(rec(2, 5), [rec(1, 10)])).includes('50% 速くなりました'));
});
