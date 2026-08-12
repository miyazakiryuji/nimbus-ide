/**
 * セッションの共有（T-048）の単体テスト。
 *
 * **出す前に何が消えるかを見せる**、**アップロードしない**を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildShareDocument, inspectRedactions } from '../core/shareSession';
import type { TranscriptEntry } from '../core/transcripts';

const entry = (role: 'user' | 'assistant', text: string, files: string[] = []): TranscriptEntry => ({
	role,
	text,
	timestamp: '2026-08-13T10:00:00.000Z',
	files,
	tools: []
});

test('何が伏せられるかを、種類と件数で数える', () => {
	const report = inspectRedactions('/Users/taro/a.ts と sk-abcdefghijklmnopqrstuvwx', '/Users/taro');
	assert.deepStrictEqual(
		{ count: report.count, kinds: report.kinds },
		{ count: 2, kinds: ['ホームのパス（OS のユーザー名）', '鍵らしき文字列'] }
	);
});

test('伏せるものが無ければ 0 件', () => {
	assert.strictEqual(inspectRedactions('ふつうの文', '/Users/taro').count, 0);
});

test('最後のやり取りから遡って載せる', () => {
	const entries = [entry('user', '古い'), entry('assistant', '古い応答'), entry('user', '新しい')];
	const text = buildShareDocument(entries, { home: '', turns: 1 });
	assert.deepStrictEqual([text.includes('新しい'), text.includes('古い')], [true, false]);
});

test('ホームのパスは伏せられる', () => {
	const text = buildShareDocument([entry('user', '/Users/taro/a.ts を直して')], { home: '/Users/taro', turns: 5 });
	assert.deepStrictEqual([text.includes('/Users/taro'), text.includes('~/a.ts')], [false, true]);
});

test('触ったファイルも伏せてから載せる', () => {
	const text = buildShareDocument([entry('assistant', 'やりました', ['/Users/taro/a.ts'])], {
		home: '/Users/taro',
		turns: 5
	});
	assert.ok(text.includes('触ったファイル: ~/a.ts'));
});

test('困っていることは、書かれていなければ空欄で示す', () => {
	assert.ok(buildShareDocument([entry('user', 'x')], { home: '', turns: 1 }).includes('何を見てほしいかを書いてください'));
});

test('差分は、あるときだけ添える', () => {
	const withDiff = buildShareDocument([entry('user', 'x')], { home: '', turns: 1, diff: '- a\n+ b' });
	assert.deepStrictEqual(
		[withDiff.includes('## そのときの差分'), buildShareDocument([entry('user', 'x')], { home: '', turns: 1 }).includes('## そのときの差分')],
		[true, false]
	);
});

test('渡す前に確かめるよう書き添える', () => {
	assert.ok(buildShareDocument([entry('user', 'x')], { home: '', turns: 1 }).includes('渡す前にもう一度目で確かめて'));
});
