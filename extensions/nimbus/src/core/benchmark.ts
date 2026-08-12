/**
 * 改善前後のベンチ比較（tasks.md T-130）。
 *
 * 「速くなった気がする」を数字で確定させる。ただし数字を出すだけでは足りない —
 * **1 回ずつ測って 3% 速くなったと言うのは、測っていないのとほぼ同じ**。
 * 計測はばらつくので、**ばらつきを超えた差だけを「速くなった」と言う**。
 *
 * この判断を厳しくしておかないと、この機能は「改善したことにする道具」になる。
 * 証跡つき完了報告（T-081）と同じ考えかたで、**言い切れないときは言い切らない**。
 *
 * VS Code に依存しないので単体で検証できる。
 */

/** 1 回の計測 */
export interface Measurement {
	label: string;
	value: number;
	unit: string;
}

/** 数字が小さいほど良いのか、大きいほど良いのか */
export type Direction = 'lower-is-better' | 'higher-is-better';

export interface Comparison {
	label: string;
	unit: string;
	direction: Direction;
	beforeMedian: number;
	afterMedian: number;
	/** 変化率（%）。lower-is-better なら「減った率」が正 */
	changePercent: number;
	/** ばらつきを超えた差か。false なら「差があるとは言えない」 */
	significant: boolean;
	verdict: 'faster' | 'slower' | 'unclear';
	beforeSamples: number;
	afterSamples: number;
}

