/**
 * ミューテーションの候補出し。
 *
 * **意味が変わることが確実なものだけ**を出す。「たぶん変わる」を混ぜると、
 * 落ちなかった理由が「そもそも壊れていない」になり、評価にならない。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildMutationPrompt, describeMutations, findMutations } from '../core/mutations';

const SOURCE = [
	'// 比較は >= のままにする（コメントは壊さない）',
	'function ok(n) {',
	'  if (n >= 3 && n !== 0) {',
	'    return true;',
	'  }',
	'  return false;',
	'}'
].join('\n');

test('確実に意味が変わる箇所だけを候補にする', () => {
	assert.deepStrictEqual(findMutations(SOURCE), [
		{ line: 3, from: '>=', to: '>', source: 'if (n >= 3 && n !== 0) {' },
		{ line: 4, from: 'true', to: 'false', source: 'return true;' },
		{ line: 6, from: 'false', to: 'true', source: 'return false;' }
	]);
});

test('語としての true / false だけを見る（trueValue は壊さない）', () => {
	assert.deepStrictEqual(findMutations('const trueValue = 1;'), []);
});

test('1 行につき 1 つ、上限で打ち切る', () => {
	const many = Array.from({ length: 20 }, () => 'if (a >= b) {}').join('\n');
	assert.strictEqual(findMutations(many, 3).length, 3);
});

test('一覧は行番号と置き換えとソースを出す', () => {
	assert.strictEqual(
		describeMutations('src/a.ts', findMutations(SOURCE, 1)),
		['src/a.ts: 1 通りの壊し方が作れます', '  3: >= → >  if (n >= 3 && n !== 0) {'].join('\n')
	);
	assert.strictEqual(
		describeMutations('src/a.ts', []),
		'src/a.ts には、確実に意味が変わる壊し方が見つかりませんでした。'
	);
});

test('投入する文は「1 つずつ」「必ず戻す」「確かめるだけ」を含む', () => {
	const prompt = buildMutationPrompt('src/a.ts', findMutations(SOURCE, 1));
	assert.ok(prompt.includes('**1 つずつ**'), prompt);
	assert.ok(prompt.includes('**必ず元に戻す**'), prompt);
	assert.ok(prompt.includes('**確かめるだけ**'), prompt);
	assert.ok(prompt.includes('1. 3 行目: `>=` を `>` に'), prompt);
	assert.strictEqual(buildMutationPrompt('src/a.ts', []), '');
});
