/**
 * レビューコメントの取り込み（T-116）の単体テスト。
 *
 * **感想を依頼として扱わない**、**依頼が混ざっていれば依頼**、を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { classifyAll, classifyComment, renderComments, toPrompt, toWorkList } from '../core/reviewComments';

test('依頼・質問・感想を仕分ける', () => {
	assert.deepStrictEqual(
		['ここは直してください', 'なぜこの順番なのでしょうか', 'いいですね！', '参考までに'].map(classifyComment),
		['change-request', 'question', 'praise', 'note']
	);
});

test('褒め言葉が混ざっていても、依頼なら依頼', () => {
	assert.strictEqual(classifyComment('いいですね。ただ、ここは直してください'), 'change-request');
});

test('手を動かすものだけを、場所つきを先に並べる', () => {
	const comments = classifyAll([
		{ author: 'a', body: 'いいですね' },
		{ author: 'b', body: 'なぜこうしたのですか' },
		{ author: 'c', body: '直してください', path: 'src/a.ts', line: 10 }
	]);
	assert.deepStrictEqual(toWorkList(comments).map((c) => c.author), ['c', 'b']);
});

test('渡す文には場所と、意図が読めないときの指示を入れる', () => {
	const prompt = toPrompt({ author: 'a', body: 'null のときが漏れています', path: 'src/a.ts', line: 42, kind: 'change-request' });
	assert.deepStrictEqual(
		['src/a.ts:42 を直してください', '> null のときが漏れています', 'そのまま直さずに聞いてください'].map((s) => prompt.includes(s)),
		[true, true, true]
	);
});

test('場所が無くても渡せる（その旨を書く）', () => {
	assert.ok(toPrompt({ author: 'a', body: 'x', kind: 'change-request' }).includes('（場所の指定なし）'));
});

test('手を動かす件数を先に出す', () => {
	const comments = classifyAll([
		{ author: 'a', body: '直してください' },
		{ author: 'b', body: 'いいですね' }
	]);
	assert.ok(renderComments(comments).includes('手を動かすもの: 1 件'));
});

test('コメントが無ければ、その旨だけを書く', () => {
	assert.ok(renderComments([]).includes('見つかりませんでした'));
});
