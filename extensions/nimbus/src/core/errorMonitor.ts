/**
 * エラー監視ツールとの連携（tasks.md T-142）— 実装中（@session-b）。
 * Sentry の JSON には、スタックだけでは分からないもの（件数・影響人数・リリース・
 * 操作の足あと）が入っている。そこが判断を変えるので、そこを取り出す。
 */

/** 正規化した 1 件 */
export interface MonitoredIssue {
	title: string;
	/** 何回起きたか */
	count?: number;
	/** 何人に起きたか */
	userCount?: number;
}

/** 数として読めるものだけを返す */
export function asCount(value: unknown): number | undefined {
	const n = typeof value === 'string' ? Number(value) : value;
	return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined;
}
