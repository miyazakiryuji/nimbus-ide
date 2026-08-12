/**
 * ビルド時間とアプリの大きさの変化を見る
 * （tasks.md T-217 ビルド時間の悪化検知 / T-129 バンドルサイズの差分）。
 *
 * どちらも**少しずつ悪くなる**ので、その日その日では気づけない。前回と比べて初めて分かる。
 * ここでは記録と比較だけを持ち、計測そのものは呼び出し側（実際にビルドする側）に任せる。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface BuildRecord {
	/** 記録した時刻（epoch ミリ秒） */
	at: number;
	/** かかった秒数 */
	seconds: number;
	/** 成果物の大きさ（バイト）。取れたときだけ */
	bytes?: number;
	/** そのときのコミット（短縮ハッシュ）。取れたときだけ */
	commit?: string;
}

export interface Comparison {
	current: BuildRecord;
	previous?: BuildRecord;
	/** 秒数の変化率（1.2 なら 20% 遅い）。前回が無ければ undefined */
	timeRatio?: number;
	/** 大きさの変化（バイト） */
	byteDelta?: number;
	level: 'ok' | 'watch' | 'worse';
}

/** これ以上遅くなったら知らせる（誤差で騒がない幅を取る） */
const SLOWER = 1.25;
const MUCH_SLOWER = 1.5;

/** これ以上大きくなったら知らせる（1MB） */
const BIGGER_BYTES = 1024 * 1024;

export function compare(current: BuildRecord, history: readonly BuildRecord[]): Comparison {
	// 直近のものと比べる。平均を取ると、悪化が薄まって見えなくなる
	const previous = [...history].sort((a, b) => b.at - a.at)[0];
	if (!previous) {
		return { current, level: 'ok' };
	}

	const timeRatio = previous.seconds > 0 ? current.seconds / previous.seconds : undefined;
	const byteDelta =
		current.bytes !== undefined && previous.bytes !== undefined ? current.bytes - previous.bytes : undefined;

	let level: Comparison['level'] = 'ok';
	if ((timeRatio !== undefined && timeRatio >= MUCH_SLOWER) || (byteDelta !== undefined && byteDelta >= BIGGER_BYTES * 5)) {
		level = 'worse';
	} else if ((timeRatio !== undefined && timeRatio >= SLOWER) || (byteDelta !== undefined && byteDelta >= BIGGER_BYTES)) {
		level = 'watch';
	}

	return { current, previous, timeRatio, byteDelta, level };
}

/** 人が読む大きさに直す */
export function formatBytes(bytes: number): string {
	const sign = bytes < 0 ? '-' : '';
	const size = Math.abs(bytes);
	if (size >= 1024 * 1024) {
		return `${sign}${(size / 1024 / 1024).toFixed(1)}MB`;
	}
	if (size >= 1024) {
		return `${sign}${Math.round(size / 1024)}KB`;
	}
	return `${sign}${size}B`;
}

/** 記録は増え続けるので、古いものから落とす */
export function trimHistory(history: readonly BuildRecord[], keep = 50): BuildRecord[] {
	return [...history].sort((a, b) => b.at - a.at).slice(0, keep);
}

export function renderComparison(comparison: Comparison): string {
	const { current, previous, timeRatio, byteDelta, level } = comparison;
	const lines = ['# ビルドのようす', '', `- かかった時間: **${current.seconds.toFixed(1)} 秒**`];

	if (current.bytes !== undefined) {
		lines.push(`- 成果物: **${formatBytes(current.bytes)}**`);
	}
	if (!previous) {
		lines.push('', 'これが最初の記録です。次から前回と比べられます。');
		return lines.join('\n') + '\n';
	}

	lines.push(`- 前回: ${previous.seconds.toFixed(1)} 秒${previous.bytes !== undefined ? ` / ${formatBytes(previous.bytes)}` : ''}`, '');

	if (timeRatio !== undefined) {
		const percent = Math.round((timeRatio - 1) * 100);
		lines.push(percent >= 0 ? `- 時間: **${percent}% 遅く**なりました` : `- 時間: ${-percent}% 速くなりました`);
	}
	if (byteDelta !== undefined && byteDelta !== 0) {
		lines.push(byteDelta > 0 ? `- 大きさ: **${formatBytes(byteDelta)} 増えました**` : `- 大きさ: ${formatBytes(byteDelta)} 減りました`);
	}
	lines.push('');

	if (level === 'worse') {
		lines.push('**はっきり悪くなっています。** 直前の変更を見てください（依存を足した／生成物が増えた、など）。');
	} else if (level === 'watch') {
		lines.push('少し悪くなっています。1 回なら誤差の範囲ですが、続くようなら原因を探してください。');
	} else {
		lines.push('前回と比べて、目立った悪化はありません。');
	}

	return lines.join('\n') + '\n';
}
