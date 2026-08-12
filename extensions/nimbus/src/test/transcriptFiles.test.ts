/**
 * 記録ファイルの読み込み（共通化した部分）の単体テスト。
 *
 * 記録は Nimbus のものではないので、**1 本の異常で全部が止まらないこと**を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { readRecentTranscripts, type TranscriptFileSystem } from '../core/transcriptFiles';

const line = (role: 'user' | 'assistant', text: string): string =>
	JSON.stringify({ type: role, timestamp: '2026-08-12T10:00:00.000Z', message: { content: text } });

function fakeFs(files: Record<string, { mtime: number; size?: number; content?: string; throws?: boolean }>): TranscriptFileSystem {
	return {
		list: (dir) => Object.keys(files).map((name) => name).filter(() => dir.length > 0),
		mtime: (path) => files[path.split('/').pop() as string].mtime,
		size: (path) => files[path.split('/').pop() as string].size ?? 100,
		read: (path) => {
			const entry = files[path.split('/').pop() as string];
			if (entry.throws) {
				throw new Error('読めない');
			}
			return entry.content ?? '';
		}
	};
}

test('新しい順に、上限の本数だけ読む', () => {
	const fs = fakeFs({
		'old.jsonl': { mtime: 1, content: line('user', '古い') },
		'new.jsonl': { mtime: 9, content: line('user', '新しい') }
	});
	assert.deepStrictEqual(
		readRecentTranscripts('/repo', '/home', { limit: 1, maxBytes: 1000, fs }).map((e) => e.text),
		['新しい']
	);
});

test('大きすぎる記録は飛ばす', () => {
	const fs = fakeFs({ 'big.jsonl': { mtime: 1, size: 99999, content: line('user', '大きい') } });
	assert.deepStrictEqual(readRecentTranscripts('/repo', '/home', { limit: 5, maxBytes: 10, fs }), []);
});

test('読めない 1 本があっても、他は読む', () => {
	const fs = fakeFs({
		'broken.jsonl': { mtime: 9, throws: true },
		'ok.jsonl': { mtime: 1, content: line('assistant', '読めた') }
	});
	assert.deepStrictEqual(
		readRecentTranscripts('/repo', '/home', { limit: 5, maxBytes: 1000, fs }).map((e) => e.text),
		['読めた']
	);
});

test('置き場が無ければ空を返す（記録を取っていない環境）', () => {
	const fs: TranscriptFileSystem = {
		list: () => {
			throw new Error('ない');
		},
		mtime: () => 0,
		size: () => 0,
		read: () => ''
	};
	assert.deepStrictEqual(readRecentTranscripts('/repo', '/home', { limit: 5, maxBytes: 1000, fs }), []);
});

test('.jsonl 以外は見ない', () => {
	const fs = fakeFs({ 'note.txt': { mtime: 9, content: line('user', '無視') } });
	assert.deepStrictEqual(readRecentTranscripts('/repo', '/home', { limit: 5, maxBytes: 1000, fs }), []);
});
