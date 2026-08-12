/**
 * 練習用サンドボックス（T-046 / T-213）の単体テスト。
 *
 * 芯は「**直すところがある**状態で置くこと」。動くだけのサンプルは練習にならない。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildSandboxFiles, sandboxFolderName } from '../core/sandbox';

const files = buildSandboxFiles();
const byPath = new Map(files.map((f) => [f.path, f.content]));

test('練習に要るものが一式そろう', () => {
	assert.deepStrictEqual(files.map((f) => f.path).sort(), [
		'.gitignore',
		'CLAUDE.md',
		'README.md',
		'src/greet.mjs',
		'test.mjs'
	]);
});

test('テストは最初から落ちる（直すところがある）', () => {
	// 空文字のとき "こんにちは" を期待しているが、実装は "こんにちは、さん" を返す
	assert.ok(byPath.get('test.mjs')?.includes("['', 'こんにちは']"));
	assert.ok(byPath.get('src/greet.mjs')?.includes('こんにちは、${name}さん'));
});

test('README に、最初にやることが順番で書いてある', () => {
	const readme = byPath.get('README.md') ?? '';
	assert.deepStrictEqual(
		['コックピットに', '中身を読んでから', 'node test.mjs'].map((s) => readme.includes(s)),
		[true, true, true]
	);
});

test('CLAUDE.md が置いてある（このフォルダの決まりごと）', () => {
	assert.ok((byPath.get('CLAUDE.md') ?? '').includes('決まりごと'));
});

test('名前は日付つき（何度作っても混ざらない）', () => {
	assert.strictEqual(sandboxFolderName(new Date('2026-08-13T10:00:00Z')), 'nimbus-sandbox-20260813');
});

test('名前は引数で変えられる', () => {
	assert.ok(buildSandboxFiles('練習場').find((f) => f.path === 'README.md')?.content.startsWith('# 練習場'));
});
