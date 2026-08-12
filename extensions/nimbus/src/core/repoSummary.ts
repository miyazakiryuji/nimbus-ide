/**
 * リポジトリの構造要約カード（tasks.md T-176）。
 *
 * 開いた瞬間に「何のプロジェクトで、どこに何があるか」が 1 枚で分かること。
 * 人にとっては新しいリポジトリに入るときの地図で、**エージェントにとっては探索の節約**になる。
 * 最初の数ターンを「まず構造を調べる」に使わせないための材料。
 *
 * VS Code に依存しない。集めた事実を読める形にするところだけを置く。
 */

export interface RepoFacts {
	/** リポジトリ名（フォルダ名か manifest の name） */
	name: string;
	description?: string;
	/** 見つかった manifest（`package.json` など）。何のプロジェクトかの決め手 */
	manifests: string[];
	/** 上位ディレクトリと、その中のファイル数（多い順に並べて渡す） */
	directories: { name: string; files: number }[];
	/** 拡張子ごとのファイル数（多い順） */
	languages: { extension: string; files: number }[];
	branch?: string;
	lastCommit?: string;
	/** 見つかった CLAUDE.md の数 */
	claudeMd: number;
}

/** manifest から「何で書かれたプロジェクトか」を当てる */
const PROJECT_KINDS: { manifest: string; kind: string }[] = [
	{ manifest: 'pubspec.yaml', kind: 'Flutter / Dart' },
	{ manifest: 'package.json', kind: 'Node.js / TypeScript' },
	{ manifest: 'go.mod', kind: 'Go' },
	{ manifest: 'Cargo.toml', kind: 'Rust' },
	{ manifest: 'pyproject.toml', kind: 'Python' },
	{ manifest: 'requirements.txt', kind: 'Python' },
	{ manifest: 'Package.swift', kind: 'Swift' },
	{ manifest: 'build.gradle', kind: 'Gradle / JVM' },
	{ manifest: 'build.gradle.kts', kind: 'Gradle / Kotlin' },
	{ manifest: 'pom.xml', kind: 'Maven / Java' },
	{ manifest: 'Gemfile', kind: 'Ruby' },
	{ manifest: 'composer.json', kind: 'PHP' }
];

export function projectKinds(manifests: readonly string[]): string[] {
	const kinds: string[] = [];
	for (const { manifest, kind } of PROJECT_KINDS) {
		if (manifests.includes(manifest) && !kinds.includes(kind)) {
			kinds.push(kind);
		}
	}
	return kinds;
}

/** 上位ディレクトリの並び。ファイル数の多い順で、同数なら名前順 */
export function rankDirectories(
	directories: readonly { name: string; files: number }[],
	limit = 12
): { name: string; files: number }[] {
	return [...directories]
		.filter((entry) => entry.files > 0)
		.sort((a, b) => b.files - a.files || a.name.localeCompare(b.name))
		.slice(0, Math.max(1, limit));
}

/**
 * カードの本文（Markdown）。
 * **数えた事実しか書かない。** 「たぶんこういう設計」の推測を混ぜると、
 * それを前提に読まれてしまう。
 */
export function renderRepoSummary(facts: RepoFacts): string {
	const kinds = projectKinds(facts.manifests);
	const lines = [`# ${facts.name}`, ''];
	if (facts.description) {
		lines.push(facts.description, '');
	}

	lines.push('| | |', '| --- | --- |');
	if (kinds.length > 0) {
		lines.push(`| 種類 | ${kinds.join(' / ')} |`);
	}
	if (facts.manifests.length > 0) {
		lines.push(`| 設定ファイル | ${facts.manifests.map((name) => `\`${name}\``).join(', ')} |`);
	}
	if (facts.branch) {
		lines.push(`| ブランチ | ${facts.branch} |`);
	}
	if (facts.lastCommit) {
		lines.push(`| 最後のコミット | ${facts.lastCommit} |`);
	}
	lines.push(`| CLAUDE.md | ${facts.claudeMd > 0 ? `${facts.claudeMd} 個` : 'なし'} |`);
	lines.push('');

	if (facts.directories.length > 0) {
		lines.push('## どこに何があるか', '');
		for (const entry of facts.directories) {
			lines.push(`- \`${entry.name}/\` — ${entry.files} ファイル`);
		}
		lines.push('');
	}

	if (facts.languages.length > 0) {
		lines.push('## 使われている言語', '');
		lines.push(facts.languages.map((entry) => `${entry.extension} ${entry.files}`).join(' · '), '');
	}

	lines.push('---', '', '数えた事実だけを並べています（設計の推測は含みません）。');
	return lines.join('\n');
}

/** セッションへ渡す文。カードをそのまま渡し、探索の代わりにする */
export function buildRepoSummaryPrompt(facts: RepoFacts): string {
	return [
		'このリポジトリの構造です。**まず構造を調べる往復を省くために渡します。**',
		'',
		renderRepoSummary(facts),
		'',
		'この地図を前提に進めてください。足りない部分だけを読みに行ってください。'
	].join('\n');
}
