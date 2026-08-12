/**
 * 改善前後のベンチ比較（T-130）の単体テスト。
 *
 * この機能は油断すると「改善したことにする道具」になる。だから
 * **ばらつきの範囲では言い切らない**ことを軸に押さえる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	compare,
	compareAll,
	directionOf,
	formatComparison,
	median,
	parseMeasurements,
	spread
} from '../core/benchmark';

test('中央値と散らばりを出す（外れ値に引きずられない）', () => {
	assert.deepStrictEqual([median([3, 1, 2]), median([4, 1, 3, 2])], [2, 2.5]);
	// 1 件だけ極端でも中央値は動かない
	assert.strictEqual(median([10, 11, 12, 1000]), 11.5);
	assert.strictEqual(spread([10, 10, 10]), 0);
});

test('単位から「大きいほど良い」かを決める', () => {
	assert.deepStrictEqual(
		['ms', 's', 'ops/sec', 'fps', 'MB/s'].map(directionOf),
		['lower-is-better', 'lower-is-better', 'higher-is-better', 'higher-is-better', 'higher-is-better']
	);
});

test('計測らしい行だけを読む（関係ない数字を拾わない）', () => {
	const text = [
		'起動: 120.5 ms',
		'描画  98 ms',
		'スループット = 1500 ops/sec',
		'テスト 42 件',
		'バージョン 1.2.3',
		'ただの文'
	].join('\n');
	assert.deepStrictEqual(parseMeasurements(text), [
		{ label: '起動', value: 120.5, unit: 'ms' },
		{ label: '描画', value: 98, unit: 'ms' },
		{ label: 'スループット', value: 1500, unit: 'ops/sec' }
	]);
});

test('ばらつきを超えた差だけを「速くなった」と言う', () => {
	const clear = compare('起動', 'ms', [100, 101, 99, 100], [80, 81, 79, 80]);
	assert.deepStrictEqual([clear?.verdict, clear?.significant], ['faster', true]);
	assert.ok((clear?.changePercent ?? 0) > 19, String(clear?.changePercent));
});

test('ばらつきの範囲なら「判断できない」（ここが要）', () => {
	// 中央値は下がっているが、測るたびに揺れている幅に収まっている
	const noisy = compare('起動', 'ms', [100, 130, 70, 100], [95, 125, 65, 95]);
	assert.deepStrictEqual([noisy?.verdict, noisy?.significant], ['unclear', false]);
});

test('1 回ずつしか測っていなければ必ず「判断できない」', () => {
	// ばらつきが分からないので、どれだけ差があっても言い切れない
	const once = compare('起動', 'ms', [100], [50]);
	assert.deepStrictEqual([once?.verdict, once?.significant], ['unclear', false]);
});

test('大きいほど良い単位では、増えたときに「速くなった」', () => {
	const throughput = compare('処理量', 'ops/sec', [100, 101, 99, 100], [200, 201, 199, 200]);
	assert.deepStrictEqual([throughput?.verdict, throughput?.changePercent.toFixed(0)], ['faster', '100']);
});

test('遅くなったことも同じ厳しさで言う', () => {
	const slower = compare('起動', 'ms', [100, 100, 101, 99], [140, 141, 139, 140]);
	assert.deepStrictEqual([slower?.verdict, (slower?.changePercent ?? 0) < 0], ['slower', true]);
});

test('片方しか計測が無ければ比べない', () => {
	assert.strictEqual(compare('x', 'ms', [], [1, 2]), undefined);
	assert.strictEqual(compare('x', 'ms', [1, 2], []), undefined);
});

test('同じ名前どうしだけを突き合わせ、言い切れるものを先に出す', () => {
	const before = parseMeasurements('起動: 100 ms\n起動: 101 ms\n描画: 50 ms\n描画: 51 ms\n消えた: 10 ms');
	const after = parseMeasurements('起動: 60 ms\n起動: 61 ms\n描画: 50 ms\n描画: 51 ms\n新しい: 5 ms');
	const results = compareAll(before, after);
	// 「消えた」「新しい」は片側にしか無いので比べない
	assert.deepStrictEqual(results.map((r) => [r.label, r.verdict]), [['起動', 'faster'], ['描画', 'unclear']]);
});

test('報告は「改善したことにしない」と釘を刺す', () => {
	const out = formatComparison(compareAll(
		parseMeasurements('起動: 100 ms\n起動: 130 ms'),
		parseMeasurements('起動: 95 ms\n起動: 125 ms')
	));
	assert.ok(out.includes('## 差があるとは言えないもの'), out);
	assert.ok(out.includes('改善したことにしないでください'), out);
	assert.ok(out.includes('回数を増やして測り直す'), out);
});

test('突き合わせるものが無いときは、読み取りかたを教える', () => {
	const out = formatComparison([]);
	assert.ok(out.includes('同じ名前**が見つかりませんでした') || out.includes('同じ名前'), out);
	assert.ok(out.includes('12.3 ms'), out);
});
