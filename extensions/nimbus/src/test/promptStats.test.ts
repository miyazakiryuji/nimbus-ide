/**
 * 指示の出しかた（T-065 / T-067）の単体テスト。
 *
 * **測れないものを測ったことにしない**（成果ではなく言い直しだけ）を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { collectPrompts, isSpecific, renderPromptStats, summarizePrompts } from '../core/promptStats';
import type { TranscriptEntry } from '../core/transcripts';

const user = (text: string, iso: string): TranscriptEntry => ({
	role: 'user',
	text,
	timestamp: iso,
	tools: [],
	files: []
});

test('直後に言い直しが来たら、そう記録する', () => {
	const samples = collectPrompts([
		user('a.ts を直して', '2026-08-13T10:00:00.000Z'),
		user('違う、そっちじゃない', '2026-08-13T10:02:00.000Z'),
		user('次の話', '2026-08-13T11:00:00.000Z')
	]);
	assert.deepStrictEqual(samples.map((s) => s.redone), [true, false]);
});

test('離れていれば言い直しとみなさない（別の話題）', () => {
	const samples = collectPrompts([
		user('a.ts を直して', '2026-08-13T10:00:00.000Z'),
		user('違う話をしよう', '2026-08-13T12:00:00.000Z')
	]);
	assert.deepStrictEqual(samples.map((s) => s.redone), [false]);
});

test('最後の指示は数えない（判定できないので）', () => {
	assert.strictEqual(collectPrompts([user('ひとつだけ', '2026-08-13T10:00:00.000Z')]).length, 0);
});

test('具体的な指示を見分ける', () => {
	assert.deepStrictEqual(
		['a.ts を直して', '`greet` を直して', 'T-105 を見て', 'あれを直して'].map(isSpecific),
		[true, true, true, false]
	);
});

test('形ごとの言い直し率を出す', () => {
	const entries: TranscriptEntry[] = [];
	// 具体的な指示は言い直されない、曖昧な指示は言い直される、という並びを作る
	for (let i = 0; i < 5; i++) {
		entries.push(user(`a${i}.ts を直して`, `2026-08-13T10:0${i}:00.000Z`));
		entries.push(user('ありがとう', `2026-08-13T10:0${i}:30.000Z`));
		entries.push(user('あれ直して', `2026-08-13T11:0${i}:00.000Z`));
		entries.push(user('違う', `2026-08-13T11:0${i}:30.000Z`));
	}
	const stats = summarizePrompts(collectPrompts(entries));
	assert.ok((stats.vagueRedoRate ?? 0) > (stats.specificRedoRate ?? 1));
});

test('数が少ないうちは傾向を出さない', () => {
	const text = renderPromptStats(summarizePrompts(collectPrompts([user('a', '2026-08-13T10:00:00.000Z')])));
	assert.ok(text.includes('傾向を出すには少なすぎます'));
});

test('成果の評価ではないと明記する', () => {
	const entries: TranscriptEntry[] = [];
	for (let i = 0; i < 12; i++) {
		entries.push(user(`指示 ${i} — a.ts を直して`, `2026-08-13T1${i % 10}:00:00.000Z`));
	}
	assert.ok(renderPromptStats(summarizePrompts(collectPrompts(entries))).includes('成果の評価ではありません'));
});
