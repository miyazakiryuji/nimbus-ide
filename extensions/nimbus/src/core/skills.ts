/**
 * スキルの発見。
 *
 * 「こんなことをしてくれるスキル、ないかな？」に答えるには、まずどこに何があるかを
 * 知っていないといけない。Claude Code のスキルは `<dir>/skills/<name>/SKILL.md` に
 * 置かれ、先頭の YAML frontmatter に name と description を持つ。
 *
 * ここではファイルを読むだけで、検索の当たり判定（スコアリング）も含めて
 * VS Code に依存しない。拡張ホストなしで検証できる。
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface Skill {
	name: string;
	description: string;
	/** SKILL.md の場所 */
	path: string;
	/** どこ由来か（プロジェクト / ユーザー / プラグイン） */
	origin: string;
}

/**
 * SKILL.md の frontmatter から name / description を取り出す。
 * YAML パーサは持ち込まない（この 2 つのキーしか要らないため）。
 * 複数行の折り返し（`description: >-` など）は使われないので単純な行解析で足りる。
 */
export function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
	if (!content.startsWith('---')) {
		return {};
	}
	const end = content.indexOf('\n---', 3);
	if (end < 0) {
		return {};
	}
	const result: { name?: string; description?: string } = {};
	for (const line of content.slice(3, end).split('\n')) {
		const match = /^(name|description)\s*:\s*(.*)$/.exec(line.trim());
		if (!match) {
			continue;
		}
		const value = match[2].trim().replace(/^['"]|['"]$/g, '');
		if (match[1] === 'name') {
			result.name = value;
		} else {
			result.description = value;
		}
	}
	return result;
}

function scanSkillsDir(skillsDir: string, origin: string): Skill[] {
	if (!existsSync(skillsDir)) {
		return [];
	}
	const found: Skill[] = [];
	let entries: string[];
	try {
		entries = readdirSync(skillsDir);
	} catch {
		return [];
	}
	for (const entry of entries) {
		const manifest = join(skillsDir, entry, 'SKILL.md');
		if (!existsSync(manifest)) {
			continue;
		}
		try {
			const meta = parseSkillFrontmatter(readFileSync(manifest, 'utf8'));
			found.push({
				name: meta.name ?? entry,
				description: meta.description ?? '',
				path: manifest,
				origin
			});
		} catch {
			// 読めないものは黙って飛ばす（一覧が壊れる方が困る）
		}
	}
	return found;
}

/**
 * 探索する場所:
 *   - プロジェクト: `<workspace>/.claude/skills`, `<workspace>/.agents/skills`
 *   - ユーザー:     `~/.claude/skills`
 * 同名は「プロジェクトが優先」（近い設定ほど強い、という Claude Code の考え方に合わせる）。
 */
export function discoverSkills(workspaceRoots: readonly string[], home: string = homedir()): Skill[] {
	const all: Skill[] = [];
	for (const root of workspaceRoots) {
		all.push(...scanSkillsDir(join(root, '.claude', 'skills'), 'プロジェクト'));
		all.push(...scanSkillsDir(join(root, '.agents', 'skills'), 'プロジェクト'));
	}
	all.push(...scanSkillsDir(join(home, '.claude', 'skills'), 'ユーザー'));

	const byName = new Map<string, Skill>();
	for (const skill of all) {
		if (!byName.has(skill.name)) {
			byName.set(skill.name, skill);
		}
	}
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 曖昧な聞き方（「PDF を扱えるやつ」）でも拾えるように、語ごとに部分一致で加点する。
 * 完全一致 > 名前の一部 > 説明の一部、の順で効かせる。
 */
export function scoreSkill(skill: Skill, query: string): number {
	const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
	if (words.length === 0) {
		return 0;
	}
	const name = skill.name.toLowerCase();
	const description = skill.description.toLowerCase();
	let score = 0;
	for (const word of words) {
		if (name === word) {
			score += 10;
		} else if (name.includes(word)) {
			score += 5;
		}
		if (description.includes(word)) {
			score += 2;
		}
	}
	return score;
}

export function searchSkills(skills: readonly Skill[], query: string): Skill[] {
	if (query.trim().length === 0) {
		return [...skills];
	}
	return skills
		.map((skill) => ({ skill, score: scoreSkill(skill, query) }))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
		.map((entry) => entry.skill);
}