export function median(values: readonly number[]): number {
	if (values.length === 0) {
		return Number.NaN;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** 中央値からの散らばり。標準偏差より外れ値に強い */
export function spread(values: readonly number[]): number {
	if (values.length === 0) {
		return Number.NaN;
	}
	const center = median(values);
	return median(values.map((value) => Math.abs(value - center)));
}

/** 大きいほど良い単位。ここに無いものは「小さいほど良い」とみなす（時間が大半なので） */
const HIGHER_IS_BETTER = /^(ops\/s(ec)?|fps|qps|rps|req\/s|mb\/s|gb\/s)$/i;

export function directionOf(unit: string): Direction {
	return HIGHER_IS_BETTER.test(unit.trim()) ? 'higher-is-better' : 'lower-is-better';
}

/**
 * 計測結果らしい行を拾う。`名前: 123.4 ms` の形を広めに読む。
 *
 * **読めない行は黙って飛ばす。**無理に数字を拾うと、関係ない数（件数やバージョン）を
 * 計測値として比べてしまう。
 */
export function parseMeasurements(text: string): Measurement[] {
	const found: Measurement[] = [];
	for (const line of text.split('\n')) {
		// `ラベル: 12.3 ms` / `ラベル  12.3ms` / `ラベル = 12.3 ops/sec`
		const match = /^\s*(.+?)\s*[:=]?\s{1,}([\d.]+)\s*(ms|s|us|µs|ns|ops\/sec|ops\/s|fps|qps|rps|req\/s|MB\/s|GB\/s)\b/i.exec(
			line
		);
		if (!match) {
			continue;
		}
		const value = Number(match[2]);
		if (!Number.isFinite(value)) {
			continue;
		}
		const label = match[1].replace(/[\s:=]+$/, '').trim();
		if (!label) {
			continue;
		}
		found.push({ label, value, unit: match[3] });
	}
	return found;
}

/** ばらつきに対して、差がどれくらい大きいか。これが小さければ「差があるとは言えない」 */
const SIGNIFICANCE_FACTOR = 2;
/** ばらつきがほぼ 0 のときに使う最小の閾値（%）。完全に同じ値でも測定誤差はある */
const MIN_CHANGE_PERCENT = 1;

/**
 * 前後を比べる。
 *
 * **ばらつき（中央絶対偏差）の 2 倍を超えた差だけを「速くなった／遅くなった」と言う。**
 * 超えなければ `unclear` で、「差があるとは言えない」と伝える。
 * サンプルが 1 つずつしか無いときは、ばらつきが測れないので必ず `unclear`。
 */
export function compare(
	label: string,
	unit: string,
	before: readonly number[],
	after: readonly number[]
): Comparison | undefined {
	if (before.length === 0 || after.length === 0) {
		return undefined;
	}
	const direction = directionOf(unit);
	const beforeMedian = median(before);
	const afterMedian = median(after);
	const raw = beforeMedian === 0 ? 0 : ((afterMedian - beforeMedian) / beforeMedian) * 100;
	// lower-is-better では「減った」を正にする（読む人は「何 % 速くなった？」で考える）
	const changePercent = direction === 'lower-is-better' ? -raw : raw;

	const noise = Math.max(spread(before), spread(after));
	const difference = Math.abs(afterMedian - beforeMedian);
	// 1 つずつしか測っていなければ、ばらつきが分からない＝言い切れない
	const enoughSamples = before.length > 1 && after.length > 1;
	const significant =
		enoughSamples && difference > noise * SIGNIFICANCE_FACTOR && Math.abs(changePercent) >= MIN_CHANGE_PERCENT;

	return {
		label,
		unit,
		direction,
		beforeMedian,
		afterMedian,
		changePercent,
		significant,
		verdict: !significant ? 'unclear' : changePercent > 0 ? 'faster' : 'slower',
		beforeSamples: before.length,
		afterSamples: after.length
	};
}

/** 同じラベルどうしを突き合わせる */
export function compareAll(
	before: readonly Measurement[],
	after: readonly Measurement[]
): Comparison[] {
	const group = (items: readonly Measurement[]): Map<string, Measurement[]> => {
		const map = new Map<string, Measurement[]>();
		for (const item of items) {
			map.set(item.label, [...(map.get(item.label) ?? []), item]);
		}
		return map;
	};
	const beforeByLabel = group(before);
	const afterByLabel = group(after);
	const comparisons: Comparison[] = [];
	for (const [label, beforeItems] of beforeByLabel) {
		const afterItems = afterByLabel.get(label);
		if (!afterItems) {
			continue;
		}
		const result = compare(
			label,
			beforeItems[0].unit,
			beforeItems.map((m) => m.value),
			afterItems.map((m) => m.value)
		);
		if (result) {
			comparisons.push(result);
		}
	}
	// 効果の大きい順。ただし言い切れないものは後ろへ
	return comparisons.sort(
		(a, b) =>
			Number(b.significant) - Number(a.significant) || Math.abs(b.changePercent) - Math.abs(a.changePercent)
	);
}

function sign(value: number): string {
	return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

export function formatComparison(comparisons: readonly Comparison[]): string {
	if (comparisons.length === 0) {
		return [
			'# ベンチの比較',
			'',
			'前後で**同じ名前の計測**が見つかりませんでした。',
			'',
			'> `名前: 12.3 ms` のような行を読んでいます。名前が前後で一致している必要があります。',
			''
		].join('\n');
	}
	const decided = comparisons.filter((c) => c.significant);
	const unclear = comparisons.filter((c) => !c.significant);

	const lines = [
		'# ベンチの比較',
		'',
		`${comparisons.length} 件を比べました。`,
		'',
		'> **ばらつきを超えた差だけを「速くなった」と言います。**',
		'> 1 回ずつしか測っていない項目は、ばらつきが分からないので必ず「判断できない」になります。',
		''
	];

	if (decided.length > 0) {
		lines.push('## 差があると言えるもの', '');
		for (const c of decided) {
			const word = c.verdict === 'faster' ? '速くなった' : '遅くなった';
			lines.push(
				`- **${c.label}** — ${word} ${sign(c.changePercent)}`
				+ `（${c.beforeMedian} → ${c.afterMedian} ${c.unit} / ${c.beforeSamples} 回 vs ${c.afterSamples} 回）`
			);
		}
		lines.push('');
	}
	if (unclear.length > 0) {
		lines.push('## 差があるとは言えないもの', '', 'ばらつきの範囲に収まっています。**改善したことにしないでください。**', '');
		for (const c of unclear) {
			lines.push(
				`- ${c.label} — ${sign(c.changePercent)}`
				+ `（${c.beforeMedian} → ${c.afterMedian} ${c.unit} / ${c.beforeSamples} 回 vs ${c.afterSamples} 回）`
			);
		}
		lines.push('', '**回数を増やして測り直す**と、はっきりすることがあります。', '');
	}
	return lines.join('\n');
}
