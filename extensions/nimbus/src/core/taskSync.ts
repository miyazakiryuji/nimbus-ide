/**
 * 板をウィンドウ横断で持つための突き合わせと、止まっているタスクの見つけかた
 * （tasks.md T-259 / T-260 / T-261 / T-262）。
 *
 * 板の状態は `TaskService` のメモリと Memento（globalState）にしか無かった。
 * Memento はウィンドウごとに読み込まれるので、**別のウィンドウで足したタスクが見えない**。
 * セッションの台帳（`sessionRegistry.ts`）と同じ考えで、ファイルを正にして突き合わせる。
 *
 * ここは判断だけ。読み書きは `src/taskStore.ts`。VS Code に依存しないので単体で検証できる。
 */
import type { KanbanTask } from './tasks';
import { occupiesSlot } from './tasks';

/** 1 タスクの進捗（T-261）。追記しかしないので、行が消えない */
export interface ProgressEntry {
	at: number;
	kind: 'start' | 'turn' | 'file' | 'note' | 'done';
	/** 1 行で読める説明 */
	text: string;
}

export interface MergeResult {
	/** 突き合わせ後の板 */
	tasks: KanbanTask[];
	/** ディスクへ書くべきもの（自分にしか無い・自分のほうが新しい） */
	toWrite: KanbanTask[];
	/** 他のウィンドウで消されたもの */
	removed: string[];
	/** 中身が変わったか。変わったときだけ画面を作り直す */
	changed: boolean;
}

/**
 * 手元の板と、ディスクの板を突き合わせる（T-259）。
 *
 * 勝ち負けは `updatedAt` の新しいほう。時計のずれで負けることはあるが、
 * **どちらが正しいかを機械が決められない**以上、最後に触ったほうを採るのが一番驚きが少ない。
 *
 * @param knownIds 前回の突き合わせでディスクに在った ID。
 *   「消された」のか「まだ書いていない」のかは、これが無いと区別できない
 */
export function mergeTasks(
	mine: readonly KanbanTask[],
	disk: readonly KanbanTask[],
	knownIds: ReadonlySet<string>
): MergeResult {
	const byId = new Map<string, KanbanTask>();
	const toWrite: KanbanTask[] = [];
	const removed: string[] = [];
	const onDisk = new Map(disk.map((task) => [task.taskId, task]));

	for (const task of mine) {
		const other = onDisk.get(task.taskId);
		if (!other) {
			if (knownIds.has(task.taskId)) {
				// 一度ディスクに在ったものが消えている＝他のウィンドウで消された
				removed.push(task.taskId);
				continue;
			}
			// まだ書いていない（このウィンドウで作ったばかり）
			byId.set(task.taskId, task);
			toWrite.push(task);
			continue;
		}
		if (task.updatedAt > other.updatedAt) {
			byId.set(task.taskId, task);
			toWrite.push(task);
		} else {
			byId.set(task.taskId, other);
		}
	}
	for (const task of disk) {
		if (!byId.has(task.taskId)) {
			byId.set(task.taskId, task);
		}
	}
	const tasks = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
	return { tasks, toWrite, removed, changed: !sameBoard(mine, tasks) };
}

/** 板として同じか（並べ替えの違いは見ない） */
function sameBoard(a: readonly KanbanTask[], b: readonly KanbanTask[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	const key = (tasks: readonly KanbanTask[]): string =>
		[...tasks]
			.map((task) => `${task.taskId}:${task.updatedAt}:${task.state}`)
			.sort()
			.join('|');
	return key(a) === key(b);
}

/** 止まっている理由 */
export type StallReason =
	/** 走っていることになっているが、担当セッションがもういない */
	| 'owner-gone'
	/** 走ってはいるが、長いこと何も起きていない */
	| 'no-progress'
	/** 待機のまま動き出していない */
	| 'never-started'
	/** 完了なのに worktree が残っている */
	| 'done-but-left';

export interface TaskHealth {
	task: KanbanTask;
	reason: StallReason;
	/** そのまま画面に出せる説明 */
	detail: string;
	/** 最後に動いてからの経過（ms） */
	idleMs: number;
}

/** 既定でこれだけ動きが無ければ「止まっている」と見なす */
export const STALL_MS = 30 * 60 * 1000;

/**
 * 止まっているタスクを洗い出す（T-262）。
 *
 * 並列で走らせると、**止まったことに誰も気づかない**のが一番損をする。
 * 判定材料は 4 つ — 担当セッションが生きているか（T-260）・進捗の記録（T-261）・
 * 最終更新・worktree が残っているか。**直しはしない**。出すところまで。
 */
export function checkTaskHealth(
	tasks: readonly KanbanTask[],
	options: {
		now: number;
		/** いま生きているセッション ID（セッションの台帳から） */
		liveSessionIds: ReadonlySet<string>;
		/** taskId → 最後に進捗を書いた時刻（T-261） */
		lastProgressAt?: ReadonlyMap<string, number>;
		/** worktree がまだ在るか。渡さなければ「完了なのに残っている」は見ない */
		hasWorktree?: (task: KanbanTask) => boolean;
		stallMs?: number;
	}
): TaskHealth[] {
	const stallMs = options.stallMs ?? STALL_MS;
	const found: TaskHealth[] = [];
	for (const task of tasks) {
		const lastAt = Math.max(task.updatedAt, options.lastProgressAt?.get(task.taskId) ?? 0);
		const idleMs = options.now - lastAt;
		if (task.state === 'done') {
			if (options.hasWorktree?.(task)) {
				found.push({
					task,
					reason: 'done-but-left',
					detail: `完了なのに worktree が残っています（${task.worktreePath}）`,
					idleMs
				});
			}
			continue;
		}
		if (occupiesSlot(task.state)) {
			if (task.sessionId && !options.liveSessionIds.has(task.sessionId)) {
				found.push({
					task,
					reason: 'owner-gone',
					detail: `「${task.state === 'running' ? '作業中' : '承認待ち'}」のままですが、担当のセッションはもういません`,
					idleMs
				});
				continue;
			}
			if (idleMs > stallMs) {
				found.push({
					task,
					reason: 'no-progress',
					detail: `${describeIdle(idleMs)}のあいだ、進捗が記録されていません`,
					idleMs
				});
			}
			continue;
		}
		if (task.state === 'pending' && idleMs > stallMs) {
			found.push({
				task,
				reason: 'never-started',
				detail: `${describeIdle(idleMs)}のあいだ、待機のままです`,
				idleMs
			});
		}
	}
	return found.sort((a, b) => b.idleMs - a.idleMs);
}

/** 経過を人が読める形にする */
export function describeIdle(ms: number): string {
	const minutes = Math.floor(ms / 60000);
	if (minutes < 60) {
		return `${minutes} 分`;
	}
	const hours = Math.floor(minutes / 60);
	return hours < 24 ? `${hours} 時間` : `${Math.floor(hours / 24)} 日`;
}

/** 進捗の要約（T-261）。板の 1 行に出す */
export function summarizeProgress(entries: readonly ProgressEntry[]): { last?: ProgressEntry; turns: number; files: string[] } {
	const files = new Set<string>();
	let turns = 0;
	for (const entry of entries) {
		if (entry.kind === 'turn') {
			turns++;
		}
		if (entry.kind === 'file') {
			files.add(entry.text);
		}
	}
	return { last: entries[entries.length - 1], turns, files: [...files] };
}
