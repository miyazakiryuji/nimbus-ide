/**
 * スニペット化。
 *
 * 壊れやすいのはエスケープ。`$` や `}` をそのまま置くと、
 * 意図しないプレースホルダとして解釈されて、貼った瞬間に形が崩れる。
 *
 * 守っている修正（T-274）: T-177
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildSnippet, dedent, escapeSnippetBody, mergeSnippets, snippetFileName } from '../core/snippets';

test('スニペット構文で意味を持つ文字を逃がす', () => {
	assert.deepStrictEqual(escapeSnippetBody('const a = `${x}`;\nif (a) { b(); }'), [
		'const a = `\\${x\\}`;',
		'if (a) { b(); \\}'
	]);
});

test('共通のインデントを落とす', () => {
	assert.strictEqual(dedent('    a\n      b\n\n    c'), 'a\n  b\n\nc');
	assert.strictEqual(dedent('a\n  b'), 'a\n  b');
});

test('1 件を組み立てる（末尾の空白は落とす）', () => {
	assert.deepStrictEqual(buildSnippet('名前', ' pre ', '  const a = 1;\n  \n'), {
		名前: { prefix: 'pre', body: ['const a = 1;'], description: undefined }
	});
});

test('同じ名前は上書きし、上書きしたことを伝える', () => {
	const existing = JSON.stringify({ 名前: { prefix: 'old', body: ['x'] }, 別: { prefix: 'z', body: ['y'] } });
	const merged = mergeSnippets(existing, buildSnippet('名前', 'new', 'a'));
	assert.strictEqual(merged.replaced, true);
	const parsed = JSON.parse(merged.text) as Record<string, { prefix: string }>;
	assert.deepStrictEqual([parsed['名前'].prefix, parsed['別'].prefix], ['new', 'z']);
});

test('壊れた JSON や空のファイルからでも作り直せる', () => {
	assert.strictEqual(mergeSnippets('', buildSnippet('a', 'p', 'x')).replaced, false);
	assert.strictEqual(mergeSnippets('{ 壊れ', buildSnippet('a', 'p', 'x')).replaced, false);
});

test('ファイル名は言語 ID から作る（記号は落とす）', () => {
	assert.deepStrictEqual(
		['typescript', 'objective-c', '../evil'].map(snippetFileName),
		['typescript.code-snippets', 'objective-c.code-snippets', 'evil.code-snippets']
	);
});
