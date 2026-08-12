/**
 * 使われていない export の検出（T-112）の単体テスト。
 *
 * 誤って「死んでいる」と言うほうが害が大きいので、**挙げない方向に倒れること**を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { collectExports, collectImports, findDeadExports, renderDeadExports } from '../core/deadCode';

test('宣言と export 文の両方から、公開している名前を拾う', () => {
	const content = [
		'export function used() {}',
		'export const value = 1;',
		'export interface Shape {}',
		'const hidden = 2;',
		'export { hidden as exposed };'
	].join('\n');
	assert.deepStrictEqual(
		collectExports(content).map((e) => `${e.kind}:${e.name}`),
		['function:used', 'const:value', 'interface:Shape', 'export:hidden', 'export:exposed']
	);
});

test('import の名前を拾う（型・別名・名前空間も）', () => {
	const content = [
		"import { a, b as c } from './m';",
		"import type { D } from './types';",
		"import * as ns from './ns';",
		"import def from './def';"
	].join('\n');
	assert.deepStrictEqual(collectImports(content).sort(), ['D', 'a', 'b', 'c', 'def', 'ns'].sort());
});

test('どこからも import されていない export を挙げる', () => {
	const dead = findDeadExports([
		{ path: 'src/a.ts', content: 'export function used() {}\nexport function unused() {}' },
		{ path: 'src/b.ts', content: "import { used } from './a';" }
	]);
	assert.deepStrictEqual(dead.map((d) => `${d.name}:${d.reason}`), ['unused:dead']);
});

test('入口（extension / index / テスト）の export は挙げない', () => {
	const dead = findDeadExports([
		{ path: 'src/extension.ts', content: 'export function activate() {}' },
		{ path: 'src/a.test.ts', content: 'export const fixture = 1;' }
	]);
	assert.deepStrictEqual(dead, []);
});

test('同じ名前がどこかで使われていれば挙げない（挙げない方向に倒す）', () => {
	const dead = findDeadExports([
		{ path: 'src/a.ts', content: 'export const helper = 1;' },
		{ path: 'src/b.ts', content: "import { helper } from './somewhere-else';" }
	]);
	assert.deepStrictEqual(dead, []);
});

test('自分のファイルの中で使っているものは local-only（死骸と分ける）', () => {
	const dead = findDeadExports([
		{ path: 'src/a.ts', content: 'export interface Shape {}\nfunction use(s: Shape) { return s; }\nuse({});' }
	]);
	assert.deepStrictEqual(dead.map((d) => `${d.name}:${d.reason}`), ['Shape:local-only']);
});

test('何も無ければ何も書かない（節ごと出さない）', () => {
	assert.strictEqual(renderDeadExports([]), '');
});

test('出力には「消すかは人が決める」と書く', () => {
	const text = renderDeadExports([{ file: 'src/a.ts', name: 'unused', kind: 'function', reason: 'dead' }]);
	assert.deepStrictEqual(
		['使われていない export', '消すかどうかは人が決めてください', '`unused`'].map((s) => text.includes(s)),
		[true, true, true]
	);
});

test('インライン type 修飾子つきの import も読む（この書き方が主流）', () => {
	assert.deepStrictEqual(collectImports("import { discoverSkills, type Skill } from './core/skills';").sort(), [
		'Skill',
		'discoverSkills'
	]);
});
