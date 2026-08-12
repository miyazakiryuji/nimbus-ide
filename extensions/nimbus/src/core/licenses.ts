/**
 * 依存のライセンスを見る（tasks.md T-076）。
 *
 * 配る物に何が混ざっているかは、**配ったあとでは直せない**。とくに強いコピーレフトは、
 * 気づかずに入れると製品ごと条件が変わる。エージェントが依存を足す機会が増えるほど、
 * ここを見る回数は増える。
 *
 * **合法かどうかは判定しない。** ライセンスの解釈は人（必要なら弁護士）の仕事で、
 * ここは「何が入っているか」を並べるだけ。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export type LicenseClass = 'permissive' | 'weak-copyleft' | 'strong-copyleft' | 'unknown';

export interface PackageLicense {
	name: string;
	license: string;
	klass: LicenseClass;
}

const STRONG = /\b(A?GPL-?3|AGPL|GPL-?2|SSPL|OSL)\b/i;
const WEAK = /\b(LGPL|MPL|EPL|CDDL|CC-BY-SA)\b/i;
const PERMISSIVE = /\b(MIT|ISC|Apache-?2|BSD-?[23]|Unlicense|CC0|0BSD|Zlib|Python-?2|BlueOak)\b/i;

/**
 * 分類する。
 * **迷ったら `unknown`。** permissive に倒すと「確認しなくていい」と読まれてしまう。
 */
export function classifyLicense(license: string | undefined): LicenseClass {
	if (!license || license.trim().length === 0) {
		return 'unknown';
	}
	// `(MIT OR Apache-2.0)` のような表記は、片方でも強いコピーレフトなら強い方に寄せない
	// （選べるなら緩い方を選べるため）
	if (PERMISSIVE.test(license)) {
		return 'permissive';
	}
	if (STRONG.test(license)) {
		return 'strong-copyleft';
	}
	if (WEAK.test(license)) {
		return 'weak-copyleft';
	}
	return 'unknown';
}

export function classifyAll(packages: readonly { name: string; license?: string }[]): PackageLicense[] {
	return packages
		.map((entry) => ({
			name: entry.name,
			license: entry.license?.trim() || '（記載なし）',
			klass: classifyLicense(entry.license)
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export interface LicenseSummary {
	counts: Record<LicenseClass, number>;
	/** 見ておいたほうがいいもの（強いコピーレフトと、分からないもの） */
	flagged: PackageLicense[];
}

export function summarizeLicenses(packages: readonly PackageLicense[]): LicenseSummary {
	const counts: Record<LicenseClass, number> = {
		permissive: 0,
		'weak-copyleft': 0,
		'strong-copyleft': 0,
		unknown: 0
	};
	for (const entry of packages) {
		counts[entry.klass]++;
	}
	const order: Record<LicenseClass, number> = {
		'strong-copyleft': 0,
		unknown: 1,
		'weak-copyleft': 2,
		permissive: 3
	};
	return {
		counts,
		flagged: packages
			.filter((entry) => entry.klass === 'strong-copyleft' || entry.klass === 'unknown')
			.sort((a, b) => order[a.klass] - order[b.klass] || a.name.localeCompare(b.name))
	};
}

const CLASS_LABEL: Record<LicenseClass, string> = {
	permissive: '緩い（MIT / Apache など）',
	'weak-copyleft': '弱いコピーレフト（LGPL / MPL など）',
	'strong-copyleft': '強いコピーレフト（GPL / AGPL など）',
	unknown: '分からない'
};

export function renderLicenses(packages: readonly PackageLicense[], summary: LicenseSummary): string {
	if (packages.length === 0) {
		return '# 依存のライセンス\n\n見つかりませんでした。\n';
	}

	const lines = ['# 依存のライセンス', '', `${packages.length} 個を見ました。`, ''];
	for (const klass of ['permissive', 'weak-copyleft', 'strong-copyleft', 'unknown'] as LicenseClass[]) {
		lines.push(`- ${CLASS_LABEL[klass]}: **${summary.counts[klass]}**`);
	}
	lines.push('');

	if (summary.flagged.length > 0) {
		lines.push('## 見ておいたほうがいいもの', '');
		for (const entry of summary.flagged.slice(0, 40)) {
			lines.push(`- \`${entry.name}\` — ${entry.license}（${CLASS_LABEL[entry.klass]}）`);
		}
		if (summary.flagged.length > 40) {
			lines.push(`- …ほか ${summary.flagged.length - 40} 件`);
		}
		lines.push('');
	} else {
		lines.push('強いコピーレフトも、分からないものもありませんでした。', '');
	}

	lines.push(
		'---',
		'',
		'**合法かどうかは判定していません。** ライセンスの解釈は人の仕事で、ここは何が入っているかを',
		'並べているだけです。配る物に混ざっていて困るものが無いか、目で確かめてください。',
		''
	);
	return lines.join('\n');
}
