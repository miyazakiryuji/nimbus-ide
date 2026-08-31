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

/**
 * 待機列での優先度（tasks.md T-233）。
 * 数字が小さいほど先。既定は `normal`。
 */
export type TaskPriority = 'high' | 'normal' | 'low';

export const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

export const PRIORITY_LABEL: Record<TaskPriority, string> = { high: '高', normal: '中', low: '低' };

export interface KanbanTask {
	taskId: string;
	title: string;
	repoCwd: string;
	worktreePath: string;
	branch: string;
	prompt: string;
	sessionId?: string;
	state: KanbanState;
	/** 省略時は `normal`（既存の保存データにも無いので、読むときに補う） */
	priority?: TaskPriority;
	createdAt: number;
	updatedAt: number;
	/** 元になった tasks.md の行の ID（T-013）。あれば完了時に tasks.md へ戻せる */
	sourceTaskId?: string;
	/** ピン留め（T-147）。板の先頭に出す。待機列の優先度とは別物 */
	pinned?: boolean;
	/** タグ（T-147）。絞り込みに使う */
	tags?: string[];
	/**
	 * このタスクを走らせているウィンドウ（T-260）。板をウィンドウ横断で持つようになったので、
	 * 「誰が持っているか」が分からないと、別の窓から二重に開始できてしまう。
	 */
	ownerWindowId?: string;
}

/** ピン留めを先に、次に作った順（板の並び。待機列の優先度とは別の話） */
export function sortForBoard(tasks: readonly KanbanTask[]): KanbanTask[] {
	return [...tasks].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || a.createdAt - b.createdAt);
}

/** タグで絞る。指定が空なら全部通す */
export function filterByTags(tasks: readonly KanbanTask[], tags: readonly string[]): KanbanTask[] {
	if (tags.length === 0) {
		return [...tasks];
	}
	return tasks.filter((task) => tags.every((tag) => task.tags?.includes(tag)));
}

/** 使われているタグを、多い順に集める */
export function collectTags(tasks: readonly KanbanTask[]): { tag: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const task of tasks) {
		for (const tag of task.tags ?? []) {
			counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * 板の列。**表記は英語で揃える**（T-257）。
 *
 * 未着手 / 作業中 / 完了 は、かんばんの言い回しとして英語のほうが通りがよい。
 * 一部だけ日本語に残すと 1 枚の板に 2 つの言語が混ざって読みにくいので、5 列とも英語にする。
 */
export const KANBAN_COLUMNS: { state: KanbanState; label: string }[] = [
	{ state: 'pending', label: 'To Do' },
	{ state: 'running', label: 'In Progress' },
	{ state: 'awaiting-approval', label: 'Needs Approval' },
	{ state: 'review', label: 'In Review' },
	{ state: 'done', label: 'Done' }
];

/**
 * 板に列がある状態。**列そのものから作る**ので、列を足したときに取りこぼさない。
 */
const KNOWN_STATES: ReadonlySet<string> = new Set(KANBAN_COLUMNS.map((column) => column.state));

/** 板が知っている状態か。別ウィンドウ・旧版・手編集が置いた記録は何が入っているか分からない */
function isKanbanState(value: unknown): value is KanbanState {
	return typeof value === 'string' && KNOWN_STATES.has(value);
}

/**
 * 知らない状態・欠けた状態を「まだ手を付けていない」へ寄せる（T-351）。
 *
 * 板は列（＝状態）ごとに絞ってカードを作るので、列の無い状態の札は**どの列にも入らず消える**。
 * それでも数には残るため「全 3 なのにカードは 1 枚」— 探しても見つからない仕事が数字だけ
 * 主張する状態になる。並列で走らせているときに一番損をする壊れかたなので、**読み出しの境で**
 * 寄せて必ず見える場所に出す。寄せ先は「まだ手を付けていない」に当たる `pending`。
 */
export function normalizeState(state: unknown): KanbanState {
	return isKanbanState(state) ? state : 'pending';
}

/** 実行枠を占有している状態（同時実行上限の判定に使う） */
export function occupiesSlot(state: KanbanState): boolean {
	return state === 'running' || state === 'awaiting-approval';
}

/**
 * 再起動後の復元。
 * 実行中・承認待ちだったタスクは、プロセスが死んだ時点でセッションも消えている。
 * 実行中のように見せると「動いていないのに待ち続ける」ことになるので、
 * 人間の判断が要る「レビュー待ち」へ倒す。
 *
 * ここは Memento からの**読み出しの境**でもあるので、知らない状態もここで寄せる（T-351）。
 * 既知の 5 状態に対する答えは今までと変わらない。
 */
export function restoreState(state: KanbanState): KanbanState {
	const known = normalizeState(state);
	return occupiesSlot(known) ? 'review' : known;
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
	// 優先度が先、同じなら作った順（先に入れたものを追い越さない）
	return [...tasks]
		.filter((t) => t.state === 'pending')
		.sort(
			(a, b) =>
				PRIORITY_ORDER[a.priority ?? 'normal'] - PRIORITY_ORDER[b.priority ?? 'normal'] ||
				a.createdAt - b.createdAt
		)[0];
}
