/**
 * スキルの発見と検索。
 * 「こんなスキルない？」と曖昧に聞かれても拾えることが要件なので、
 * 説明文への部分一致と、名前・説明の重み付けをここで固定する。
 */
import * as assert from 'assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { test } from 'node:test';
import { discoverSkills, parseSkillFrontmatter, searchSkills, scoreSkill, type Skill } from '../core/skills';

function writeSkill(root: string, dir: string, name: string, description: string): void {
	const skillDir = join(root, dir);
	mkdirSync(skillDir, { recursive: true });
	writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n本文\n`);
}

test('frontmatter から name と description を取り出す', () => {
	const meta = parseSkillFrontmatter('---\nname: pptx\ndescription: "スライドを作る"\nother: x\n---\n本文');
	assert.deepStrictEqual(meta, { name: 'pptx', description: 'スライドを作る' });
});

test('frontmatter が無ければ空を返す', () => {
	assert.deepStrictEqual(parseSkillFrontmatter('# ただの見出し'), {});
	assert.deepStrictEqual(parseSkillFrontmatter('---\n閉じていない'), {});
});

test('プロジェクトとユーザーの両方からスキルを集める', () => {
	const root = mkdtempSync(join(tmpdir(), 'nimbus-skills-'));
	const workspace = join(root, 'ws');
	const home = join(root, 'home');
	writeSkill(workspace, '.claude/skills/pptx', 'pptx', 'スライドを作る');
	writeSkill(workspace, '.agents/skills/review', 'review', 'コードを見る');
	writeSkill(home, '.claude/skills/photo', 'photo', '画像を整える');

	const skills = discoverSkills([workspace], home);
	assert.deepStrictEqual(skills.map((s) => s.name), ['photo', 'pptx', 'review']);
	assert.strictEqual(skills.find((s) => s.name === 'photo')?.origin, 'ユーザー');
	assert.strictEqual(skills.find((s) => s.name === 'pptx')?.origin, 'プロジェクト');
});

test('同名はプロジェクト側を優先する', () => {
	const root = mkdtempSync(join(tmpdir(), 'nimbus-skills-'));
	const workspace = join(root, 'ws');
	const home = join(root, 'home');
	writeSkill(workspace, '.claude/skills/pptx', 'pptx', 'プロジェクト版');
	writeSkill(home, '.claude/skills/pptx', 'pptx', 'ユーザー版');

	const skills = discoverSkills([workspace], home);
	assert.strictEqual(skills.length, 1);
	assert.strictEqual(skills[0].description, 'プロジェクト版');
});

test('SKILL.md の無いディレクトリは無視する', () => {
	const root = mkdtempSync(join(tmpdir(), 'nimbus-skills-'));
	mkdirSync(join(root, 'ws', '.claude', 'skills', 'empty'), { recursive: true });
	assert.deepStrictEqual(discoverSkills([join(root, 'ws')], join(root, 'home')), []);
});

const sample: Skill[] = [
	{ name: 'pptx', description: 'PowerPoint のスライドを作る', path: 'a', origin: 'p' },
	{ name: 'photo-edit', description: '写真をきれいにする', path: 'b', origin: 'p' },
	{ name: 'review', description: 'コードレビューをする', path: 'c', origin: 'u' }
];

test('説明文の言葉でも見つかる（名前を知らなくてよい）', () => {
	const hits = searchSkills(sample, 'スライド');
	assert.deepStrictEqual(hits.map((s) => s.name), ['pptx']);
});

test('名前の一致は説明の一致より強い', () => {
	const named = scoreSkill(sample[0], 'pptx');
	const described = scoreSkill(sample[0], 'スライド');
	assert.ok(named > described, `${named} > ${described}`);
});

test('複数語はすべて加点され、当たらないものは落ちる', () => {
	const hits = searchSkills(sample, 'コード レビュー');
	assert.deepStrictEqual(hits.map((s) => s.name), ['review']);
	assert.deepStrictEqual(searchSkills(sample, '存在しない言葉'), []);
});

test('空の問い合わせは全件を返す', () => {
	assert.strictEqual(searchSkills(sample, '   ').length, sample.length);
});
