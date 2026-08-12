/**
 * スキーマから型を起こす（T-122）の単体テスト。
 *
 * **扱えないものを黙って出さないこと**（間違った型を信じさせない）を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { parseSchemas, renderModels, toDart, toTypeScript } from '../core/openapi';

const document = {
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
			Profile: { type: 'object', properties: { bio: { type: 'string' } } },
			Either: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
			Name: { type: 'string' }
		}
	}
};

const models = parseSchemas(document);
const user = models.find((m) => m.name === 'User');

test('必須・nullable・配列・$ref を読み分ける', () => {
	assert.deepStrictEqual(
		user?.fields.map((f) => `${f.name}:${f.type}${f.itemType ? '<' + f.itemType + '>' : ''}:${f.required}:${f.nullable}`),
		['id:integer:true:false', 'name:string:true:false', 'nickname:string:false:true', 'tags:array<string>:false:false', 'profile:Profile:false:false']
	);
});

test('扱えないものは、理由つきで扱えないと言う', () => {
	assert.deepStrictEqual(
		models.filter((m) => m.unsupported).map((m) => m.name),
		['Either', 'Name']
	);
});

test('Dart は必須でなければ ? を付ける（曖昧なら nullable に倒す）', () => {
	const dart = toDart(user!);
	assert.deepStrictEqual(
		['final int id;', 'final String? nickname;', 'final List<String>? tags;', 'final Profile? profile;'].map((s) => dart.includes(s)),
		[true, true, true, true]
	);
});

test('Dart には fromJson も付ける', () => {
	assert.ok(toDart(user!).includes('factory User.fromJson(Map<String, dynamic> json)'));
});

test('TypeScript は必須でなければ ? を、nullable なら | null を付ける', () => {
	const ts = toTypeScript(user!);
	assert.deepStrictEqual(
		['id: number;', 'nickname?: string | null;', 'tags?: string[];'].map((s) => ts.includes(s)),
		[true, true, true]
	);
});

test('扱えないものはコメントとして出す（型として出さない）', () => {
	assert.ok(toDart(models.find((m) => m.name === 'Either')!).startsWith('// Either:'));
});

test('スキーマが無ければ、その旨だけを書く', () => {
	assert.ok(renderModels(parseSchemas({}), 'dart').includes('見つかりませんでした'));
});

test('そのまま貼らないように、と書き添える', () => {
	assert.ok(renderModels(models, 'dart').includes('そのまま貼らずに'));
});
