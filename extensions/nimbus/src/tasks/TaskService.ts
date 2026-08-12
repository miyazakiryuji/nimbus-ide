/**
 * カンバンのタスク運用。worktree の作成・セッションの起動・状態の同期を受け持つ。
 *
 * 保存は VS Code の Memento（globalState）。旧 Electron 版は SQLite を持っていたが、
 * ここで保持したいのは「タスク一覧」だけで、ネイティブ依存を増やす理由がない。
 */
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { Memento } from 'vscode';
import type { NimbusEvent } from '../events';
import type { SessionManager } from '../session/SessionManager';
import { WorktreeManager } from '../core/worktree';
import {
	deriveState,
	nextStartable,
	occupiesSlot,
	restoreState,
	type KanbanState,
	type KanbanTask,
	type TaskPriority
} from '../core/tasks';

const STORAGE_KEY = 'nimbus.tasks';

export interface CreateTaskInput {
	title: string;
	prompt: string;
	repoCwd: string;
	autoStart: boolean;
	/** 待機列での優先度（T-233）。省略時は normal */
	priority?: TaskPriority;
	/** 元になった tasks.md の行（T-013） */
	sourceTaskId?: string;
}

export class TaskService extends EventEmitter {
	private readonly tasks = new Map<string, KanbanTask>();
	/** 起動処理中のタスク（await の隙間での二重起動と上限超過を防ぐ同期ガード） */
	private readonly starting = new Set<string>();
	/**
	 * 緊急停止（T-057）で自動開始を止めている状態。
	 * 全部止めた直後に待機列の次が走り出したら、止めた意味が無い。
	 * 利用者が手でタスクを開始した時点で解除する（＝再開の意思表示）。
	 */
	private autoStartPaused = false;

	constructor(
		private readonly storage: Memento,
		private readonly worktrees: WorktreeManager,
		private readonly sessions: SessionManager,
		private readonly maxConcurrent: () => number,
		private readonly log: (message: string) => void
	) {
		super();
		for (const task of storage.get<KanbanTask[]>(STORAGE_KEY, [])) {
			this.tasks.set(task.taskId, { ...task, state: restoreState(task.state) });
		}
		this.sessions.on('event', (event: NimbusEvent) => this.onSessionEvent(event));
	}

	list(): KanbanTask[] {
		return [...this.tasks.values()].sort((a, b) => a.createdAt - b.createdAt);
	}

	get(taskId: string): KanbanTask | undefined {
		return this.tasks.get(taskId);
	}

	/** 承認待ちの集合が変わったら、該当タスクの表示状態を追従させる */
	applyPendingApprovals(sessionIds: ReadonlySet<string>): void {
		for (const task of this.tasks.values()) {
			if (!task.sessionId) {
				continue;
			}
			const next = deriveState(task.state, sessionIds.has(task.sessionId));
			if (next !== task.state) {
				this.setState(task, next);
			}
		}
	}

