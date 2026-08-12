/**
 * 「自分の環境では動くのに」を潰す（tasks.md T-205 環境差分の検出）。
 *
 * リポジトリは**どの版で動かすつもりか**をどこかに書いている（`.nvmrc`・`engines`・
 * `pubspec.yaml` の sdk 制約など）。それと手元の版がずれていると、
 * **エラーは全然関係ない場所に出る**。突き合わせれば分かることなので、先に見せる。
 *
 * **合っているかどうかだけを言う。** どちらに合わせるべきかは状況による
 * （手元を上げるのか、リポジトリの要求を下げるのか）。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface Requirement {
	/** 何の道具か（`node` / `dart` など） */
	tool: string;
	/** リポジトリが求めている版（生の文字列） */
	expected: string;
	/** どこに書いてあったか */
	source: string;
}

export interface EnvFinding {
	tool: string;
	expected: string;
	actual?: string;
	source: string;
	状態: 'ok' | 'mismatch' | 'missing';
}

/** `v24.18.0` / `24.18.0` → `24.18.0` */
export function normalizeVersion(text: string): string {
	return text.trim().replace(/^v/, '');
}

/** `>=3.4.0 <4.0.0` のような制約から、下限だけを取り出す */
export function lowerBound(constraint: string): string | undefined {
	const match = /(?:>=|\^)?\s*(\d+\.\d+(?:\.\d+)?)/.exec(constraint);
	return match?.[1];
}

/** リポジトリの中の「求めている版」を集める */
export function collectRequirements(files: { path: string; content: string }[]): Requirement[] {
	const requirements: Requirement[] = [];

	for (const file of files) {
		const name = file.path.split('/').pop() ?? file.path;

		if (name === '.nvmrc') {
			requirements.push({ tool: 'node', expected: normalizeVersion(file.content), source: '.nvmrc' });
			continue;
		}
		if (name === 'package.json') {
			try {
				const json = JSON.parse(file.content) as { engines?: Record<string, string> };
				for (const [tool, range] of Object.entries(json.engines ?? {})) {
					const bound = lowerBound(range);
					if (bound) {
						requirements.push({ tool, expected: bound, source: 'package.json の engines' });
					}
				}
			} catch {
				// 読めない package.json は黙って飛ばす（別の問題）
			}
			continue;
		}
		if (name === 'pubspec.yaml') {
			const sdk = /sdk:\s*['"]?([^'"\n]+)/.exec(file.content)?.[1];
			const bound = sdk ? lowerBound(sdk) : undefined;
			if (bound) {
				requirements.push({ tool: 'dart', expected: bound, source: 'pubspec.yaml の sdk' });
			}
			continue;
		}
		if (name === '.tool-versions') {
			for (const line of file.content.split('\n')) {
				const match = /^([a-z0-9_-]+)\s+([\d.]+)/i.exec(line.trim());
				if (match) {
					requirements.push({ tool: match[1], expected: match[2], source: '.tool-versions' });
				}
			}
		}
	}

	return requirements;
}

/** 版を比べる。**メジャーとマイナーまで**見る（パッチ違いで騒がない） */
export function sameEnough(expected: string, actual: string): boolean {
	const [ea, eb] = normalizeVersion(expected).split('.');
	const [aa, ab] = normalizeVersion(actual).split('.');
	return ea === aa && eb === ab;
}

export function compareEnvironment(
	requirements: readonly Requirement[],
	installed: Readonly<Record<string, string | undefined>>
): EnvFinding[] {
	return requirements.map((requirement) => {
		const actual = installed[requirement.tool];
		if (!actual) {
			return { ...requirement, 状態: 'missing' as const };
		}
		return {
			...requirement,
			actual: normalizeVersion(actual),
			状態: sameEnough(requirement.expected, actual) ? ('ok' as const) : ('mismatch' as const)
		};
	});
}

export function renderEnvironment(findings: readonly EnvFinding[]): string {
	if (findings.length === 0) {
		return [
			'# 環境の食い違い',
			'',
			'リポジトリに「どの版で動かすか」の記載が見つかりませんでした。',
			'（`.nvmrc` / `package.json` の `engines` / `pubspec.yaml` の `sdk` / `.tool-versions` を見ています）',
			''
		].join('\n');
	}

	const bad = findings.filter((finding) => finding.状態 !== 'ok');
	const lines = ['# 環境の食い違い', ''];

	for (const finding of findings) {
		const mark = finding.状態 === 'ok' ? '✅' : finding.状態 === 'missing' ? '❔' : '⚠️';
		const actual = finding.状態 === 'missing' ? '見つかりません' : `手元 ${finding.actual}`;
		lines.push(`- ${mark} **${finding.tool}** — 要求 ${finding.expected}（${finding.source}）／${actual}`);
	}
	lines.push('');

	if (bad.length === 0) {
		lines.push('食い違いはありません。');
	} else {
		lines.push(
			`${bad.length} 件ずれています。**どちらに合わせるかは状況によります**`,
			'（手元を上げる／リポジトリの要求を下げる）。エラーが関係ない場所に出ているときは、まずここを疑ってください。'
		);
	}
	lines.push('');
	return lines.join('\n');
}
