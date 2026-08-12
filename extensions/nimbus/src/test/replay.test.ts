/**
 * たどり直す（T-206）の単体テスト。
 *
 * **間隔が出ること**（詰まった場所は中身より間隔に出る）を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildReplay, formatGap, renderReplay, stalls, stepLabel } from '../core/replay';
import type { TranscriptEntry } from '../core/transcripts';

const entry = (role: 'user' | 'assistant', text: string, iso: string, files: string[] = []): TranscriptEntry => ({
	role,
	text,
	timestamp: iso,
	files,
	tools: files.length > 0 ? ['Edit'] : []
});

const steps = buildReplay([
	entry('user', '直して', '2026-08-13T10:00:00.000Z'),
	entry('assistant', 'やります', '2026-08-13T10:00:05.000Z', ['/a.ts']),
	entry('user', 'まだ？', '2026-08-13T10:10:00.000Z')
]);

test('時刻順に並べ、前からの間隔を持つ', () => {
	assert.deepStrictEqual(steps.map((s) => s.gap), [undefined, 5000, 595000]);
});

test('時刻の無い記録は並べない（間隔が出せないので）', () => {
	const noTime: TranscriptEntry = { role: 'user', text: 'x', tools: [], files: [] };
	assert.deepStrictEqual(buildReplay([noTime]), []);
});

test('3 分以上空いたところを「止まっていた」とする', () => {
	assert.deepStrictEqual(stalls(steps).map((s) => s.index), [2]);
});

test('間隔を読める形にする', () => {
	assert.deepStrictEqual([formatGap(undefined), formatGap(500), formatGap(45_000), formatGap(600_000)], [
		'',
		'即',
		'45 秒後',
		'10 分後'
	]);
});

test('見出しは 1 行目から作る（本文が無ければツール名）', () => {
	assert.deepStrictEqual(
		[stepLabel(steps[0]), stepLabel({ ...steps[1], text: '' })],
		['指示: 直して', 'Claude: Edit']
	);
});

test('止まっていたところを先に出す', () => {
	const text = renderReplay(steps);
	assert.ok(text.indexOf('## 止まっていたところ') < text.indexOf('## 順に'));
});

test('記録が無ければ、その旨だけを書く', () => {
	assert.ok(renderReplay([]).includes('時刻つきの記録がありませんでした'));
});

test('長い本文は切り詰める（読めなくなるので）', () => {
	const long = buildReplay([entry('assistant', 'あ'.repeat(2000), '2026-08-13T10:00:00.000Z')]);
	assert.ok(renderReplay(long).includes('…'));
});
