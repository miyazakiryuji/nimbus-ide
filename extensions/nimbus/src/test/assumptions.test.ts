/**
 * 前提・仮定の抽出（T-186）。
 * 拾いすぎると本文の要約になってしまい、目立たせる意味が無くなる。
 * 「仮定を置いた文」だけを拾い、それ以外は拾わないことを固定する。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { extractAssumptions } from '../core/assumptions';

test('「〜と仮定して」を拾う', () => {
	const found = extractAssumptions('設定ファイルは JSON と仮定して進めます。まず読み込みます。');
	assert.deepStrictEqual(found, ['設定ファイルは JSON と仮定して進めます。']);
});

test('「前提として」を拾う', () => {
	const found = extractAssumptions('Node 24 が入っている前提で書きます。');
	assert.strictEqual(found.length, 1);
	assert.ok(found[0].includes('前提'));
});

test('「とりあえず」で進めた箇所を拾う', () => {
	const found = extractAssumptions('命名は決まっていないので、とりあえず temp という名前で進めます。');
	assert.strictEqual(found.length, 1);
});

test('英語の assume も拾う', () => {
	const found = extractAssumptions('I will assume the API returns JSON.\nThen parse it.');
	assert.strictEqual(found.length, 1);
	assert.ok(/assume/i.test(found[0]));
});

test('箇条書きの記号は落として本文だけ残す', () => {
	const found = extractAssumptions('- タイムゾーンは UTC と想定します\n- 次に実装します');
	assert.deepStrictEqual(found, ['タイムゾーンは UTC と想定します']);
});

test('複数の仮定をすべて拾う', () => {
	const found = extractAssumptions('DB は Postgres と仮定します。\n認証は済んでいる前提で進めます。');
	assert.strictEqual(found.length, 2);
});

test('同じ文が繰り返されても 1 つにまとめる', () => {
	const found = extractAssumptions('UTC と仮定します。\nUTC と仮定します。');
	assert.strictEqual(found.length, 1);
});

test('否定形は拾わない（仮定していないと言っている）', () => {
	assert.deepStrictEqual(extractAssumptions('ここは仮定せず、実際の値を読みます。'), []);
});

test('質問は拾わない（仮定ではなく確認）', () => {
	assert.deepStrictEqual(extractAssumptions('タイムゾーンは UTC と仮定してよいですか？'), []);
});

test('普通の説明文は拾わない', () => {
	assert.deepStrictEqual(extractAssumptions('ファイルを読み込み、パースして、結果を返します。'), []);
});

test('長すぎる文は畳む', () => {
	const long = `${'あ'.repeat(300)}と仮定します。`;
	const found = extractAssumptions(long);
	assert.strictEqual(found.length, 1);
	assert.ok(found[0].endsWith('…'));
	assert.ok(found[0].length <= 161, String(found[0].length));
});

test('空文字なら何も返さない', () => {
	assert.deepStrictEqual(extractAssumptions(''), []);
});
