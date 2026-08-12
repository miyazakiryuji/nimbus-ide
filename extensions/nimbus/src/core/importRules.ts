/**
 * 他のツールの設定を取り込む（tasks.md T-068）。
 *
 * Cursor や Copilot を使っていた人には、既に**書き溜めた指示**がある。
 * それを書き直させるのは移行の壁でしかないし、書き直す過程で必ず抜ける。
 *
 * 形式はどれも「Markdown で書かれたルール」なので、**出どころを添えて並べれば足りる**。
 * 中身は変換しない — 意味を変えずに移すことだけを引き受ける。
 *
 * VS Code に依存しない。
 */

export interface RuleSource {
	/** ワークスペースからの相対パス */
	path: string;
	text: string;
}

/** 取り込む相手と、その呼び名 */
const KNOWN: { pattern: RegExp; tool: string }[] = [
	{ pattern: /(^|\/)\.cursorrules$/, tool: 'Cursor' },
	{ pattern: /(^|\/)\.cursor\/rules\/.+\.mdc$/, tool: 'Cursor' },
	{ pattern: /(^|\/)\.github\/copilot-instructions\.md$/, tool: 'GitHub Copilot' },
	{ pattern: /(^|\/)\.github\/instructions\/.+\.instructions\.md$/, tool: 'GitHub Copilot' },
	{ pattern: /(^|\/)\.windsurfrules$/, tool: 'Windsurf' },
	{ pattern: /(^|\/)\.aider\.conf\.yml$/, tool: 'Aider' }
];

export function toolOf(path: string): string | undefined {
	return KNOWN.find((entry) => entry.pattern.test(path))?.tool;
}

/** frontmatter（`---` で囲まれた見出し）は落とす。Claude Code は読まない */
export function stripFrontmatter(text: string): string {
	if (!text.startsWith('---')) {
		return text;
	}
	const end = text.indexOf('\n---', 3);
	return end < 0 ? text : text.slice(end + 4).replace(/^\n+/, '');
}

/**
 * CLAUDE.md へ足す文面。
 * **出どころを必ず書く。** どこから来た指示か分からないルールは、消せなくなる。
 */
export function convertToClaudeMd(sources: readonly RuleSource[], today: string): string {
	const usable = sources.filter((source) => stripFrontmatter(source.text).trim().length > 0);
	if (usable.length === 0) {
		return '';
	}
	const parts = [
		'## 他のツールから取り込んだ指示',
		'',
		`（${today} に Nimbus が取り込みました。**中身は変換していません。**`,
		'そのまま使えるか、書き直すか、消すかを判断してください）',
		''
	];
	for (const source of usable) {
		const tool = toolOf(source.path);
		parts.push(`### ${source.path}${tool ? `（${tool}）` : ''}`, '', stripFrontmatter(source.text).trim(), '');
	}
	return parts.join('\n');
}

/** 画面に出す一覧 */
export function describeImport(sources: readonly RuleSource[]): string {
	if (sources.length === 0) {
		return '他のツールの設定は見つかりませんでした（.cursorrules / copilot-instructions.md など）。';
	}
	return [
		`${sources.length} 件の設定が見つかりました`,
		...sources.map((source) => {
			const tool = toolOf(source.path);
			const lines = source.text.split('\n').length;
			return `  ${source.path}${tool ? `（${tool}）` : ''} — ${lines} 行`;
		})
	].join('\n');
}
