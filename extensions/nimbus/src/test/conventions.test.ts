/**
 * プロジェクト固有の書き方の数え方。
 *
 * **はっきり多いものだけを「流儀」と呼ぶ**のが要件。
 * 半々のものに従わせても、迷わせるだけで精度は上がらない。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildConventionsPrompt, detectConventions, renderConventions } from '../core/conventions';

const TAB_SINGLE_SEMI = ["import { a } from 'a';", 'function f() {', '\tconst x = 1;', '\treturn x;', '}'].join('\n');
const SPACE_DOUBLE_NOSEMI = ['import { a } from "a"', 'function f() {', '  const x = 1', '  return x', '}'].join('\n');

test('多数派の書き方を拾う（タブ・シングル・セミコロンあり）', () => {
	const conventions = detectConventions([
		{ path: 'src/aView.ts', text: TAB_SINGLE_SEMI },
		{ path: 'src/bView.ts', text: TAB_SINGLE_SEMI },
		{ path: 'src/cView.ts', text: TAB_SINGLE_SEMI }
	]);
	assert.deepStrictEqual(
		[conventions.indent, conventions.quotes, conventions.semicolons, conventions.fileNaming, conventions.sampled],
		['tab', 'single', true, 'camelCase', 3]
	);
});

test('半々のものは「流儀」と呼ばない', () => {
	const conventions = detectConventions([
		{ path: 'a.ts', text: TAB_SINGLE_SEMI },
		{ path: 'b.ts', text: SPACE_DOUBLE_NOSEMI }
	]);
	assert.deepStrictEqual([conventions.indent, conventions.quotes], [undefined, undefined]);
});

test('ファイル名の付け方と、テストの置き場所を見分ける', () => {
	const separate = detectConventions([
		{ path: 'test/foo-bar.test.ts', text: TAB_SINGLE_SEMI },
		{ path: 'test/baz-qux.test.ts', text: TAB_SINGLE_SEMI }
	]);
	assert.deepStrictEqual([separate.fileNaming, separate.testLocation], ['kebab-case', 'separate']);

	const beside = detectConventions([
		{ path: 'src/foo_bar_test.dart', text: SPACE_DOUBLE_NOSEMI },
		{ path: 'src/baz_qux_test.dart', text: SPACE_DOUBLE_NOSEMI }
	]);
	assert.strictEqual(beside.testLocation, 'beside');
});

test('分からなかった項目は書かない', () => {
	const rendered = renderConventions({ indent: 'tab', sampled: 5 });
	assert.strictEqual(rendered, ['5 ファイルから数えた、このリポジトリの書き方:', '- インデント: tab'].join('\n'));
	assert.ok(!rendered.includes('引用符'), rendered);
});

test('何も分からなければ、そう言う。指示も組み立てない', () => {
	assert.strictEqual(
		renderConventions({ sampled: 3 }),
		'3 ファイルを見ましたが、はっきりした流儀は見つかりませんでした。'
	);
	assert.strictEqual(buildConventionsPrompt({ sampled: 3 }), '');
});

test('渡す文は「数えた結果」であることを先に言う', () => {
	const prompt = buildConventionsPrompt({ indent: '2 spaces', sampled: 10 });
	assert.ok(prompt.startsWith('このリポジトリの書き方です。**推測ではなく既存のファイルを数えた結果**'), prompt);
	assert.ok(prompt.includes('- インデント: 2 spaces'), prompt);
});