	async createTask(input: CreateTaskInput): Promise<KanbanTask> {
		const worktree = await this.worktrees.create(input.repoCwd, input.title);
		const task: KanbanTask = {
			taskId: randomUUID(),
			title: input.title,
			repoCwd: input.repoCwd,
			worktreePath: worktree.path,
			branch: worktree.branch,
			prompt: input.prompt,
			state: 'pending',
			priority: input.priority ?? 'normal',
			sourceTaskId: input.sourceTaskId,
			createdAt: Date.now(),
			updatedAt: Date.now()
		};
		this.tasks.set(task.taskId, task);
		this.log(`[task] 作成 ${task.title} → ${task.branch}`);
		this.persistAndEmit();
		if (input.autoStart) {
			// 自動開始の失敗でタスク作成自体を失敗させない（worktree はもうある）。
			// 待機中のまま残るので、利用者が手で開始できる
			try {
				await this.startNextPending();
			} catch (error) {
				this.log(`[task] 自動開始に失敗（待機中のまま）: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		return task;
	}

	/** ピン留めの切り替え（T-147）。板の先頭に出したいものを固定する */
	togglePinned(taskId: string): void {
		const task = this.mustGet(taskId);
		task.pinned = !task.pinned;
		task.updatedAt = Date.now();
		this.persistAndEmit();
	}

	/** タグを付け替える（T-147）。空文字は落とし、重複は 1 つにまとめる */
	setTags(taskId: string, tags: readonly string[]): void {
		const task = this.mustGet(taskId);
		task.tags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
		task.updatedAt = Date.now();
		this.persistAndEmit();
	}

	/** 待機中タスクの優先度を変える（T-233）。走り出したあとに変えても意味がないので待機中だけ */
	setPriority(taskId: string, priority: TaskPriority): void {
		const task = this.mustGet(taskId);
		if (task.state !== 'pending' || task.priority === priority) {
			return;
		}
		task.priority = priority;
		task.updatedAt = Date.now();
		this.persistAndEmit();
	}

	/** 待機タスクの自動開始を止める。緊急停止から呼ぶ */
	pauseAutoStart(): void {
		this.autoStartPaused = true;
	}

	/** 上限に空きがあれば開始する。空きが無ければ理由を返す */
	async startTask(taskId: string): Promise<{ started: boolean; reason?: string }> {
		const task = this.mustGet(taskId);
		if (task.state !== 'pending' || this.starting.has(taskId)) {
			return { started: false, reason: '待機中のタスクではありません' };
		}
		// 手で開始した＝再開の意思表示。ここで自動開始も戻す
		this.autoStartPaused = false;
		const limit = this.maxConcurrent();
		if (!nextStartable([task], limit, this.usedSlots() + this.starting.size - (occupiesSlot(task.state) ? 1 : 0))) {
			return { started: false, reason: `同時実行の上限（${limit}）に達しています。空きが出ると自動で開始します` };
		}
		// await より前に同期でマークして二重起動を閉じる
		this.starting.add(taskId);
		try {
			const sessionId = randomUUID();
			task.sessionId = sessionId;
			await this.sessions.createSession({
				cwd: task.worktreePath,
				firstMessage: task.prompt,
				reuseSessionId: sessionId
			});
			this.setState(task, 'running');
			this.log(`[task] 開始 ${task.title}`);
			return { started: true };
		} finally {
			this.starting.delete(taskId);
		}
	}

	/** 完了: 実行中なら止めてから worktree を破棄（未コミットの成果は WIP コミットで残す） */
	async completeTask(taskId: string): Promise<{ wipCommit?: string }> {
		const task = this.mustGet(taskId);
		if (task.sessionId && this.sessions.isActive(task.sessionId)) {
			// 消される worktree に書き込みを続けさせない
			try {
				await this.sessions.interrupt(task.sessionId);
			} catch {
				// 中断できない状態は無視
			}
			try {
				this.sessions.close(task.sessionId);
			} catch {
				// すでに閉じている場合は無視
			}
		}
		let wipCommit: string | undefined;
		try {
			({ wipCommit } = await this.worktrees.remove(task.repoCwd, task.worktreePath));
		} catch (error) {
			// 手動で消されている等でも状態は完了にする
			this.log(`[task] worktree の破棄に失敗: ${error instanceof Error ? error.message : String(error)}`);
		}
		this.setState(task, 'done');
		this.log(`[task] 完了 ${task.title}${wipCommit ? `（WIP ${wipCommit.slice(0, 8)} に保存）` : ''}`);
		await this.startNextPending();
		return { wipCommit };
	}

	/** 一覧から取り除く（完了済みの掃除用。worktree には触れない） */
	forget(taskId: string): void {
		this.tasks.delete(taskId);
		this.persistAndEmit();
	}

	async startNextPending(): Promise<void> {
		if (this.autoStartPaused) {
			return;
		}
		const candidate = nextStartable(this.list(), this.maxConcurrent(), this.starting.size);
		if (candidate) {
			await this.startTask(candidate.taskId);
		}
	}

	private usedSlots(): number {
		return this.list().filter((t) => occupiesSlot(t.state)).length;
	}

	private onSessionEvent(event: NimbusEvent): void {
		const task = this.list().find((t) => t.sessionId === event.sessionId);
		if (!task || task.state === 'done') {
			return;
		}
		if (event.kind === 'turn-result') {
			this.setState(task, 'review');
			void this.startNextPending();
		} else if (event.kind === 'status' && (event.status === 'error' || event.status === 'completed')) {
			this.setState(task, 'review');
			void this.startNextPending();
		} else if (event.kind === 'status' && event.status === 'running' && task.state === 'review') {
			this.setState(task, 'running');
		}
	}

	private setState(task: KanbanTask, state: KanbanState): void {
		if (task.state === state) {
			return;
		}
		task.state = state;
		task.updatedAt = Date.now();
		this.persistAndEmit();
	}

	private persistAndEmit(): void {
		void this.storage.update(STORAGE_KEY, this.list());
		this.emit('changed', this.list());
	}

	private mustGet(taskId: string): KanbanTask {
		const task = this.tasks.get(taskId);
		if (!task) {
			throw new Error(`不明なタスク: ${taskId}`);
		}
		return task;
	}
}
