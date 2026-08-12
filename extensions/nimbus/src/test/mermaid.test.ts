/**
 * Mermaid の確認（T-061）の単体テスト。
 *
 * **必ず落ちるものだけを出す**（構文解析はしない）を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { checkMermaid, extractMermaidBlocks, renderMermaidReport } from '../core/mermaid';

const markdown = ['文章', '```mermaid', 'graph TD', '  A --> B', '```', '', '```ts', 'const x = 1;', '```'].join('\n');

test('```mermaid の塊だけを取り出す', () => {
	const blocks = extractMermaidBlocks(markdown);
	assert.deepStrictEqual(blocks.map((b) => `${b.line}:${b.content.split('\n')[0]}`), ['2:graph TD']);
});

test('正しい図は指摘しない', () => {
	assert.deepStrictEqual(checkMermaid(extractMermaidBlocks(markdown)[0]), []);
});

test('先頭が図の種類でなければ指摘する', () => {
	const problems = checkMermaid({ line: 0, content: 'A --> B' });
	assert.ok(problems[0].message.includes('先頭が図の種類になっていません'));
});

test('ラベルの中の括弧を指摘する（いちばんよく踏む）', () => {
	const problems = checkMermaid({ line: 0, content: 'graph TD\n  A[承認 (差分つき)] --> B' });
	assert.deepStrictEqual(
		{ message: problems[0].message.includes('括弧'), fix: problems[0].fix.includes('"') },
		{ message: true, fix: true }
	);
});

test('引用符で囲んであれば指摘しない', () => {
	assert.deepStrictEqual(checkMermaid({ line: 0, content: 'graph TD\n  A["承認 (差分つき)"] --> B' }), []);
});

test('全角の記号を指摘する', () => {
	assert.ok(checkMermaid({ line: 0, content: 'graph TD\n  A → B' }).some((p) => p.message.includes('全角')));
});

test('大文字の End を指摘する', () => {
	assert.ok(checkMermaid({ line: 0, content: 'graph TD\n  subgraph x\n  End' }).some((p) => p.message.includes('End')));
});

test('中身が空なら、書き始めかたを出す', () => {
	assert.ok(checkMermaid({ line: 0, content: '  ' })[0].fix.includes('graph TD'));
});

test('図が無ければ、その旨だけを書く', () => {
	assert.ok(renderMermaidReport([], []).includes('見つかりませんでした'));
});

test('問題が無ければ、プレビューの開きかたを案内する', () => {
	const text = renderMermaidReport(extractMermaidBlocks(markdown), []);
	assert.ok(text.includes('Markdown プレビュー'));
});
