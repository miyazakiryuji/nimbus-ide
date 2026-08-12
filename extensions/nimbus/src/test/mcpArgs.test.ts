/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildArgs, coerce, describeResult, toFields, type JsonSchema } from '../core/mcpArgs';

const SCHEMA: JsonSchema = {
	type: 'object',
	properties: {
		count: { type: 'integer', description: '何件' },
		path: { type: 'string', description: 'ファイル' },
		mode: { type: 'string', enum: ['read', 'write'] },
		deep: { type: 'boolean', default: false }
	},
	required: ['path', 'count']
};

describe('mcpArgs', () => {
	test('必須が先に来て、選択肢と既定値を拾う', () => {
		assert.deepStrictEqual(toFields(SCHEMA), [
			{ name: 'count', type: 'integer', description: '何件', required: true, choices: undefined, placeholder: undefined },
			{ name: 'path', type: 'string', description: 'ファイル', required: true, choices: undefined, placeholder: undefined },
			{ name: 'mode', type: 'string', description: undefined, required: false, choices: ['read', 'write'], placeholder: undefined },
			{ name: 'deep', type: 'boolean', description: undefined, required: false, choices: undefined, placeholder: 'false' }
		]);
	});

	test('スキーマが無いときは何も聞かない', () => {
		assert.deepStrictEqual(toFields(undefined), []);
		assert.deepStrictEqual(toFields({ type: 'object' }), []);
	});

	test('型ごとに変換する', () => {
		assert.deepStrictEqual(
			['3', '3.5', 'x', 'はい', 'false', '{"a":1}', '[1]'].map((raw, index) =>
				coerce(['integer', 'integer', 'number', 'boolean', 'boolean', 'object', 'array'][index], raw)
			),
			[
				{ ok: true, value: 3 },
				{ ok: false, reason: '整数を入れてください: 3.5' },
				{ ok: false, reason: '数として読めません: x' },
				{ ok: true, value: true },
				{ ok: true, value: false },
				{ ok: true, value: { a: 1 } },
				{ ok: true, value: [1] }
			]
		);
	});

	test('object に配列を渡したら弾く（型で弾かれると原因が分かりにくいので手前で言う）', () => {
		assert.deepStrictEqual(coerce('object', '[1]'), { ok: false, reason: 'オブジェクト（`{...}`）を入れてください' });
		assert.deepStrictEqual(coerce('array', '{"a":1}'), { ok: false, reason: '配列（`[...]`）を入れてください' });
		assert.deepStrictEqual(coerce('object', 'なにか'), { ok: false, reason: 'JSON として読めません' });
	});

	test('文字列は空白を落とさない（前後の空白に意味があることがある）', () => {
		assert.deepStrictEqual(coerce('string', '  a  '), { ok: true, value: '  a  ' });
	});

	test('空の任意項目はキーごと入れない', () => {
		const fields = toFields(SCHEMA);
		assert.deepStrictEqual(
			buildArgs(fields, new Map([['count', '2'], ['path', 'a.ts'], ['mode', ''], ['deep', '']])),
			{ ok: true, args: { count: 2, path: 'a.ts' } }
		);
	});

	test('必須が空なら理由を言って止める', () => {
		const fields = toFields(SCHEMA);
		assert.deepStrictEqual(buildArgs(fields, new Map([['count', '2']])), { ok: false, reason: 'path は必須です' });
		assert.deepStrictEqual(
			buildArgs(fields, new Map([['count', 'x'], ['path', 'a.ts']])),
			{ ok: false, reason: 'count: 数として読めません: x' }
		);
	});

	test('結果は成功も失敗も同じ形で見せる', () => {
		assert.strictEqual(
			describeResult({ content: [{ type: 'text', text: 'ok' }] }, 12),
			'成功しました（12 ms）\n\nok'
		);
		assert.strictEqual(
			describeResult({ isError: true, content: [{ type: 'text', text: 'こわれた' }] }, 5),
			'失敗しました（5 ms）\n\nこわれた'
		);
	});

	test('中身が空でも「何も出ない」にしない', () => {
		assert.strictEqual(describeResult({}, 1), '成功しました（1 ms）\n\n（中身が空でした）');
		// content を持たない古い形のサーバー
		assert.strictEqual(describeResult({ toolResult: ['a'] }, 1), '成功しました（1 ms）\n\n[\n  "a"\n]');
		assert.strictEqual(
			describeResult({ structuredContent: { a: 1 } }, 1),
			'成功しました（1 ms）\n\n{\n  "a": 1\n}'
		);
	});
});
