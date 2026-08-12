/**
 * 命名のゆれと重複（T-178 / T-137）の単体テスト。
 *
 * 誤検知が一番の害なので、**出しすぎないこと**を重点的に押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	conceptKey,
	findDuplicateBlocks,
	findNamingIssues,
	renderCodeHealth,
	splitIdentifier
} from '../core/codeHealth';

test('識別子を語に割る（camel / snake / Pascal）', () => {
	assert.deepStrictEqual(
		[splitIdentifier('getUserName'), splitIdentifier('get_user_name'), splitIdentifier('GetUserName')],
		[['get', 'user', 'name'], ['get', 'user', 'name'], ['get', 'user', 'name']]
	);
});

test('語の並びが同じなら同じ概念', () => {
	assert.strictEqual(conceptKey('fetchUserData'), conceptKey('fetch_user_data'));
});

test('綴りが 2 通り以上あるものだけを出す', () => {
	assert.deepStrictEqual(
		findNamingIssues(['getUserName', 'get_user_name', 'saveFile', 'saveFile']).map((i) => i.concept),
		['get.user.name']
	);
});

test('多い綴りを先に並べる（どちらに寄せるかの材料になる）', () => {
	assert.deepStrictEqual(
		findNamingIssues(['getUser', 'get_user', 'get_user'])[0].variants.map((v) => `${v.name}:${v.count}`),
		['get_user:2', 'getUser:1']
	);
});

const block = [
	'const result = await client.request(url, options);',
	'if (!result.ok) {',
	'    throw new Error(`request failed: ${result.status}`);',
	'}',
	'const parsed = JSON.parse(result.body);',
	'return normalizeResponse(parsed);'
].join('\n');

test('行の並びが完全に一致する塊を、場所つきで見つける', () => {
	const found = findDuplicateBlocks([
		{ path: 'a.ts', content: `// 前置き\n${block}` },
		{ path: 'b.ts', content: `function x() {\n${block}` }
	]);
	assert.deepStrictEqual(
		found.map((d) => d.places.map((p) => `${p.file}:${p.line}`)),
		[['a.ts:1', 'b.ts:1']]
	);
});

test('似ているだけのものは出さない（1 行違えば別物）', () => {
	const changed = block.replace('normalizeResponse', 'normalise');
	assert.deepStrictEqual(findDuplicateBlocks([{ path: 'a.ts', content: block }, { path: 'b.ts', content: changed }]), []);
});

test('import や短い行だけの塊は数えない', () => {
	const imports = Array.from({ length: 12 }, (_, i) => `import { thing${i} } from './m${i}';`).join('\n');
	assert.deepStrictEqual(findDuplicateBlocks([{ path: 'a.ts', content: imports }, { path: 'b.ts', content: imports }]), []);
});

test('何も無ければ、その旨だけを書く', () => {
	assert.ok(renderCodeHealth([], []).includes('見つかりませんでした'));
});

test('出力には「直すかは人が決める」と書く', () => {
	const text = renderCodeHealth(findNamingIssues(['getUser', 'get_user']), []);
	assert.deepStrictEqual(
		['同じ概念に別の綴り', '直すかどうかは人が決めてください'].map((s) => text.includes(s)),
		[true, true]
	);
});

test('定数（EDIT）と変数（edit）は別の慣習として扱う', () => {
	assert.deepStrictEqual(findNamingIssues(['EDIT', 'edit', 'MAX_SIZE', 'maxSize']), []);
});
