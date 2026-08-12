/**
 * タスク＝worktree＝セッション（1:1:1）のカンバン。
 *
 * 状態は「セッションの状態」と「承認待ちの有無」から導出する。利用者が手で状態を
 * 動かすものではなく、実際に起きていることを映す板として扱う。
 *
 * VS Code に依存しない純粋な状態機械にしてあるので、拡張ホストを起動せずに検証できる。
 * 保存先（Memento など）と worktree 操作とセッション起動は呼び出し側から注入する。
 */

export type KanbanState =
	/** 待機中（未開始 or 同時実行上限待ち） */
	| 'pending'
	/** 実行中 */
	| 'running'
	/** 承認待ち（このタスクのセッションが判断を待っている） */
	| 'awaiting-approval'
	/** レビュー待ち（ターンが終わり、人間の番） */
	| 'review'
	/** 完了（worktree 破棄済み） */
	| 'done';

export interface KanbanTask {
	taskId: string;
	title: string;
	repoCwd: string;
	worktreePath: string;
	branch: string;
	prompt: string;
	sessionId?: string;
	state: KanbanState;
	createdAt: number;
	updatedAt: number;
}

export const KANBAN_COLUMNS: { state: KanbanState; label: string }[] = [
	{ state: 'pending', label: '待機中' },
	{ state: 'running', label: '実行中' },
	{ state: 'awaiting-approval', label: '承認待ち' },
	{ state: 'review', label: 'レビュー待ち' },
	{ state: 'done', label: '完了' }
];

/** 実行枠を占有している状態（同時実行上限の判定に使う） */
export function occupiesSlot(state: KanbanState): boolean {
	return state === 'running' || state === 'awaiting-approval';
}

/**
 * 再起動後の復元。
 * 実行中・承認待ちだったタスクは、プロセスが死んだ時点でセッションも消えている。
 * 実行中のように見せると「動いていないのに待ち続ける」ことになるので、
 * 人間の判断が要る「レビュー待ち」へ倒す。
 */
export function restoreState(state: KanbanState): KanbanState {
	return occupiesSlot(state) ? 'review' : state;
}

/** 承認待ちの有無を踏まえた表示状態 */
export function deriveState(current: KanbanState, hasPendingApproval: boolean): KanbanState {
	if (current === 'running' && hasPendingApproval) {
		return 'awaiting-approval';
	}
	if (current === 'awaiting-approval' && !hasPendingApproval) {
		return 'running';
	}
	return current;
}

/**
 * 次に開始してよい待機中タスクを選ぶ。
 * in-flight（起動処理中）も枠に数える。数えないと await の隙間で上限を超える。
 */
export function nextStartable(
	tasks: readonly KanbanTask[],
	maxConcurrent: number,
	inFlight: number
): KanbanTask | undefined {
	const used = tasks.filter((t) => occupiesSlot(t.state)).length + inFlight;
	if (used >= maxConcurrent) {
		return undefined;
	}
	return [...tasks].filter((t) => t.state === 'pending').sort((a, b) => a.createdAt - b.createdAt)[0];
}
