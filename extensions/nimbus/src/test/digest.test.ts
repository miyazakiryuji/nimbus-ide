/**
 * ふりかえり（T-207 / T-047）の単体テスト。
 *
 * 数字が嘘になるのが一番まずいので、**期間で切れないものを数えないこと**を重点的に押さえる。
 *
 * 守っている修正（T-274）: T-052
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildDigest, renderDigest, shortenPath } from '../core/digest';
import type { TranscriptEntry } from '../core/transcripts';

const entry = (over: Partial<TranscriptEntry>): TranscriptEntry => ({
	role: 'user',
	text: '',
	tools: [],
	files: [],
	...over
});

const since = Date.parse('2026-08-10T00:00:00.000Z');

test('期間内の指示と応答を数える', () => {
	const digest = buildDigest({
		since,
		entries: [
			entry({ role: 'user', timestamp: '2026-08-11T10:00:00.000Z' }),
			entry({ role: 'assistant', timestamp: '2026-08-11T10:01:00.000Z' }),
			entry({ role: 'user', timestamp: '2026-08-12T09:00:00.000Z' })
		]
	});
	assert.deepStrictEqual(
		{ i: digest.instructionCount, r: digest.replyCount, d: digest.activeDays },
		{ i: 2, r: 1, d: ['2026-08-11', '2026-08-12'] }
	);
});

test('期間より前のものは数えない', () => {
	const digest = buildDigest({ since, entries: [entry({ timestamp: '2026-08-01T00:00:00.000Z' })] });
	assert.strictEqual(digest.instructionCount, 0);
});

test('時刻を持たない記録は数えない（期間で切れないので）', () => {
	const digest = buildDigest({ since, entries: [entry({}), entry({ timestamp: 'こわれた' })] });
	assert.deepStrictEqual({ i: digest.instructionCount, d: digest.activeDays }, { i: 0, d: [] });
});

test('ツールとファイルを多い順に、同数なら名前順で返す', () => {
	const digest = buildDigest({
		since,
		entries: [
			entry({ role: 'assistant', timestamp: '2026-08-11T10:00:00.000Z', tools: ['Edit', 'Read'], files: ['/a.ts'] }),
			entry({ role: 'assistant', timestamp: '2026-08-11T11:00:00.000Z', tools: ['Edit'], files: ['/a.ts', '/b.ts'] })
		]
	});
	assert.deepStrictEqual(
		{ tools: digest.tools, files: digest.files },
		{
			tools: [{ name: 'Edit', count: 2 }, { name: 'Read', count: 1 }],
			files: [{ path: '/a.ts', count: 2 }, { path: '/b.ts', count: 1 }]
		}
	);
});

test('パスはプロジェクト相対に、外のものは末尾 3 つに縮める', () => {
	assert.deepStrictEqual(
		[shortenPath('/repo/src/a.ts', '/repo'), shortenPath('/x/y/z/w/v.ts', '/repo'), shortenPath('/a/b.ts', undefined)],
		['src/a.ts', '…/z/w/v.ts', '/a/b.ts']
	);
});

test('記録が無い期間は、その旨だけを書く（数字をでっち上げない）', () => {
	const text = renderDigest(buildDigest({ since, entries: [] }), undefined, 7);
	assert.deepStrictEqual(
		{ head: text.startsWith('# ふりかえり（直近 7 日）'), body: text.includes('この期間の記録がありません') },
		{ head: true, body: true }
	);
});

test('Markdown に件数・日数・ツール・ファイルが並ぶ', () => {
	const digest = buildDigest({
		since,
		entries: [entry({ role: 'assistant', timestamp: '2026-08-11T10:00:00.000Z', tools: ['Edit'], files: ['/repo/a.ts'] })]
	});
	const text = renderDigest(digest, '/repo', 7);
	assert.deepStrictEqual(
		['よく使ったツール', 'Edit — 1 回', 'よく触ったファイル', '`a.ts` — 1 回'].map((s) => text.includes(s)),
		[true, true, true, true]
	);
});

test('連続して動いた日数の最大を数える（T-096）', () => {
	const digest = buildDigest({
		since,
		entries: [
			entry({ timestamp: '2026-08-11T10:00:00.000Z' }),
			entry({ timestamp: '2026-08-12T10:00:00.000Z' }),
			entry({ timestamp: '2026-08-14T10:00:00.000Z' })
		]
	});
	assert.deepStrictEqual({ days: digest.activeDays.length, streak: digest.longestStreak }, { days: 3, streak: 2 });
});
