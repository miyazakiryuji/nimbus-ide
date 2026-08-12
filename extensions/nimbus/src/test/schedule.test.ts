/**
 * 予約実行（T-051）の単体テスト。
 *
 * **過去に実行しない**ことと、**承認で止まることを黙らない**ことを押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { afterDuration, dueRuns, formatWhen, nextTimeAt, parseWhen, renderSchedule, warningFor } from '../core/schedule';

const now = new Date('2026-08-13T23:00:00').getTime();

test('時刻の指定は、次に来るその時刻になる', () => {
	const at = nextTimeAt('07:30', now);
	assert.strictEqual(new Date(at as number).getHours(), 7);
	assert.ok((at as number) > now);
});

test('すでに過ぎた時刻は翌日にする（過去に実行しない）', () => {
	const at = nextTimeAt('22:00', now) as number;
	assert.ok(at - now > 20 * 3600_000);
});

test('「30分後」「2時間後」も読める', () => {
	assert.deepStrictEqual(
		[afterDuration('30分後', now) === now + 1_800_000, afterDuration('2 時間後', now) === now + 7_200_000],
		[true, true]
	);
});

test('読めない指定は undefined', () => {
	assert.deepStrictEqual([parseWhen('あとで', now), parseWhen('99:99', now)], [undefined, undefined]);
});

test('時刻が来たものだけを返す', () => {
	const runs = [
		{ id: 'a', at: now - 1, prompt: 'x', autoApprove: false, state: 'waiting' as const },
		{ id: 'b', at: now + 1000, prompt: 'y', autoApprove: false, state: 'waiting' as const },
		{ id: 'c', at: now - 1, prompt: 'z', autoApprove: false, state: 'done' as const }
	];
	assert.deepStrictEqual(dueRuns(runs, now).map((r) => r.id), ['a']);
});

test('承認で止まることを黙らない', () => {
	assert.ok(warningFor({ autoApprove: false })?.includes('承認が必要な操作で止まります'));
});

test('自動承認にするなら、危なさを言う', () => {
	assert.ok(warningFor({ autoApprove: true })?.includes('取り返しのつかない操作'));
});

test('待ち時間を読める形にする', () => {
	assert.deepStrictEqual([formatWhen(now + 1_800_000, now), formatWhen(now + 8_100_000, now)], ['30 分後', '2 時間 15 分後']);
});

test('仕込みが無ければ、その旨だけを書く', () => {
	assert.ok(renderSchedule([], now).includes('ありません'));
});

test('一覧には、朝どこで結果を見るかまで書く', () => {
	const text = renderSchedule([{ id: 'a', at: now + 3600_000, prompt: '調べる', autoApprove: false, state: 'waiting' }], now);
	assert.ok(text.includes('ふりかえり（昨夜から）'));
});
