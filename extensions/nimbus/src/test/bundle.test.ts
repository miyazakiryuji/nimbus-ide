/**
 * 設定のパッケージ配布（T-043）の単体テスト。
 *
 * 配布物は**他人の環境で展開される**ので、危ないものが入らないこと・
 * 既存を黙って上書きしないことが要。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildBundle, describePlan, isBundlable, parseBundle, planApply } from '../core/bundle';

const NOW = new Date('2026-08-13T12:00:00.000Z');

test('配れるのはスキル・サブエージェント・コマンドと settings.json だけ', () => {
	for (const path of ['skills/a/SKILL.md', 'agents/explorer.md', 'commands/x.md', 'settings.json']) {
		assert.ok(isBundlable(path), path);
	}
	for (const path of ['settings.local.json', '.env', 'certs/a.pem', 'secrets.json', 'other/x.md']) {
		assert.ok(!isBundlable(path), path);
	}
});

test('まとめるときに配れないものを落とし、並びを固定する', () => {
	const bundle = buildBundle(
		'チーム設定',
		'共通のスキル',
		[
			{ path: 'skills/z/SKILL.md', content: 'z' },
			{ path: 'settings.local.json', content: '個人の設定' },
			{ path: 'agents/a.md', content: 'a' }
		],
		NOW
	);
	assert.deepStrictEqual(bundle.files.map((f) => f.path), ['agents/a.md', 'skills/z/SKILL.md']);
	assert.strictEqual(bundle.version, 1);
	assert.strictEqual(bundle.createdAt, '2026-08-13T12:00:00.000Z');
});

test('知らない版は読まない', () => {
	const result = parseBundle(JSON.stringify({ version: 2, name: 'x', files: [] }));
	assert.deepStrictEqual(result, { ok: false, reason: '知らない形式です（version: 2）' });
});

test('壊れた JSON・形の違うものを弾く', () => {
	assert.strictEqual(parseBundle('こわれた').ok, false);
	assert.strictEqual(parseBundle('null').ok, false);
	assert.strictEqual(parseBundle(JSON.stringify({ version: 1 })).ok, false);
	assert.strictEqual(parseBundle(JSON.stringify({ version: 1, name: 'x', files: [{ path: 1 }] })).ok, false);
});

test('`..` や絶対パスは弾く（.claude の外へ書かせない）', () => {
	for (const path of ['../outside.md', '/etc/passwd', 'skills/../../x.md']) {
		const result = parseBundle(JSON.stringify({ version: 1, name: 'x', files: [{ path, content: '' }] }));
		assert.strictEqual(result.ok, false, path);
	}
});

test('配れないものが入った配布物は読み込まない', () => {
	const result = parseBundle(
		JSON.stringify({ version: 1, name: 'x', files: [{ path: 'settings.local.json', content: '' }] })
	);
	assert.strictEqual(result.ok, false);
	assert.ok(!result.ok && result.reason.includes('配れないもの'));
});

test('展開の前に「何が起きるか」を出す', () => {
	const bundle = buildBundle('x', '', [
		{ path: 'skills/new/SKILL.md', content: '新' },
		{ path: 'skills/same/SKILL.md', content: '同' },
		{ path: 'skills/diff/SKILL.md', content: '配布側' }
	], NOW);
	const existing = new Map([
		['skills/same/SKILL.md', '同'],
		['skills/diff/SKILL.md', '自分のもの']
	]);
	const plan = planApply(bundle, existing);
	assert.deepStrictEqual(plan.added.map((f) => f.path), ['skills/new/SKILL.md']);
	assert.deepStrictEqual(plan.unchanged.map((f) => f.path), ['skills/same/SKILL.md']);
	// 中身が違うものは「上書き」として分けて出す（黙って消さない）
	assert.deepStrictEqual(plan.conflicting.map((f) => f.path), ['skills/diff/SKILL.md']);
	assert.strictEqual(describePlan(plan), '新規 1 · 上書き 1 · 変更なし 1');
});

test('空の配布物でも言葉を返す', () => {
	assert.strictEqual(describePlan({ added: [], conflicting: [], unchanged: [] }), '入っているものはありません');
});
