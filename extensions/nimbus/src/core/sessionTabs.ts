/**
 * セッションのタブ（tasks.md T-269）。
 *
 * 並列で走らせると「どのセッションが、いまどうなっているか」を一目で掴めることが要になる。
 * タブに出すのは**混ぜた 1 つの状態**で、材料は 2 つ —
 * `SessionStatus`（`events.ts`）と、**承認を待っているかどうか**（`core/approvalQueue.ts` 側の待ち行列）。
 * `SessionStatus` に「許可待ち」は無いので、ここで合流させる。
 *
 * **色だけに頼らない。** 記号を必ず添える（色覚の違いと、モノクロのスクリーンショットで潰れるため）。
 * 色は新しく作らず、**既にその意味を持っている VS Code のトークン**へ寄せる（`core/persona.ts` と同じ方針）。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { SessionStatus, SessionSummary } from '../events';

export type TabState =
	/** 人の許可を待って止まっている。いちばん先に気づきたい */
	| 'waiting-approval'
	/** 動いている */
	| 'running'
	/** ターンが終わり、人間の番 */
	| 'asking'
	/** 終わった */
	| 'done'
	/** 止めた */
	| 'stopped'
	| 'error';

export interface TabLook {
	/** 色に頼らないための記号 */
	symbol: string;
	/** 読み上げ・tooltip 用の 1 語 */
	label: string;
	/** VS Code のテーマ色トークン（webview では `--vscode-` 変数として引ける） */
	color: string;
}

const LOOK: Record<TabState, TabLook> = {
	// 止まっていることを知らせる色は、既に警告が持っている
	'waiting-approval': { symbol: '!', label: '許可待ち', color: 'list-warningForeground' },
	// 進行中を表すトークンをそのまま借りる
	running: { symbol: '●', label: '作業中', color: 'progressBar-background' },
	// 人間の番＝知らせであって異常ではない
	asking: { symbol: '?', label: 'あなたの番', color: 'editorInfo-foreground' },
	// 「通った」を既に意味しているトークン
	done: { symbol: '✓', label: '完了', color: 'testing-iconPassed' },
	stopped: { symbol: '■', label: '中断', color: 'descriptionForeground' },
	error: { symbol: '✕', label: 'エラー', color: 'list-errorForeground' }
};

/**
 * 状態を 1 つに混ぜる。**許可待ちが最優先** —
 * 走っている最中に承認へ入ることがあり、そのとき見たいのは「止まっている」ほう。
 */
export function tabStateOf(status: SessionStatus, hasPendingApproval: boolean): TabState {
	if (hasPendingApproval) {
		return 'waiting-approval';
	}
	switch (status) {
		case 'starting':
		case 'running':
			return 'running';
		case 'awaiting-input':
			return 'asking';
		case 'interrupted':
			return 'stopped';
		case 'error':
			return 'error';
		default:
			return 'done';
	}
}

export function lookOf(state: TabState): TabLook {
	return LOOK[state];
}

export interface SessionTab {
	sessionId: string;
	/** タブに出す名前 */
	title: string;
	state: TabState;
	symbol: string;
	label: string;
	color: string;
	active: boolean;
}

/** タブに出す名前。最初に頼んだことが無ければ ID の頭を使う */
export function tabTitle(title: string | undefined, sessionId: string, max = 24): string {
	const folded = title?.replace(/\s+/g, ' ').trim();
	if (!folded) {
		return sessionId.slice(0, 8);
	}
	return folded.length > max ? `${folded.slice(0, max - 1)}…` : folded;
}

/**
 * タブの列を組む。並びは**始めた順**で固定する —
 * 状態で並べ替えると、押そうとした瞬間に動いて押し間違える。
 */
export function buildTabs(
	sessions: readonly SessionSummary[],
	options: {
		activeSessionId?: string;
		/** 承認を待っているセッション */
		pendingSessionIds?: ReadonlySet<string>;
		/** sessionId → 最初に頼んだこと */
		titles?: ReadonlyMap<string, string>;
	} = {}
): SessionTab[] {
	const pending = options.pendingSessionIds ?? new Set<string>();
	return [...sessions]
		.sort((a, b) => a.createdAt - b.createdAt)
		.map((session) => {
			const state = tabStateOf(session.status, pending.has(session.sessionId));
			const look = lookOf(state);
			return {
				sessionId: session.sessionId,
				title: tabTitle(options.titles?.get(session.sessionId), session.sessionId),
				state,
				symbol: look.symbol,
				label: look.label,
				color: look.color,
				active: session.sessionId === options.activeSessionId
			};
		});
}
