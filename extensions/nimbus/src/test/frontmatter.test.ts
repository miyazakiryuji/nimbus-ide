/**
 * フロントマターの補完と検証（T-030）の単体テスト。
 *
 * **書式ミスは黙って読み込まれない**ので、足りないものを名指しできることが要。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { completionsFor, FIELDS, frontmatterRange, isInsideFrontmatter, kindOfPath, validate, writtenKeys } from '../core/frontmatter';

const SKILL = ['---', 'name: pptx', 'description: PowerPoint を作るとき', '---', '', '本文'].join('\n');

test('置き場所から種類を決める', () => {
	assert.strictEqual(kindOfPath('/w/.claude/skills/pptx/SKILL.md'), 'skill');
	assert.strictEqual(kindOfPath('/w/.claude/agents/explorer.md'), 'agent');
	assert.strictEqual(kindOfPath('/w/.claude/commands/test.md'), 'command');
	// 関係ないファイルでは補完を出さない
	assert.strictEqual(kindOfPath('/w/README.md'), undefined);
	assert.strictEqual(kindOfPath('/w/.claude/skills/pptx/reference.md'), undefined);
});

test('frontmatter の範囲と、中にいるかを判定する', () => {
	assert.deepStrictEqual(frontmatterRange(SKILL), { start: 0, end: SKILL.indexOf('\n---') + 4 });
	assert.ok(isInsideFrontmatter(SKILL, 10));
	// 本文の位置では出さない
	assert.ok(!isInsideFrontmatter(SKILL, SKILL.length - 1));
	assert.strictEqual(frontmatterRange('本文だけ'), undefined);
});

test('既に書いたキーは候補に出さない（重複キーは後勝ちで事故る）', () => {
	assert.deepStrictEqual(writtenKeys(SKILL), ['name', 'description']);
	assert.deepStrictEqual(completionsFor('skill', SKILL).map((f) => f.name), ['allowed-tools']);
});

test('必須のフィールドが種類ごとに決まっている', () => {
	assert.deepStrictEqual(FIELDS.skill.filter((f) => f.required).map((f) => f.name), ['name', 'description']);
	assert.deepStrictEqual(FIELDS.command.filter((f) => f.required).map((f) => f.name), ['description']);
});

test('足りないものを名指しする', () => {
	const problems = validate('skill', '---\nname: x\n---\n本文');
	assert.strictEqual(problems.length, 1);
	assert.ok(problems[0].message.includes('description'));
	assert.strictEqual(problems[0].severity, 'error');
});

test('frontmatter が無い・本文が無いものを止める', () => {
	assert.ok(validate('skill', '本文だけ')[0].message.includes('frontmatter がありません'));
	const noBody = validate('skill', SKILL.replace('本文', ''));
	assert.ok(noBody.some((p) => p.message.includes('本文がありません')));
});

test('description が短すぎるときは警告にする（止めはしない）', () => {
	const problems = validate('skill', '---\nname: x\ndescription: 短い\n---\n本文');
	const warning = problems.find((p) => p.severity === 'warning');
	assert.ok(warning?.message.includes('短すぎます'));
});

test('揃っていれば指摘しない', () => {
	assert.deepStrictEqual(validate('skill', SKILL), []);
});
