/**
 * サブエージェントごとのモデル指定（T-232）の単体テスト。
 *
 * **割り当てが 1 つも無いときに何も渡さない**ことが要。渡すと、利用者の定義を
 * Nimbus が組み直したもので置き換えてしまう。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildAgentOverrides, describeAgent, parseAgentFile } from '../core/agentDefs';

const FILE = [
	'---',
	'name: explorer',
	'description: コードを探す係',
	'tools: Read, Grep, Glob',
	'model: haiku',
	'---',
	'',
	'あなたはコードを探す係です。',
	'見つけた場所だけを返してください。'
].join('\n');

test('frontmatter と本文を読み分ける', () => {
	assert.deepStrictEqual(parseAgentFile('explorer.md', FILE), {
		name: 'explorer',
		description: 'コードを探す係',
		tools: ['Read', 'Grep', 'Glob'],
		model: 'haiku',
		prompt: 'あなたはコードを探す係です。\n見つけた場所だけを返してください。'
	});
});

test('name が無ければファイル名を使う', () => {
	const parsed = parseAgentFile('reviewer.md', '---\ndescription: 見る係\n---\n本文');
	assert.strictEqual(parsed?.name, 'reviewer');
});

test('description か本文が空なら定義として扱わない', () => {
	assert.strictEqual(parseAgentFile('a.md', '---\ndescription: x\n---\n   '), undefined);
	assert.strictEqual(parseAgentFile('a.md', '---\nname: a\n---\n本文'), undefined);
	assert.strictEqual(parseAgentFile('a.md', ''), undefined);
});

test('角括弧つきのリストも読む', () => {
	const parsed = parseAgentFile('a.md', "---\ndescription: x\ntools: [Read, 'Bash']\n---\n本文");
	assert.deepStrictEqual(parsed?.tools, ['Read', 'Bash']);
});

test('割り当てが無ければ何も渡さない（利用者の定義を置き換えない）', () => {
	const file = parseAgentFile('explorer.md', FILE)!;
	assert.deepStrictEqual(buildAgentOverrides([file], {}), {});
});

test('割り当てたものだけを、元の定義ごと組み立て直す', () => {
	const file = parseAgentFile('explorer.md', FILE)!;
	assert.deepStrictEqual(buildAgentOverrides([file], { explorer: 'sonnet' }), {
		explorer: {
			description: 'コードを探す係',
			prompt: 'あなたはコードを探す係です。\n見つけた場所だけを返してください。',
			tools: ['Read', 'Grep', 'Glob'],
			model: 'sonnet'
		}
	});
});

test('一覧の説明は割り当て → 定義 → 既定の順で出す', () => {
	const file = parseAgentFile('explorer.md', FILE)!;
	assert.strictEqual(describeAgent(file, 'sonnet'), 'sonnet · ツール 3');
	assert.strictEqual(describeAgent(file, undefined), 'haiku · ツール 3');
	assert.strictEqual(describeAgent({ name: 'a', description: 'x', prompt: 'y' }, undefined), '既定');
});
