/**
 * PR レビューの取り込み（T-116）の単体テスト。
 *
 * 指摘の**数と中身が変わらない**ことが値打ちなので、
 * 落とす条件（解決済み・返信）と、要約せずそのまま渡すことを押さえる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	describeComment,
	fixPrompt,
	groupByFile,
	NO_FILE,
	openComments,
	parseReviewComments,
	replyPrompt
} from '../core/prReview';

const raw = [
	{ id: 1, user: { login: 'alice' }, body: 'ここは null になりえます', path: 'src/a.ts', line: 12, diff_hunk: '@@ -1 +1 @@\n+const x = y!;' },
	{ id: 2, user: { login: 'bob' }, body: '直しました', path: 'src/a.ts', line: 12, in_reply_to_id: 1 },
	{ id: 3, user: { login: 'alice' }, body: '解決済みの指摘', path: 'src/b.ts', line: 3, isResolved: true },
	{ id: 4, user: { login: 'carol' }, body: 'PR 全体へのコメント' },
	{ id: 5, user: { login: 'alice' }, body: '消えた行への指摘', path: 'src/a.ts', original_line: 40 }
];

test('gh の JSON を読む（返信・解決済み・行の指定なしも保つ）', () => {
	assert.deepStrictEqual(
		parseReviewComments(raw).map((c) => [c.id, c.author, c.path, c.line, c.resolved, c.inReplyTo]),
		[
			[1, 'alice', 'src/a.ts', 12, false, undefined],
			[2, 'bob', 'src/a.ts', 12, false, 1],
			[3, 'alice', 'src/b.ts', 3, true, undefined],
			[4, 'carol', undefined, undefined, false, undefined],
			[5, 'alice', 'src/a.ts', 40, false, undefined]
		]
	);
});

test('変更後の行が無ければ、元の行で示す（消えた行への指摘）', () => {
	assert.strictEqual(parseReviewComments(raw).find((c) => c.id === 5)?.line, 40);
});

test('形が違うものは落とす（本文なし・配列でない）', () => {
	assert.deepStrictEqual(parseReviewComments([{ id: 1 }, { body: 'x' }, null, 'text']), []);
	assert.deepStrictEqual(parseReviewComments({}), []);
	assert.deepStrictEqual(parseReviewComments(undefined), []);
});

test('まだ対応していない指摘だけに絞る（解決済みと返信を外す）', () => {
	assert.deepStrictEqual(
		openComments(parseReviewComments(raw)).map((c) => c.id),
		[1, 4, 5]
	);
});

test('ファイルごとにまとめ、行の順に並べる。ファイル指定なしは必ず最後', () => {
	// 見出しが日本語なので localeCompare に任せると環境で前後が変わる。並びは明示する
	const groups = groupByFile(openComments(parseReviewComments(raw)));
	assert.deepStrictEqual(
		groups.map((g) => [g.path, g.comments.map((c) => c.line)]),
		[['src/a.ts', [12, 40]], [NO_FILE, [undefined]]]
	);
});

test('ファイルが複数あればパスの順、指定なしはその後ろ', () => {
	const groups = groupByFile([
		{ id: 1, author: 'a', body: 'x', resolved: false },
		{ id: 2, author: 'a', body: 'x', path: 'src/z.ts', line: 1, resolved: false },
		{ id: 3, author: 'a', body: 'x', path: 'src/a.ts', line: 1, resolved: false }
	]);
	assert.deepStrictEqual(groups.map((g) => g.path), ['src/a.ts', 'src/z.ts', NO_FILE]);
});

test('選択肢は「どこへの、どういう指摘か」が読める', () => {
	const [first, , overall] = parseReviewComments(raw);
	assert.deepStrictEqual(
		[describeComment(first), describeComment(overall)],
		['src/a.ts:12 — ここは null になりえます', 'src/b.ts:3 — 解決済みの指摘']
	);
});

test('直す依頼には指摘がそのまま入る（要約しない）', () => {
	const prompt = fixPrompt(openComments(parseReviewComments(raw)));
	assert.ok(prompt.includes('ここは null になりえます'), prompt);
	assert.ok(prompt.includes('```diff'), '指摘がついた差分が入っていない');
	// 「言われたとおりに直す」だけにさせない
	assert.ok(prompt.includes('納得できない指摘は、直さずに**理由を書いて**'), prompt);
	assert.ok(prompt.includes('既に直っていることがあります'), prompt);
	assert.ok(prompt.includes('3 件あります'), prompt);
});

test('返信の下書きは、取り繕わないことを求める', () => {
	const [first] = parseReviewComments(raw);
	const prompt = replyPrompt(first, 'null チェックを足しました');
	assert.ok(prompt.includes('返信の下書き'), prompt);
	assert.ok(prompt.includes('取り繕わないこと'), prompt);
	assert.ok(prompt.includes('null チェックを足しました'), prompt);
});

test('何もしていないときも、そう書いて渡す', () => {
	const [first] = parseReviewComments(raw);
	assert.ok(replyPrompt(first, '').includes('（まだ何もしていません）'));
});
