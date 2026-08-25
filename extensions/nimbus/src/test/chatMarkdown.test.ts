/**
 * 応答の Markdown を塊に分ける（T-271）の単体テスト。
 *
 * ここが間違えると、応答が**読めない形**で画面に出る。とくに気にするのは 2 つ ──
 * コードブロックが本文に溶けないこと、`snake_case` の識別子が強調に化けないこと。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { codeBlocksIn, parseInline, parseMarkdown } from '../core/chatMarkdown';

test('見出し・段落・コードブロックを塊に分ける', () => {
	const blocks = parseMarkdown(['# やること', '', '直します。', '', '```ts', 'const x = 1;', '```'].join('\n'));

	assert.deepStrictEqual(blocks, [
		{ kind: 'heading', level: 1, spans: [{ kind: 'text', text: 'やること' }] },
		{ kind: 'paragraph', spans: [{ kind: 'text', text: '直します。' }] },
		{ kind: 'code', language: 'ts', text: 'const x = 1;' }
	]);
});

test('閉じていないコードブロックも塊にする（書いている最中が見えないと困る）', () => {
	const blocks = parseMarkdown(['```sh', 'npm test'].join('\n'));

	assert.deepStrictEqual(blocks, [{ kind: 'code', language: 'sh', text: 'npm test' }]);
});

test('コードブロックの中は記法として解釈しない', () => {
	const blocks = parseMarkdown(['```', '**これは強調ではない**', '```'].join('\n'));

	assert.deepStrictEqual(blocks, [{ kind: 'code', language: '', text: '**これは強調ではない**' }]);
});

test('箇条書きと番号付きを、まとまりとして拾う', () => {
	const blocks = parseMarkdown(['- 一つ', '- 二つ', '', '1. 最初', '2. 次'].join('\n'));

	assert.deepStrictEqual(blocks, [
		{ kind: 'list', ordered: false, items: [[{ kind: 'text', text: '一つ' }], [{ kind: 'text', text: '二つ' }]] },
		{ kind: 'list', ordered: true, items: [[{ kind: 'text', text: '最初' }], [{ kind: 'text', text: '次' }]] }
	]);
});

test('引用と区切り線', () => {
	const blocks = parseMarkdown(['> 引用です', '', '---'].join('\n'));

	assert.deepStrictEqual(blocks, [
		{ kind: 'quote', spans: [{ kind: 'text', text: '引用です' }] },
		{ kind: 'rule' }
	]);
});

test('行の中の記法を断片に分ける', () => {
	assert.deepStrictEqual(parseInline('`code` と **強め** と *弱め*'), [
		{ kind: 'code', text: 'code' },
		{ kind: 'text', text: ' と ' },
		{ kind: 'strong', text: '強め' },
		{ kind: 'text', text: ' と ' },
		{ kind: 'em', text: '弱め' }
	]);
});

test('snake_case を強調に化けさせない', () => {
	assert.deepStrictEqual(parseInline('file_path と some_long_name'), [
		{ kind: 'text', text: 'file_path と some_long_name' }
	]);
});

test('リンクは通す枠組みだけ。通らないものは文字として残す', () => {
	assert.deepStrictEqual(parseInline('[docs](https://example.com) と [危険](javascript:alert)'), [
		{ kind: 'link', text: 'docs', href: 'https://example.com' },
		{ kind: 'text', text: ' と ' },
		{ kind: 'text', text: '[危険](javascript:alert)' }
	]);
});

test('コードブロックだけを取り出せる', () => {
	const blocks = parseMarkdown(['文', '', '```py', 'print(1)', '```', '', '```', 'plain', '```'].join('\n'));

	assert.deepStrictEqual(codeBlocksIn(blocks), [
		{ kind: 'code', language: 'py', text: 'print(1)' },
		{ kind: 'code', language: '', text: 'plain' }
	]);
});

test('表を塊として読む（T-304）', () => {
	// Claude はよく表で答えるのに種類が無く、`| 項目 | 値 |` が生のまま段落に並んでいた
	assert.deepStrictEqual(
		parseMarkdown(['| 項目 | 値 |', '| --- | :---: |', '| **枠** | 62% |', '| 週 | 41% |'].join('\n')),
		[
			{
				kind: 'table',
				header: [[{ kind: 'text', text: '項目' }], [{ kind: 'text', text: '値' }]],
				rows: [
					[[{ kind: 'strong', text: '枠' }], [{ kind: 'text', text: '62%' }]],
					[[{ kind: 'text', text: '週' }], [{ kind: 'text', text: '41%' }]]
				]
			}
		]
	);
});

test('区切り行の無い縦棒は表にしない（T-304）', () => {
	// `a | b` のような普通の文まで表に化けると、本文が壊れる
	assert.deepStrictEqual(parseMarkdown('速い | 安い | うまい'), [
		{ kind: 'paragraph', spans: [{ kind: 'text', text: '速い | 安い | うまい' }] }
	]);
});
