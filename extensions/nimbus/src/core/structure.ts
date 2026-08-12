/**
 * 手を入れる優先度と、層の逆流を見つける（tasks.md T-136 複雑度 / T-138 アーキテクチャ違反）。
 *
 * どちらも「読めば分かるが、読まないと分からない」もの。エージェントに手を入れさせる前に、
 * **どこが重いか**と**どこが約束を破っているか**を先に見せる。
 *
 * 構文解析はしない。行と括弧の深さだけで見る（言語ごとにパーサを持つと保守できない）。
 * 数字の正確さより、**同じ物差しで比べられること**を優先する。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface FileComplexity {
	path: string;
	/** 分岐の数（if / for / while / case / catch / && / || / ?: ） */
	decisions: number;
	/** いちばん深い入れ子（括弧の深さ） */
	maxNesting: number;
	/** 中身のある行数（空行とコメントを除く） */
	lines: number;
}

export interface LayerRule {
	/** この条件に当てはまるファイルが */
	from: RegExp;
	/** これを取り込んでいたら違反 */
	forbid: RegExp;
	/** なぜ駄目なのかを 1 文で（読んだ人が直せるように） */
	reason: string;
}

export interface LayerViolation {
	path: string;
	imported: string;
	reason: string;
}

const DECISION = /\b(if|for|while|case|catch)\b|&&|\|\||\?\s*[^:\s]/g;

/** 中身のある行か（空行・行コメントを除く） */
function isSubstantial(line: string): boolean {
	const text = line.trim();
	return text.length > 0 && !text.startsWith('//') && !text.startsWith('*') && !text.startsWith('/*');
}

export function measureComplexity(path: string, content: string): FileComplexity {
	let decisions = 0;
	let depth = 0;
	let maxNesting = 0;
	let lines = 0;

	for (const line of content.split('\n')) {
		if (!isSubstantial(line)) {
			continue;
		}
		lines++;
		decisions += (line.match(DECISION) ?? []).length;
		for (const char of line) {
			if (char === '{') {
				depth++;
				maxNesting = Math.max(maxNesting, depth);
			} else if (char === '}') {
				depth = Math.max(0, depth - 1);
			}
		}
	}

	return { path, decisions, maxNesting, lines };
}

/**
 * 重い順に並べる。
 * 分岐の多さを主に、同じなら入れ子の深さで比べる（深いほうが読みにくい）。
 */
export function rankComplexity(files: readonly { path: string; content: string }[], limit = 10): FileComplexity[] {
	return files
		.map((file) => measureComplexity(file.path, file.content))
		.sort((a, b) => b.decisions - a.decisions || b.maxNesting - a.maxNesting || a.path.localeCompare(b.path))
		.slice(0, limit);
}

/**
 * Nimbus 自身の約束。
 *
 * `core/` は VS Code に依存しない — これは「拡張ホストなしで検証できる」という
 * この拡張のテスト戦略そのものなので、破ると単体テストが書けなくなる。
 */
export const NIMBUS_LAYER_RULES: LayerRule[] = [
	{
		from: /(^|\/)core\//,
		forbid: /^vscode$/,
		reason: 'core/ は VS Code に依存しない（依存すると拡張ホストなしで検証できなくなる）'
	}
];

const IMPORT_SOURCE = /(?:^|\n)\s*import\s+[^'"]*from\s*['"]([^'"]+)['"]/g;

/** そのファイルが取り込んでいるモジュール名 */
export function importedModules(content: string): string[] {
	return [...content.matchAll(IMPORT_SOURCE)].map((match) => match[1]);
}

export function findLayerViolations(
	files: readonly { path: string; content: string }[],
	rules: readonly LayerRule[] = NIMBUS_LAYER_RULES
): LayerViolation[] {
	const violations: LayerViolation[] = [];
	for (const file of files) {
		for (const rule of rules) {
			if (!rule.from.test(file.path)) {
				continue;
			}
			for (const imported of importedModules(file.content)) {
				if (rule.forbid.test(imported)) {
					violations.push({ path: file.path, imported, reason: rule.reason });
				}
			}
		}
	}
	return violations.sort((a, b) => a.path.localeCompare(b.path));
}

export function renderStructure(hot: readonly FileComplexity[], violations: readonly LayerViolation[]): string {
	const lines: string[] = [];

	if (violations.length > 0) {
		lines.push('## 層の約束を破っています', '');
		for (const violation of violations) {
			lines.push(`- \`${violation.path}\` が \`${violation.imported}\` を取り込んでいます — ${violation.reason}`);
		}
		lines.push('');
	}

	if (hot.length > 0) {
		lines.push('## 重いところ（手を入れる優先度）', '');
		for (const file of hot) {
			lines.push(`- \`${file.path}\` — 分岐 ${file.decisions} / 入れ子 ${file.maxNesting} / ${file.lines} 行`);
		}
		lines.push('', '数字は同じ物差しで比べるためのもので、良し悪しの判定ではありません。');
		lines.push('');
	}

	return lines.join('\n');
}
