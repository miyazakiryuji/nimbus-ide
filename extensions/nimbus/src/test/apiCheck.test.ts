/**
 * 実物との突き合わせと、仮の応答（T-218 / T-124）の単体テスト。
 *
 * 「余分なフィールドを間違いと言わない」「仮の値を本物に見せない」を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildExample, checkResponse, renderResponseCheck, typeOfValue } from '../core/apiCheck';
import { parseSchemas } from '../core/openapi';

const models = parseSchemas({
	components: {
		schemas: {
			User: {
				type: 'object',
				required: ['id', 'name'],
				properties: {
					id: { type: 'integer' },
					name: { type: 'string' },
					nickname: { type: 'string', nullable: true },
					tags: { type: 'array', items: { type: 'string' } },
					profile: { $ref: '#/components/schemas/Profile' }
				}
			},
			Profile: { type: 'object', properties: { bio: { type: 'string' } } }
		}
	}
});
const user = models.find((m) => m.name === 'User')!;

test('JSON の値から型を見分ける（整数と小数を分ける）', () => {
	assert.deepStrictEqual([1, 1.5, 'a', true, null, [], {}].map(typeOfValue), [
		'integer',
		'number',
		'string',
		'boolean',
		'null',
		'array',
		'object'
	]);
});

test('必須が返っていなければ挙げる', () => {
	assert.deepStrictEqual(
		checkResponse(user, { name: 'x' }).filter((f) => f.kind === 'missing').map((f) => f.field),
		['id']
	);
});

test('型が違えば挙げる', () => {
	assert.deepStrictEqual(
		checkResponse(user, { id: 'いち', name: 'x' }).filter((f) => f.kind === 'type-mismatch').map((f) => f.field),
		['id']
	);
});

test('integer の場所に number が来ても騒がない（JSON では区別されない）', () => {
	const findings = checkResponse({ name: 'X', fields: [{ name: 'v', type: 'number', required: true, nullable: false }] }, { v: 3 });
	assert.deepStrictEqual(findings, []);
});

test('許していない null は挙げる', () => {
	assert.deepStrictEqual(
		checkResponse(user, { id: 1, name: null }).filter((f) => f.kind === 'null-not-allowed').map((f) => f.field),
		['name']
	);
});

test('nullable なら null を通す', () => {
	assert.deepStrictEqual(checkResponse(user, { id: 1, name: 'x', nickname: null }), []);
});

test('余分なフィールドは挙げるが、間違いとは言わない', () => {
	const [finding] = checkResponse(user, { id: 1, name: 'x', extra: 1 });
	assert.deepStrictEqual({ kind: finding.kind, says: finding.message.includes('サーバーが足したもの') }, { kind: 'extra', says: true });
});

test('オブジェクトでないものが返ったら、それだけを言う', () => {
	assert.deepStrictEqual(checkResponse(user, [1, 2]).map((f) => f.field), ['(全体)']);
});

test('仮の応答は、明らかに仮の値で作る', () => {
	assert.deepStrictEqual(buildExample(user, models), {
		id: 0,
		name: 'text',
		nickname: 'text',
		tags: ['text'],
		profile: { bio: 'text' }
	});
});

test('一致していれば、そう書く', () => {
	assert.ok(renderResponseCheck(user, []).includes('一致しています'));
});
