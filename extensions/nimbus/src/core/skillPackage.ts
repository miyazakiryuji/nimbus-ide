/**
 * 自分のスキルを、人が入れられる形にする（tasks.md T-070）。
 *
 * 良いスキルを書いても、渡す手段が「このフォルダをコピーして」しかない。
 * Claude Code には**マーケットプレイス**の仕組みがあり、GitHub のリポジトリを
 * そのまま配布元にできる — 足りないのは、その形に整えるところだけ。
 *
 * ここでやるのは**形を作ることだけ**。置くのは人（GitHub に push するかどうかは、
 * 機械が決めてよいことではない）。
 *
 * ## 配らないもの
 *
 * **他人のプラグインから来たスキルは入れない。** 手元にあるからといって、
 * 自分の名前で配ってよいわけではない。入れるのは**このワークスペースで書いたもの**だけ。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { Skill } from './skills';

export interface PluginEntry {
	name: string;
	source: string;
	description: string;
}

export interface PackagePlan {
	/** `.claude-plugin/marketplace.json` に書く中身 */
	marketplace: { name: string; owner?: { name: string }; plugins: PluginEntry[] };
	/** どのフォルダを、どこへ写すか */
	files: { from: string; to: string }[];
	/** 入れなかったもの。**理由つきで返す**（黙って減らさない） */
	skipped: { name: string; reason: string }[];
	/** 入れたが、出す前に見たほうがよいもの */
	warnings: { name: string; reason: string }[];
}

export interface PackageOptions {
	/** マーケットプレイスの名前（リポジトリ名） */
	name: string;
	owner?: string;
	/** スキルの中身を読む。秘密が混ざっていないかを見るために使う */
	readSkill?: (skill: Skill) => string;
	/** 秘密らしきものを探す。`shareSession` の `inspectRedactions` をそのまま渡す */
	inspect?: (text: string) => { count: number; kinds: readonly string[] };
}

/**
 * 配ってよい出どころか。
 *
 * **自分で書いたものだけ**（`discoverSkills` の「プロジェクト」と「ユーザー」）。
 * プラグイン由来のものは、手元にあっても自分の名前で配ってよいものではない。
 */
const OWN_ORIGINS = new Set(['プロジェクト', 'ユーザー']);

export function isOwnSkill(skill: Skill): boolean {
	return OWN_ORIGINS.has(skill.origin);
}

/**
 * 配る形を組み立てる。
 *
 * **説明の無いスキルは入れない。** 一覧に名前だけ並んでも、入れる側は選べない。
 */
export function planPackage(skills: readonly Skill[], options: PackageOptions): PackagePlan {
	const plugins: PluginEntry[] = [];
	const files: { from: string; to: string }[] = [];
	const skipped: { name: string; reason: string }[] = [];
	const warnings: { name: string; reason: string }[] = [];

	for (const skill of skills) {
		if (!isOwnSkill(skill)) {
			skipped.push({ name: skill.name, reason: `${skill.origin} から来たものなので、自分では配りません` });
			continue;
		}
		if (!skill.description || skill.description.trim().length === 0) {
			skipped.push({ name: skill.name, reason: '説明がありません（入れる側が選べません）' });
			continue;
		}

		if (options.readSkill && options.inspect) {
			const found = options.inspect(options.readSkill(skill));
			if (found.count > 0) {
				warnings.push({
					name: skill.name,
					reason: `${found.kinds.join('・')} が入っています（${found.count} 箇所）。出す前に見てください`
				});
			}
		}

		plugins.push({ name: skill.name, source: `./${skill.name}`, description: skill.description.trim() });
		files.push({ from: skill.path.replace(/\/SKILL\.md$/, ''), to: `${skill.name}/skills/${skill.name}` });
	}

	return {
		marketplace: {
			name: options.name,
			owner: options.owner ? { name: options.owner } : undefined,
			plugins
		},
		files,
		skipped,
		warnings
	};
}

export function renderMarketplaceJson(plan: PackagePlan): string {
	return JSON.stringify(plan.marketplace, undefined, 2) + '\n';
}

/** 入れかたを、そのまま打てる形で書く */
export function renderReadme(plan: PackagePlan, repository?: string): string {
	const source = repository ?? '<owner>/<repo>';
	const lines = [
		`# ${plan.marketplace.name}`,
		'',
		`スキルを ${plan.marketplace.plugins.length} 個入れています。`,
		'',
		'## 入れかた',
		'',
		'```',
		`/plugin marketplace add ${source}`,
		`/plugin install <名前>@${plan.marketplace.name}`,
		'```',
		'',
		'## 入っているもの',
		''
	];
	for (const plugin of plan.marketplace.plugins) {
		lines.push(`- **${plugin.name}** — ${plugin.description}`);
	}
	lines.push('', '入れたスキルは、次に始めるセッションから使えます。', '');
	return lines.join('\n');
}

/** 作る前に、何が入って何が入らないかを見せる */
export function describePlan(plan: PackagePlan): string {
	const lines = [`${plan.marketplace.plugins.length} 個を入れます。`];
	if (plan.warnings.length > 0) {
		lines.push('', '**出す前に見るもの**');
		for (const warning of plan.warnings) {
			lines.push(`- ${warning.name} — ${warning.reason}`);
		}
	}
	if (plan.skipped.length > 0) {
		lines.push('', '**入れないもの**');
		for (const skip of plan.skipped) {
			lines.push(`- ${skip.name} — ${skip.reason}`);
		}
	}
	return lines.join('\n');
}
