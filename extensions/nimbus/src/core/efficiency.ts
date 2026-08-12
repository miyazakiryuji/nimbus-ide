/**
 * コンテキスト効率のスコア（tasks.md T-156）。
 *
 * 同じファイルを何度も読み直すと、そのぶんだけ文脈が減る。
 * ただし「無駄な読み込み」を機械が言い当てるのは無理なので、**言い切れるものだけ**を数える。
 * 同じファイルの 2 回目以降の読み込みは、内容が既に文脈にある以上、明確に重複している。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { NimbusEvent } from '../events';
import { buildActivity } from './activity';

export interface ContextEfficiency {
	/** 読み込みの総回数 */
	totalReads: number;
	/** 読んだファイルの種類数 */
	uniqueFiles: number;
	/** 2 回目以降の読み込み（＝重複） */
	rereads: number;
	/** 0〜100。1 ファイル 1 回で読めていれば 100 */
	score: number;
	/** 読み直しが多い順。上位だけ */
	worst: { path: string; reads: number }[];
}

const WORST_LIMIT = 5;

export function contextEfficiency(events: readonly NimbusEvent[]): ContextEfficiency {
	const files = buildActivity(events).files.filter((file) => file.reads > 0);
	const totalReads = files.reduce((sum, file) => sum + file.reads, 0);
	const uniqueFiles = files.length;
	const rereads = totalReads - uniqueFiles;
	return {
		totalReads,
		uniqueFiles,
		rereads,
		// 読み込みが無いときは減点しようがない。0% ではなく満点にする
		score: totalReads === 0 ? 100 : Math.round((uniqueFiles / totalReads) * 100),
		worst: files
			.filter((file) => file.reads > 1)
			.sort((a, b) => b.reads - a.reads)
			.slice(0, WORST_LIMIT)
			.map((file) => ({ path: file.path, reads: file.reads }))
	};
}

/** 1 行の説明。数字だけ出しても何をすればいいか分からないので、次の一手を添える */
export function describeEfficiency(efficiency: ContextEfficiency): string {
	if (efficiency.totalReads === 0) {
		return 'まだ読み込みがありません';
	}
	if (efficiency.rereads === 0) {
		return `${efficiency.score}% · 読み直しなし`;
	}
	return `${efficiency.score}% · ${efficiency.rereads} 回の読み直し（同じ内容が二重に載っています）`;
}
