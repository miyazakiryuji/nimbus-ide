/**
 * 使用量の見せかたの単体テスト。
 *
 * 数字そのものではなく「割合」と「残り時間」に変換するところが本体なので、
 * 取れなかったとき（null）に 0% と誤って出さないことを重点的に押さえる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { bar, contextGauge, costAlertLevel, formatCost, formatReset, formatTokens, toGauges } from '../core/usage';

const NOW = Date.parse('2026-08-13T12:00:00Z');

test('トークン数は桁で読ませる', () => {
	assert.deepStrictEqual(
		[formatTokens(0), formatTokens(999), formatTokens(1234), formatTokens(1_500_000)],
		['0', '999', '1.2k', '1.50M']
	);
});

test('費用は小さすぎる額を 0 と出さない（無料で動いていると誤解させない）', () => {
	assert.deepStrictEqual([formatCost(0), formatCost(0.00001), formatCost(1.23456)], ['$0.0000', '<$0.0001', '$1.2346']);
});

test('ゲージは 0〜100 に収め、取れないときは空の枠を出す', () => {
	assert.deepStrictEqual(
		[bar(0, 10), bar(50, 10), bar(100, 10), bar(150, 10), bar(null, 10), bar(undefined, 10)],
		['░░░░░░░░░░', '█████░░░░░', '██████████', '██████████', '──────────', '──────────']
	);
});

test('リセットまでの残り時間は、過ぎていても負の時間を出さない', () => {
	assert.deepStrictEqual(
		[
			formatReset('2026-08-13T12:30:00Z', NOW),
			formatReset('2026-08-13T14:15:00Z', NOW),
			formatReset('2026-08-15T12:00:00Z', NOW),
			formatReset('2026-08-13T11:00:00Z', NOW),
			formatReset(null, NOW),
			formatReset('こわれた日付', NOW)
		],
		['30 分後にリセット', '2 時間 15 分後にリセット', '2 日後にリセット', 'まもなくリセット', '', '']
	);
});

test('週の枠は対話とアプリ経由で分けて出す（合算すると余裕があると誤読する）', () => {
	const gauges = toGauges(
		{
			five_hour: { utilization: 42, resets_at: '2026-08-13T13:00:00Z' },
			seven_day: { utilization: 10, resets_at: null },
			seven_day_oauth_apps: { utilization: 90, resets_at: null }
		},
		NOW
	);
	assert.deepStrictEqual(
		gauges.map((g) => [g.label, g.detail]),
		[
			['5 時間', '42% · 1 時間後にリセット'],
			['週（対話）', '10%'],
			['週（アプリ経由）', '90%']
		]
	);
});

test('枠が取れないときは 0% ではなく「取得できず」と出す', () => {
	const [gauge] = toGauges({ five_hour: { utilization: null, resets_at: null } }, NOW);
	assert.deepStrictEqual([gauge.percent, gauge.detail, gauge.bar], [undefined, '取得できず', '──────────']);
});

test('枠が無ければゲージも作らない', () => {
	assert.deepStrictEqual(toGauges(null, NOW), []);
	assert.deepStrictEqual(toGauges({}, NOW), []);
});

test('文脈のゲージは上限が分からないときに割合を出さない', () => {
	assert.deepStrictEqual(contextGauge(50_000, 200_000).detail, '50.0k / 200.0k · 25%');
	assert.strictEqual(contextGauge(1000, 0).percent, undefined);
});

test('コスト上限は 0 なら「上限なし」として扱う', () => {
	assert.strictEqual(costAlertLevel(999, 0), 'none');
	assert.strictEqual(costAlertLevel(999, -1), 'none');
});

test('コスト上限は 80% で警告、超えたら over', () => {
	assert.deepStrictEqual(
		[costAlertLevel(0.5, 1), costAlertLevel(0.8, 1), costAlertLevel(1, 1), costAlertLevel(1.5, 1)],
		['none', 'warn', 'over', 'over']
	);
	// 警告を出す割合は変えられる
	assert.strictEqual(costAlertLevel(0.5, 1, 50), 'warn');
});
