/**
 * 脆弱性の警告を、直す順番に変える（tasks.md T-121）。
 *
 * `npm audit` は**全部まとめて出る**ので、どれから手を付けるかが分からない。
 * しかも `--force` を打つと、破壊的変更ごと当たって別のものが壊れる。
 *
 * ここでは「**そのまま上げられるもの**」と「**破壊的変更を含むもの**」を分ける。
 * 前者は今すぐやればいいし、後者は時間を取る必要がある — その区別だけで動き出せる。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export type Severity = 'critical' | 'high' | 'moderate' | 'low' | 'info';

export interface Advisory {
	name: string;
	severity: Severity;
	/** 直すのに必要な版（分かるとき） */
	fixVersion?: string;
	/** いま入っている版 */
	current?: string;
	/** 直すと破壊的変更が入るか（`npm audit` が言ってくる） */
	breaking: boolean;
	title?: string;
}

export interface FixPlan {
	/** そのまま上げられるもの */
	safe: Advisory[];
	/** 破壊的変更を含むもの */
	breaking: Advisory[];
	/** 直し方が示されていないもの */
	unresolved: Advisory[];
}

const ORDER: Record<Severity, number> = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };

/** `npm audit --json` の中身を読む。形が変わっても落ちないよう、緩く読む */
export function parseAudit(json: string): Advisory[] {
	let data: { vulnerabilities?: Record<string, unknown> };
	try {
		data = JSON.parse(json) as { vulnerabilities?: Record<string, unknown> };
	} catch {
		return [];
	}

	const advisories: Advisory[] = [];
	for (const [name, raw] of Object.entries(data.vulnerabilities ?? {})) {
		if (typeof raw !== 'object' || raw === null) {
			continue;
		}
		const entry = raw as {
			severity?: string;
			fixAvailable?: boolean | { version?: string; isSemVerMajor?: boolean };
			via?: unknown[];
			range?: string;
		};
		const fix = entry.fixAvailable;
		const title = Array.isArray(entry.via)
			? (entry.via.find((item) => typeof item === 'object' && item !== null) as { title?: string } | undefined)?.title
			: undefined;

		advisories.push({
			name,
			severity: (['critical', 'high', 'moderate', 'low', 'info'] as Severity[]).includes(entry.severity as Severity)
				? (entry.severity as Severity)
				: 'info',
			fixVersion: typeof fix === 'object' && fix !== null ? fix.version : undefined,
			current: entry.range,
			breaking: typeof fix === 'object' && fix !== null ? fix.isSemVerMajor === true : false,
			title
		});
	}
	return advisories;
}

/**
 * 直す順番に分ける。
 *
 * **深刻さより先に「そのまま上げられるか」で分ける。** 深刻な脆弱性でも、破壊的変更が
 * 必要なら今日は直せない。今日できることを先に見せたほうが、実際に減る。
 */
export function planFixes(advisories: readonly Advisory[]): FixPlan {
	const bySeverity = (a: Advisory, b: Advisory): number => ORDER[a.severity] - ORDER[b.severity] || a.name.localeCompare(b.name);
	return {
		safe: advisories.filter((advisory) => advisory.fixVersion && !advisory.breaking).sort(bySeverity),
		breaking: advisories.filter((advisory) => advisory.fixVersion && advisory.breaking).sort(bySeverity),
		unresolved: advisories.filter((advisory) => !advisory.fixVersion).sort(bySeverity)
	};
}

const SEVERITY_LABEL: Record<Severity, string> = {
	critical: '致命的',
	high: '高',
	moderate: '中',
	low: '低',
	info: '情報'
};

function line(advisory: Advisory): string {
	const to = advisory.fixVersion ? ` → \`${advisory.fixVersion}\`` : '';
	const title = advisory.title ? ` — ${advisory.title}` : '';
	return `- **${advisory.name}**（${SEVERITY_LABEL[advisory.severity]}）${to}${title}`;
}

export function renderFixPlan(plan: FixPlan): string {
	const total = plan.safe.length + plan.breaking.length + plan.unresolved.length;
	if (total === 0) {
		return '# 脆弱性の警告\n\n警告はありませんでした。\n';
	}

	const lines = ['# 脆弱性の警告', '', `${total} 件。**今日できるものから並べています。**`, ''];

	if (plan.safe.length > 0) {
		lines.push(
			`## そのまま上げられる（${plan.safe.length}）`,
			'',
			'破壊的変更は入りません。`npm audit fix` で当たります。',
			''
		);
		lines.push(...plan.safe.map(line), '');
	}

	if (plan.breaking.length > 0) {
		lines.push(
			`## 破壊的変更を含む（${plan.breaking.length}）`,
			'',
			'**`npm audit fix --force` は使わないでください。** 何が壊れるか分からないまま当たります。',
			'1 つずつ、変更履歴を見てから上げます。テストが通ることを確かめながら進めてください。',
			''
		);
		lines.push(...plan.breaking.map(line), '');
	}

	if (plan.unresolved.length > 0) {
		lines.push(
			`## 直し方が示されていない（${plan.unresolved.length}）`,
			'',
			'上流がまだ直していないものです。使うのをやめるか、待つかの判断が要ります。',
			''
		);
		lines.push(...plan.unresolved.map(line), '');
	}

	return lines.join('\n');
}
