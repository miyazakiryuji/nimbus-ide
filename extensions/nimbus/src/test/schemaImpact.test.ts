/**
 * 型の変更が壊す場所の洗い出し。
 *
 * **型だけを拾う**（関数や定数まで拾うと、変更のたびに全部が並ぶ）。
 * 出す文は「直して」ではなく「壊れていないか確かめて」。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildImpactPrompt, changedTypes, describeImpacts, rankImpacts } from '../core/schemaImpact';

const DIFF = [
	'--- a/src/types.ts',
	'+++ b/src/types.ts',
	'-export interface User { id: string }',
	'+export interface User { id: string; name: string }',
	'+export type Role = "admin" | "user"',
	'+export enum Status { A }',
	'+export function helper() {}',
	'+export const VALUE = 1;'
].join('\n');

test('差分から型の名前だけを拾う', () => {
	assert.deepStrictEqual(changedTypes(DIFF), ['User', 'Role', 'Status']);
});

const IMPACTS = [
	{ type: 'User', files: ['src/a.ts', 'src/b.ts', 'src/c.ts'] },
	{ type: 'Role', files: ['src/a.ts'] },
	{ type: 'Status', files: [] }
];

test('影響の大きい順に並べ、参照が無いものは落とす', () => {
	assert.deepStrictEqual(
		rankImpacts(IMPACTS).map((impact) => impact.type),
		['User', 'Role']
	);
});

test('一覧は型ごとのファイル数と、のべではない総数を出す', () => {
	assert.strictEqual(
		describeImpacts(IMPACTS),
		['変わった型 2 件を、3 ファイルが参照しています', '  User: 3 ファイル', '  Role: 1 ファイル'].join('\n')
	);
	assert.strictEqual(describeImpacts([]), '変わった型を参照している場所は見つかりませんでした。');
});

test('投入する文は「壊れていないかを確かめて」から入る', () => {
	const prompt = buildImpactPrompt(IMPACTS);
	assert.ok(prompt.startsWith('型の定義を変えました。**参照している場所が壊れていないか**を確かめてください。'), prompt);
	assert.ok(prompt.includes('### User'), prompt);
	assert.ok(prompt.includes('**参照しているだけで影響が無い場所の方が多い**'), prompt);
	assert.strictEqual(buildImpactPrompt([]), '');
});

test('ファイルが多い型は切って「他 N ファイル」を添える', () => {
	const many = [{ type: 'User', files: Array.from({ length: 20 }, (_, i) => `src/f${i}.ts`) }];
	assert.ok(buildImpactPrompt(many, 3).includes('- …他 17 ファイル'));
});
