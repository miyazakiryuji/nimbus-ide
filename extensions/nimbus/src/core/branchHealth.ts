/**
 * 作業ブランチの離れ具合を見る（tasks.md T-134 乖離監視 / T-219 命名規則）。
 *
 * 長く置いたブランチは、いつか必ず衝突する。**衝突してから知る**のがいちばん高くつくので、
 * 「どれだけ離れたか」と「両側で同じファイルを触っているか」を先に見せる。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface Divergence {
	/** 分岐元から見て、こちらが進んでいるコミット数 */
	ahead: number;
	/** 分岐元が進んでいるコミット数 */
	behind: number;
	/** 両側で触られているファイル（衝突する可能性が高い） */
	overlapping: string[];
}

export type DivergenceLevel = 'ok' | 'watch' | 'risky';

/** `git rev-list --left-right --count base...HEAD` の出力（`<behind>\t<ahead>`） */
export function parseAheadBehind(text: string): { ahead: number; behind: number } {
	const match = /(\d+)\s+(\d+)/.exec(text.trim());
	if (!match) {
		return { ahead: 0, behind: 0 };
	}
	return { behind: Number(match[1]), ahead: Number(match[2]) };
}

/** 両側で触られているファイル。順序は落とさず、重複だけ畳む */
export function overlappingFiles(ours: readonly string[], theirs: readonly string[]): string[] {
	const theirSet = new Set(theirs);
	return [...new Set(ours.filter((file) => theirSet.has(file)))];
}

/**
 * どれくらい危ないか。
 *
 * **同じファイルを両側で触っていれば、離れ具合に関わらず危ない**（それが衝突の実体）。
 * 触っていなければ、離れているだけなら取り込めば済む。
 */
export function assessDivergence({ behind, overlapping }: Divergence): DivergenceLevel {
	if (overlapping.length > 0) {
		return 'risky';
	}
	if (behind >= 20) {
		return 'watch';
	}
	return 'ok';
}

export interface NamingRule {
	pattern: RegExp;
	description: string;
}

/** 既定の規則。このリポジトリの作業ブランチは `nimbus` か `nimbus/<話題>` */
export const DEFAULT_BRANCH_RULES: NamingRule[] = [
	{ pattern: /^(main|nimbus)$/, description: '主要ブランチ（main / nimbus）' },
	{ pattern: /^nimbus\/[a-z0-9][\w.-]*$/i, description: '作業ブランチ（nimbus/<話題>）' }
];

export function checkBranchName(name: string, rules: readonly NamingRule[] = DEFAULT_BRANCH_RULES): boolean {
	return rules.some((rule) => rule.pattern.test(name));
}

export function renderBranchHealth(
	branch: string,
	base: string,
	divergence: Divergence,
	rules: readonly NamingRule[] = DEFAULT_BRANCH_RULES
): string {
	const level = assessDivergence(divergence);
	const lines = ['# ブランチのようす', '', `- ブランチ: \`${branch}\` / 比べた先: \`${base}\``];

	lines.push(`- 進んでいる: **${divergence.ahead}** / 取り込めていない: **${divergence.behind}**`, '');

	if (level === 'risky') {
		lines.push(
			'## 衝突しそうです',
			'',
			'**両側で同じファイルが変わっています。** 早めに取り込んでください（`git pull --rebase`）。',
			'離れるほど、後から解くのは難しくなります。',
			''
		);
		for (const file of divergence.overlapping.slice(0, 20)) {
			lines.push(`- \`${file}\``);
		}
		if (divergence.overlapping.length > 20) {
			lines.push(`- …ほか ${divergence.overlapping.length - 20} 件`);
		}
		lines.push('');
	} else if (level === 'watch') {
		lines.push(
			'## 少し離れています',
			'',
			`\`${base}\` が ${divergence.behind} コミット進んでいます。同じファイルは触っていないので、`,
			'いま取り込めば静かに済みます。',
			''
		);
	} else {
		lines.push('離れ具合は問題ありません。', '');
	}

	if (!checkBranchName(branch, rules)) {
		lines.push(
			'## ブランチ名が規則に合っていません',
			'',
			`\`${branch}\` は次のどれにも当てはまりません:`,
			'',
			...rules.map((rule) => `- ${rule.description}`),
			''
		);
	}

	return lines.join('\n');
}
