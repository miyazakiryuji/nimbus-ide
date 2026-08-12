/**
 * 詰まりやすい場所を見つける（tasks.md T-066 失敗パターンの蓄積）。
 *
 * 同じところで何度も言い直しているなら、そこは**指示が通りにくい場所**。
 * コードが難しいのか、前提が共有されていないのか、名前が紛らわしいのか — 理由は分からないが、
 * 「そこは一度で通らない」という事実だけで、次の頼みかたが変わる。
 *
 * 判定に使うのは記録だけ。**理由は推測しない**（推測を書くと、それが原因だと思われる）。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { PromptSample } from './promptStats';

export interface FrictionSpot {
	/** ファイルパス、または指示の中で繰り返し出てくる語 */
	subject: string;
	/** その語を含む指示のうち、言い直しが起きた数 */
	redone: number;
	total: number;
}

/** 指示の中のファイル名（拡張子つき）を拾う */
export function subjectsIn(text: string): string[] {
	const files = [...text.matchAll(/[\w./-]+\.(?:ts|tsx|js|jsx|dart|md|json|ya?ml)/g)].map((match) => match[0]);
	return [...new Set(files.map((file) => file.split('/').pop() ?? file))];
}

/** これ未満しか出てこない語は、たまたま（傾向として出さない） */
const MIN_OCCURRENCES = 3;

/**
 * 言い直しが集まっている場所を返す。
 *
 * **言い直し率ではなく件数で足切りする。** 1 回中 1 回（100%）を上位に出すと、
 * たまたま 1 度失敗しただけの場所が最上位に来る。
 */
export function findFrictionSpots(samples: readonly PromptSample[], minOccurrences = MIN_OCCURRENCES): FrictionSpot[] {
	const counts = new Map<string, { redone: number; total: number }>();
	for (const sample of samples) {
		for (const subject of subjectsIn(sample.text)) {
			const entry = counts.get(subject) ?? { redone: 0, total: 0 };
			entry.total++;
			if (sample.redone) {
				entry.redone++;
			}
			counts.set(subject, entry);
		}
	}

	return [...counts.entries()]
		.map(([subject, entry]) => ({ subject, ...entry }))
		.filter((spot) => spot.total >= minOccurrences && spot.redone > 0)
		.sort((a, b) => b.redone - a.redone || b.total - a.total || a.subject.localeCompare(b.subject));
}

export function renderFrictionSpots(spots: readonly FrictionSpot[]): string {
	if (spots.length === 0) {
		return [
			'## 詰まりやすい場所',
			'',
			'いまのところ、特定の場所に言い直しが集まってはいません。',
			''
		].join('\n');
	}

	const lines = [
		'## 詰まりやすい場所',
		'',
		'同じところで何度も言い直しています。**理由までは分かりません**が、次に触るときは',
		'前提を先に書く／範囲を狭めて頼む、を試す価値があります。',
		''
	];
	for (const spot of spots.slice(0, 10)) {
		lines.push(`- \`${spot.subject}\` — ${spot.total} 回のうち ${spot.redone} 回`);
	}
	lines.push('');
	return lines.join('\n');
}
