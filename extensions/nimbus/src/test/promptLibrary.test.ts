/**
 * プロンプトライブラリ（T-035）と、横断的な「探す」（T-117）の単体テスト。
 *
 * 埋め残しを**空文字にしない**ことが要。空にすると、何が抜けたか分からないまま送られる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	BUILTIN_TEMPLATES,
	describeTemplate,
	extractVariables,
	fillTemplate,
	missingVariables,
	removeTemplate,
	upsertTemplate
} from '../core/promptLibrary';
import { describeFindable, searchFindables, toPrompt, type Findable } from '../core/findAnything';

const BODY = '{{対象ファイル}} を {{観点}} でレビューし、{{対象ファイル}} の要点をまとめて';

test('変数は出てきた順に、重複なく拾う', () => {
	assert.deepStrictEqual(extractVariables(BODY), ['対象ファイル', '観点']);
	assert.deepStrictEqual(extractVariables('変数なし'), []);
});

test('同じ変数は全部埋まる', () => {
	assert.strictEqual(
		fillTemplate(BODY, { 対象ファイル: 'a.ts', 観点: '性能' }),
		'a.ts を 性能 でレビューし、a.ts の要点をまとめて'
	);
});

test('埋め残しは空文字にせず、そのまま残す（何が抜けたか分かるように）', () => {
	assert.strictEqual(fillTemplate(BODY, { 対象ファイル: 'a.ts' }), 'a.ts を {{観点}} でレビューし、a.ts の要点をまとめて');
	assert.deepStrictEqual(missingVariables(BODY, { 対象ファイル: 'a.ts' }), ['観点']);
	assert.deepStrictEqual(missingVariables(BODY, { 対象ファイル: 'a.ts', 観点: '性能' }), []);
	// 空文字を入れたら「埋めていない」扱い
	assert.deepStrictEqual(missingVariables(BODY, { 対象ファイル: '', 観点: 'x' }), ['対象ファイル']);
});

test('出荷時の定型が入っていて、変数の書き方の例になっている', () => {
	assert.ok(BUILTIN_TEMPLATES.length >= 3);
	assert.ok(BUILTIN_TEMPLATES.every((template) => extractVariables(template.body).length > 0));
});

test('同じ名前の定型は 2 つ作らない', () => {
	const once = upsertTemplate([], { name: 'a', body: '1' });
	assert.deepStrictEqual(upsertTemplate(once, { name: 'a', body: '2' }), [{ name: 'a', body: '2' }]);
	assert.deepStrictEqual(removeTemplate(once, 'a'), []);
});

test('一覧の説明には変数の数を出す', () => {
	assert.strictEqual(describeTemplate({ name: 'x', body: BODY, description: '説明' }), '説明 · 変数 2');
	assert.strictEqual(describeTemplate({ name: 'x', body: '固定' }), '変数なし');
});

// --- 横断的な「探す」（T-117） ---

const ITEMS: Findable[] = [
	{ kind: 'skill', name: 'pptx', description: 'PowerPoint を作る', origin: 'プロジェクト' },
	{ kind: 'command', name: 'review', description: 'コードレビューを走らせる' },
	{ kind: 'agent', name: 'explorer', description: 'コードを探すサブエージェント' },
	{ kind: 'tool', name: 'mcp__github__search', description: 'GitHub を検索する' }
];

test('名前に当たったものを上に、説明にしか当たらないものを下に出す', () => {
	assert.deepStrictEqual(
		searchFindables(ITEMS, 'review').map((item) => item.name),
		['review']
	);
	// 説明にだけ当たる語
	assert.deepStrictEqual(
		searchFindables(ITEMS, 'PowerPoint').map((item) => item.name),
		['pptx']
	);
});

test('当たらないものは出さない。空の検索語は全部出す', () => {
	assert.deepStrictEqual(searchFindables(ITEMS, 'まったく無い語'), []);
	assert.strictEqual(searchFindables(ITEMS, '').length, ITEMS.length);
});

test('送る文は種類で変える（MCP ツールとサブエージェントは直接撃てない）', () => {
	assert.strictEqual(toPrompt(ITEMS[0]), '/pptx');
	assert.strictEqual(toPrompt(ITEMS[1]), '/review');
	assert.ok(toPrompt(ITEMS[2]).startsWith('explorer のサブエージェントを使って'));
	assert.ok(toPrompt(ITEMS[3]).startsWith('mcp__github__search を使って'));
});

test('一覧の説明には種類と出どころを出す', () => {
	assert.strictEqual(describeFindable(ITEMS[0]), 'スキル · プロジェクト');
	assert.strictEqual(describeFindable(ITEMS[1]), 'コマンド');
});
