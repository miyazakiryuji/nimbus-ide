/**
 * 古くなっているコメント（T-210）の単体テスト。
 *
 * 意味には踏み込まない。**機械的に突き合わせられるものだけ**を挙げることを押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { findDeadReferences, findParamMismatches, renderCommentFindings } from '../core/commentCheck';

test('引数から消えた @param を挙げる', () => {
	const content = ['/**', ' * @param a 説明', ' * @param removed 昔あった', ' */', 'function f(a: string) {}'].join('\n');
	assert.deepStrictEqual(
		findParamMismatches('a.ts', content).map((f) => f.message),
		['`@param removed` はもう引数にありません']
	);
});

test('書かれていない引数は言わない（普通にあることなので）', () => {
	const content = ['/**', ' * @param a 説明', ' */', 'function f(a: string, b: number) {}'].join('\n');
	assert.deepStrictEqual(findParamMismatches('a.ts', content), []);
});

test('修飾子つきの引数も読める', () => {
	const content = ['/**', ' * @param home 説明', ' */', 'constructor(private readonly home: string = x) {}'].join('\n');
	assert.deepStrictEqual(findParamMismatches('a.ts', content), []);
});

test('コメントの中の、存在しないファイル参照を挙げる', () => {
	const content = ['// 詳しくは core/gone.ts を参照', 'const x = 1;'].join('\n');
	assert.deepStrictEqual(
		findDeadReferences('a.ts', content, ['src/core/alive.ts']).map((f) => f.message),
		['`core/gone.ts` は見つかりません（名前が変わった／消えた可能性）']
	);
});

test('存在するファイルは末尾一致で認める（相対パスで書かれるため）', () => {
	assert.deepStrictEqual(findDeadReferences('a.ts', '// core/alive.ts を見る', ['src/core/alive.ts']), []);
});

test('コメント以外の行は見ない', () => {
	assert.deepStrictEqual(findDeadReferences('a.ts', "import x from './gone.ts';", ['src/a.ts']), []);
});

test('URL は参照として扱わない', () => {
	assert.deepStrictEqual(findDeadReferences('a.ts', '// https://example.com/a.ts', ['src/a.ts']), []);
});

test('何も無ければ何も書かない（節ごと出さない）', () => {
	assert.strictEqual(renderCommentFindings([]), '');
});

test('コメント以外の行にある @param は見ない（正規表現や文字列の中）', () => {
	const content = ["const PARAM = /@param\\s+(\\w+)/g;", 'function f(a: string) {}'].join('\n');
	assert.deepStrictEqual(findParamMismatches('a.ts', content), []);
});

test('.md への参照は突き合わせない（コード以外の場所にあるため）', () => {
	assert.deepStrictEqual(findDeadReferences('a.ts', '// CLAUDE.md を参照', ['src/a.ts']), []);
});
