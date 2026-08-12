/**
 * やり取りの切り出し（T-214）の単体テスト。
 *
 * **切り出す時点で消す**（あとで消すつもりのものは消し忘れる）を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { pickHighlights, redact, renderHighlights } from '../core/highlights';
import type { TranscriptEntry } from '../core/transcripts';

const entry = (role: 'user' | 'assistant', text: string): TranscriptEntry => ({
	role,
	text,
	timestamp: '2026-08-13T10:00:00.000Z',
	tools: [],
	files: []
});

const goodAnswer = ['なぜこうするかというと、' + 'あ'.repeat(200), '```ts', 'const x = 1;', '```'].join('\n');

test('ホームのパスを ~ に置き換える', () => {
	assert.strictEqual(redact('/Users/taro/work/a.ts を直す', '/Users/taro'), '~/work/a.ts を直す');
});

test('鍵らしき文字列を伏せる', () => {
	assert.ok(redact('key: sk-abcdefghijklmnopqrstuvwx', '').includes('（鍵は伏せました）'));
});

test('コードか理由がある応答だけを選ぶ', () => {
	const picked = pickHighlights([entry('user', '直して'), entry('assistant', goodAnswer)], '');
	assert.deepStrictEqual(picked.map((h) => h.reason), ['コードと、その理由の両方がある']);
});

test('短い応答は選ばない', () => {
	assert.deepStrictEqual(pickHighlights([entry('user', '直して'), entry('assistant', 'はい')], ''), []);
});

test('直後に言い直しがあった組は選ばない（伝わらなかったやり取り）', () => {
	const picked = pickHighlights(
		[entry('user', '直して'), entry('assistant', goodAnswer), entry('user', '違う、そうじゃない')],
		''
	);
	assert.deepStrictEqual(picked, []);
});

test('長い応答を先に出す（説明が尽くされている）', () => {
	const short = ['理由はこうです。' + 'あ'.repeat(200)].join('\n');
	const picked = pickHighlights(
		[entry('user', 'A'), entry('assistant', short), entry('user', 'B'), entry('assistant', goodAnswer)],
		''
	);
	assert.strictEqual(picked[0].answer.length > picked[1].answer.length, true);
});

test('切り出した中身にホームのパスが残らない', () => {
	const picked = pickHighlights([entry('user', '/Users/taro/a.ts'), entry('assistant', goodAnswer)], '/Users/taro');
	assert.ok(!renderHighlights(picked).includes('/Users/taro'));
});

test('見つからなければ、何を探しているかを書く', () => {
	assert.ok(renderHighlights([]).includes('コードか理由が書かれている応答'));
});

test('配る前に確かめるよう書き添える', () => {
	const picked = pickHighlights([entry('user', '直して'), entry('assistant', goodAnswer)], '');
	assert.ok(renderHighlights(picked).includes('配る前にもう一度目で確かめて'));
});
