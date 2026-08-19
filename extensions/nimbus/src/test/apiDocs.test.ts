/**
 * API ドキュメントの追従。
 *
 * **「名前が出てくる」だけで直させない**のが要件。部分一致で拾うと
 * `run` のような短い名前があらゆる文書に当たり、指摘が信用されなくなる。
 *
 * 守っている修正（T-274）: T-209
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildDocUpdatePrompt, changedExports, describeStaleDocs, findStaleDocs } from '../core/apiDocs';

const DIFF = [
	'--- a/src/a.ts',
	'+++ b/src/a.ts',
	'-export function oldName(a) {}',
	'+export function newName(a, b) {}',
	'+export interface Options {}',
	'+const notExported = 1;',
	' export function untouched() {}'
].join('\n');

test('差分から公開している名前の変更だけを拾う', () => {
	assert.deepStrictEqual(changedExports(DIFF), ['oldName', 'newName', 'Options']);
});

const DOCS = [
	{ path: 'docs/api.md', text: '`newName(a, b)` を使います。' },
	{ path: 'docs/other.md', text: 'newNameSuffix は別物です。' },
	{ path: 'README.md', text: 'oldName は廃止予定。' }
];

test('名前として言及している文書だけを挙げる（部分一致では拾わない）', () => {
	assert.deepStrictEqual(findStaleDocs(['newName'], [], DOCS), [
		{ symbol: 'newName', docs: ['docs/api.md'] }
	]);
});

test('今回いっしょに変えた文書は挙げない', () => {
	assert.deepStrictEqual(findStaleDocs(['newName'], ['docs/api.md'], DOCS), []);
});

test('どこにも書かれていない名前は挙げない', () => {
	assert.deepStrictEqual(findStaleDocs(['Options'], [], DOCS), []);
});

test('一覧は名前と文書を並べる。無ければそう言う', () => {
	assert.strictEqual(
		describeStaleDocs(findStaleDocs(['newName', 'oldName'], [], DOCS)),
		[
			'変えた名前に触れている文書が 2 件あります（今回の変更に含まれていません）',
			'  newName: docs/api.md',
			'  oldName: README.md'
		].join('\n')
	);
	assert.ok(describeStaleDocs([]).startsWith('公開している名前を変えた形跡はありますが'));
});

test('投入する文は「確かめてから直す」を求める', () => {
	const prompt = buildDocUpdatePrompt(findStaleDocs(['newName'], [], DOCS));
	assert.ok(prompt.includes('**実際に古くなっているかを確かめてから**直してください。'), prompt);
	assert.ok(prompt.includes('- `newName` → `docs/api.md`'), prompt);
	assert.strictEqual(buildDocUpdatePrompt([]), '');
});
