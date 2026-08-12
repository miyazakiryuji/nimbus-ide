/**
 * 承認の横断キューの並べかたと見せかた（tasks.md T-010）。
 *
 * セッションが 1 本なら、モーダルがその場で出るので困らない。困るのは**並列に走らせたとき**で、
 * VS Code のモーダルは 1 枚ずつしか出ないため、後ろで何本のセッションが止まっているのかが
 * 画面のどこにも出ない。放置して他の作業に戻る使いかたでは、これが一番の詰まりどころになる。
 *
 * ここは「どの順で見せるか」「どれだけ待たせているか」だけを決める。
 * VS Code に依存しないので単体で検証できる（表示は `approvalsView.ts`）。
 */
import type { RiskLevel } from './risk';

/** 並べ替えに要る最小限。`permissions.ts` の PendingApproval がこれを満たす */
export interface QueuedApproval {
	since: number;
	risk: RiskLevel;
}

/** 危ないものほど先に見せる */
const RISK_ORDER: Record<RiskLevel, number> = { danger: 0, caution: 1, normal: 2 };

/**
 * 危険度の高い順、同じ危険度なら待たせている順（古い順）。
 *
 * 到着順にしないのは、`rm -rf` が 3 番目に並んでいるあいだに前の 2 件を惰性で
 * 許可してしまう並びになるため。**先に見るべきものを先頭に置く**のが安全側。
 */
export function sortApprovals<T extends QueuedApproval>(pending: readonly T[]): T[] {
	return [...pending].sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || a.since - b.since);
}

/**
 * 待ち時間の表示。秒まで出し続けると目が落ち着かないので、1 分を超えたら分に丸める。
 * 時計のずれ等で負にならないよう 0 で止める。
 */
export function waitedLabel(since: number, now: number): string {
	const seconds = Math.max(0, Math.floor((now - since) / 1000));
	if (seconds < 60) {
		return `${seconds} 秒待ち`;
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes} 分待ち`;
	}
	return `${Math.floor(minutes / 60)} 時間 ${minutes % 60} 分待ち`;
}
