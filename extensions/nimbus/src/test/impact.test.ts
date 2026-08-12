/**
 * 変更影響範囲の事前プレビュー（T-158）の単体テスト。
 *
 * この機能は「**見落とさない**」ほうに倒してある（誤検出は許すが、取りこぼしは許さない）。
 * だから語の切れ目の判定と、変更したファイル自身を除くところを重点的に押さえる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { affectedFileCount, assessImpact, findReferences, formatImpact } from '../core/impact';

const files = (pairs: [string, string][]): Map<string, string> => new Map(pairs);

test('語の切れ目で探す（部分一致では拾わない）', () => {
	const found = findReferences(
		files([['a.ts', 'foo();\nfoobar();\nbar.foo;\nmyfoo = 1;']]),
		'foo',
		new Set()
	);
	assert.deepStrictEqual(found.map((r) => r.line), [1, 3]);
});

test('変更したファイル自身は数えない（定義行を影響と呼ばない）', () => {
	const map = files([['def.ts', 'export function foo() {}'], ['use.ts', 'foo();']]);
	assert.deepStrictEqual(
		findReferences(map, 'foo', new Set(['def.ts'])).map((r) => r.path),
		['use.ts']
	);
});

test('行番号は 1 始まりで、行の中身も返す', () => {
	const [reference] = findReferences(files([['a.ts', 'x\n  foo();  ']]), 'foo', new Set());
	assert.deepStrictEqual([reference.path, reference.line, reference.text], ['a.ts', 2, 'foo();']);
});

test('識別子として不正な名前は探さない（正規表現に流し込まない）', () => {
	assert.deepStrictEqual(findReferences(files([['a.ts', 'anything']]), '.*', new Set()), []);
	assert.deepStrictEqual(findReferences(files([['a.ts', 'anything']]), '', new Set()), []);
});

test('呼び出し元が残っているものだけを報告する', () => {
	const map = files([['use.ts', 'kept();']]);
	const impacted = assessImpact({
		symbols: [
			{ name: 'kept', kind: 'function', change: 'removed' },
			{ name: 'orphan', kind: 'function', change: 'removed' }
		],
		files: map,
		changedPaths: new Set()
	});
	assert.deepStrictEqual(impacted.map((s) => s.name), ['kept']);
});

test('参照の多い順に並べる', () => {
	const map = files([['a.ts', 'few();'], ['b.ts', 'many();\nmany();']]);
	const impacted = assessImpact({
		symbols: [
			{ name: 'few', kind: 'const', change: 'changed' },
			{ name: 'many', kind: 'function', change: 'removed' }
		],
		files: map,
		changedPaths: new Set()
	});
	assert.deepStrictEqual(impacted.map((s) => [s.name, s.references.length]), [['many', 2], ['few', 1]]);
});

test('影響を受けたファイル数は重複を除く', () => {
	const map = files([['a.ts', 'foo();\nfoo();'], ['b.ts', 'foo();']]);
	const impacted = assessImpact({
		symbols: [{ name: 'foo', kind: 'function', change: 'removed' }],
		files: map,
		changedPaths: new Set()
	});
	assert.strictEqual(affectedFileCount(impacted), 2);
});

test('見つからなかったときも、見えない呼び出しがあることを断る', () => {
	const out = formatImpact([]);
	assert.ok(out.includes('見つかりませんでした'), out);
	// 「無い」と言い切ると、動的呼び出しを見落とす
	assert.ok(out.includes('動的な呼び出し'), out);
});

test('報告は言い切らず、確認の出発点だと伝える', () => {
	const map = files([['use.ts', 'gone();']]);
	const out = formatImpact(
		assessImpact({
			symbols: [{ name: 'gone', kind: 'function', change: 'removed' }],
			files: map,
			changedPaths: new Set()
		})
	);
	assert.ok(out.includes('呼ばれているかもしれません'), out);
	assert.ok(out.includes('確認の出発点'), out);
	assert.ok(out.includes('`use.ts:1`'), out);
	assert.ok(out.includes('`function gone`（消した）'), out);
});

test('参照が多すぎるときは打ち切り、打ち切ったことを言う', () => {
	const many = Array.from({ length: 25 }, (_, i) => `x${i}: gone();`).join('\n');
	const out = formatImpact(
		assessImpact({
			symbols: [{ name: 'gone', kind: 'function', change: 'removed' }],
			files: files([['use.ts', many]]),
			changedPaths: new Set()
		})
	);
	assert.ok(out.includes('…ほか 5 箇所'), out);
});
