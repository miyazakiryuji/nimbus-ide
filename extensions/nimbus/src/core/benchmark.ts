/**
 * 改善前後のベンチ比較（tasks.md T-130）— 実装中（@session-b）。
 * 「速くなった気がする」を数字で確定させる。ばらつきを超えたときだけ「速くなった」と言う。
 */

/** 1 回の計測 */
export interface Measurement {
	label: string;
	value: number;
	unit: string;
}

/** まだ骨格。中央値を返す */
export function median(values: readonly number[]): number {
	if (values.length === 0) {
		return Number.NaN;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
