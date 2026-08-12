/**
 * 今週のふりかえり（tasks.md T-097）。
 *
 * 続けるための仕掛け。ただし**盛らない** — 実際に起きたことしか出さない。
 * 数字を大きく見せると、次に見たときに信用されなくなる。
 *
 * 「教材になるやり取りの切り出し」（T-214・`core/highlights.ts`）とは別物。
 * あちらは 1 セッションから見せ場を抜く話で、こちらは**週をまたいで数える**話。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { NimbusEvent } from '../events';
import { buildActivity } from './activity';
import { collectEvidence } from './evidence';

export interface WeeklyReview {
	/** もとにしたセッション数 */
	sessions: number;
	/** 一番よく働いたサブエージェント */
	topAgent?: { name: string; runs: number; tokens: number };
	/** 一番よく触ったファイル */
	topFile?: { path: string; touches: number };
	/** テストが通った回数 */
	testsPassed: number;
	/** 触ったファイルの総数 */
	filesTouched: number;
}

export function buildWeeklyReview(sessions: readonly (readonly NimbusEvent[])[]): WeeklyReview {
	const agentRuns = new Map<string, { runs: number; tokens: number }>();
	const fileTouches = new Map<string, number>();
	let testsPassed = 0;

	for (const events of sessions) {
		const activity = buildActivity(events);
		for (const agent of activity.subagents) {
			const key = agent.subagentType ?? agent.description;
			const current = agentRuns.get(key) ?? { runs: 0, tokens: 0 };
			agentRuns.set(key, { runs: current.runs + 1, tokens: current.tokens + (agent.totalTokens ?? 0) });
		}
		for (const file of activity.files) {
			fileTouches.set(file.path, (fileTouches.get(file.path) ?? 0) + file.reads + file.writes);
		}
		testsPassed += collectEvidence(events).runs.filter((run) => run.outcome === 'passed').length;
	}

	const topAgentEntry = [...agentRuns.entries()].sort((a, b) => b[1].runs - a[1].runs || b[1].tokens - a[1].tokens)[0];
	const topFileEntry = [...fileTouches.entries()].sort((a, b) => b[1] - a[1])[0];
	return {
		sessions: sessions.length,
		topAgent: topAgentEntry ? { name: topAgentEntry[0], ...topAgentEntry[1] } : undefined,
		topFile: topFileEntry ? { path: topFileEntry[0], touches: topFileEntry[1] } : undefined,
		testsPassed,
		filesTouched: fileTouches.size
	};
}

/** 言葉にする。**無かったものは書かない**（空欄を埋めるために盛らない） */
export function describeWeeklyReview(review: WeeklyReview): string {
	if (review.sessions === 0) {
		return 'まだ材料がありません';
	}
	const lines = [`セッション ${review.sessions} 本`];
	if (review.filesTouched > 0) {
		lines.push(`${review.filesTouched} ファイルに触りました`);
	}
	if (review.testsPassed > 0) {
		lines.push(`テストが ${review.testsPassed} 回通りました`);
	}
	if (review.topAgent) {
		lines.push(`いちばん働いたのは ${review.topAgent.name}（${review.topAgent.runs} 回）`);
	}
	if (review.topFile) {
		lines.push(`いちばん触ったのは ${review.topFile.path}（${review.topFile.touches} 回）`);
	}
	return lines.join(' · ');
}
