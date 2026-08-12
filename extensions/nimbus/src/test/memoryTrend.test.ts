/**
 * メモリの増え方と、起動時間。
 *
 * どちらも「**ぶれで騒がない**」ことが本体。
 * 毎回警告が出るようになった時点で、誰も読まなくなる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	buildLeakPrompt,
	describeTrend,
	formatBytes,
	judgeLeak,
	measureTrend,
	parseSamples
} from '../core/memoryTrend';
import {
	buildStartupPrompt,
	compareStartup,
	describeComparison,
	parseStartupInfo,
	regressions
} from '../core/startupTiming';

test('数値・key=value・JSON のどれでも読み、単位はバイトに直す', () => {
	assert.deepStrictEqual(parseSamples('1048576\n2097152\n'), [
		{ index: 0, bytes: 1048576, label: undefined },
		{ index: 1, bytes: 2097152, label: undefined }
	]);
	assert.deepStrictEqual(parseSamples('heapUsed=1 MB\nrss: 2 MB'), [
		{ index: 0, bytes: 1048576, label: 'heapUsed' },
		{ index: 1, bytes: 2097152, label: 'rss' }
	]);
	assert.deepStrictEqual(parseSamples('[{"heapUsed": 100}, {"heapUsed": 200}]'), [
		{ index: 0, bytes: 100, label: undefined },
		{ index: 1, bytes: 200, label: undefined }
	]);
	assert.deepStrictEqual(parseSamples('壊れています'), []);
});

test('3 点未満では何も言わない', () => {
	assert.strictEqual(measureTrend(parseSamples('100\n200')), undefined);
});

const LEAKING = measureTrend(parseSamples('10 MB\n20 MB\n30 MB\n40 MB'))!;
const NOISY = measureTrend(parseSamples('10 MB\n30 MB\n12 MB\n11 MB'))!;

test('一度も減らずに 1.5 倍以上でだけ「漏れている」と言う', () => {
	assert.strictEqual(judgeLeak(LEAKING), 'leaking');
	assert.strictEqual(judgeLeak(NOISY), 'stable');
	assert.strictEqual(judgeLeak(measureTrend(parseSamples('10 MB\n11 MB\n13 MB'))!), 'suspicious');
});

test('要約は増分と、減ったかどうかを出す', () => {
	assert.strictEqual(
		describeTrend(LEAKING),
		[
			'4 回の計測: 増え続けています（漏れている可能性が高い）',
			'  10.0 MB → 40.0 MB（山 40.0 MB・1 回あたり 10.0 MB）',
			'  一度も減っていません'
		].join('\n')
	);
	assert.ok(describeTrend(NOISY).includes('途中で減っています'), describeTrend(NOISY));
});

test('投入する文は数字だけを渡し、原因を決めつけない', () => {
	const prompt = buildLeakPrompt(LEAKING, '一覧を開いて閉じる');
	assert.ok(prompt.includes('繰り返した操作: 一覧を開いて閉じる'), prompt);
	assert.ok(prompt.includes('**それらしい原因を作らないでください**'), prompt);
	assert.strictEqual(buildLeakPrompt(NOISY), '');
});

test('バイトは MB / KB で出す', () => {
	assert.strictEqual(formatBytes(1572864), '1.5 MB');
	assert.strictEqual(formatBytes(2048), '2.0 KB');
});

const BEFORE = parseStartupInfo(
	JSON.stringify({
		engineEnterTimestampMicros: 1_700_000_000_000,
		timeToFirstFrameMicros: 800_000,
		timeToFrameworkInitMicros: 300_000
	})
);

test('絶対時刻は落とし、遅い順に並べる', () => {
	assert.deepStrictEqual(BEFORE, [
		{ name: '最初のフレーム', ms: 800 },
		{ name: 'フレームワーク初期化', ms: 300 }
	]);
	assert.deepStrictEqual(parseStartupInfo('壊れています'), []);
});

test('2 割かつ 100ms 以上でだけ「遅くなった」と言う', () => {
	const after = parseStartupInfo(
		JSON.stringify({ timeToFirstFrameMicros: 1_200_000, timeToFrameworkInitMicros: 310_000 })
	);
	const changes = compareStartup(BEFORE, after);
	assert.deepStrictEqual(
		changes.map((change) => [change.name, change.deltaMs]),
		[
			['最初のフレーム', 400],
			['フレームワーク初期化', 10]
		]
	);
	assert.deepStrictEqual(
		regressions(changes).map((change) => change.name),
		['最初のフレーム']
	);
	assert.ok(describeComparison(changes).startsWith('前回より遅くなったもの 1 件'), describeComparison(changes));
});

test('ぶれの範囲なら、何も投入しない', () => {
	const after = parseStartupInfo(JSON.stringify({ timeToFirstFrameMicros: 850_000 }));
	const changes = compareStartup(BEFORE, after);
	assert.deepStrictEqual(regressions(changes), []);
	assert.strictEqual(buildStartupPrompt(changes, '前回'), '');
	assert.ok(describeComparison(changes).startsWith('前回より目立って遅くなったものはありません'));
});

test('投入する文は、測り直す前に直させない', () => {
	const after = parseStartupInfo(JSON.stringify({ timeToFirstFrameMicros: 1_200_000 }));
	const prompt = buildStartupPrompt(compareStartup(BEFORE, after), '前回');
	assert.ok(prompt.includes('**測り直す前に直さないでください。** 1 回の計測はぶれます'), prompt);
});
