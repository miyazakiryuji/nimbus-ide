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
import type { TaskStore } from '../taskStore';
import { mergeTasks } from '../core/taskSync';
import { filePathOf, WRITE_TOOLS } from '../core/toolInput';
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

	/** 前回の突き合わせでディスクに在った ID。消されたのか、まだ書いていないのかを分ける（T-259） */
	private knownIds = new Set<string>();
	/**
	 * 起動時に「レビュー待ち」へ倒したタスク（T-375）。
	 *
	 * 倒しただけでは**ディスクの `running` に押し戻される** — `restoreState()` は状態しか
	 * 変えず `updatedAt` を触らないので、`mergeTasks()` の「同時刻ならディスク側」に負ける。
	 * かといって無条件に `updatedAt` を進めると、**生きている別の窓が本当に走らせている
	 * タスクまで**レビュー待ちへ倒してしまう（Memento には他の窓のぶんも入っている）。
	 * だから倒した相手を覚えておき、台帳を読んでから `reconcileAfterRestart()` で確かめる。
	 */
	private readonly restoredToReview = new Set<string>();
	/** taskId → 直近の進捗の 1 行（T-261）。他のウィンドウのぶんは突き合わせのときに拾う */
	private readonly progressText = new Map<string, string>();

	constructor(
		private readonly storage: Memento,
		private readonly worktrees: WorktreeManager,
		private readonly sessions: SessionManager,
		private readonly maxConcurrent: () => number,
		private readonly log: (message: string) => void,
		/** ウィンドウ横断で板を共有するための置き場（T-259）。無ければ今までどおり Memento だけ */
		private readonly store?: TaskStore,
		/** このウィンドウの印（T-260）。担当を残すのに使う */
		private readonly windowId?: string
	) {
		super();
		for (const task of storage.get<KanbanTask[]>(STORAGE_KEY, [])) {
			const state = restoreState(task.state);
			if (state !== task.state) {
				// 倒した相手は覚えておく（T-375）。生死を確かめるのは台帳を読んだあと
				this.restoredToReview.add(task.taskId);
			}
			this.tasks.set(task.taskId, { ...task, state });
		}
		this.sessions.on('event', (event: NimbusEvent) => this.onSessionEvent(event));
	}

	/**
	 * 再起動あとの整合（T-375）。**セッション台帳を読んでから、最初の突き合わせより前に**呼ぶ。
	 *
	 * 起動時に「レビュー待ち」へ倒したタスクのうち、**担当セッションの持ち主がもう居ない**もの
	 * だけ `updatedAt` を進めて、ディスクに残っている `running` より新しくする。
	 * 生きている窓が走らせているものは触らない — その窓のほうが正しいので、
	 * 突き合わせでディスク側（`running`）が勝つのが正解。
	 *
	 * @param liveSessionIds 台帳で**持ち主が生きている**セッションの ID
	 * @returns 倒したまま確定させた件数
	 */
	reconcileAfterRestart(liveSessionIds: ReadonlySet<string>, now: number = Date.now()): number {
		let settled = 0;
		for (const taskId of this.restoredToReview) {
			const task = this.tasks.get(taskId);
			if (!task) {
				continue;
			}
			if (task.sessionId && liveSessionIds.has(task.sessionId)) {
				// 別の窓が本当に走らせている。倒さず、突き合わせでディスク側に戻してもらう
				continue;
			}
			this.tasks.set(taskId, { ...task, updatedAt: now });
			settled += 1;
		}
		this.restoredToReview.clear();
		if (settled > 0) {
			this.log(`[task] 前回動いていた ${settled} 件をレビュー待ちにしました`);
		}
		return settled;
	}

	/**
	 * ディスクの板と突き合わせる（T-259）。
	 *
	 * 板の状態はウィンドウの中にしか無かったので、別のウィンドウで足したタスクが見えなかった。
	 * ファイルを正として、**新しいほうを勝たせる**。定期的に呼ぶ前提で、変わったときだけ知らせる。
	 */
	async syncWithStore(): Promise<void> {
		if (!this.store) {
			return;
		}
		const disk = await this.store.load();
		// 他のウィンドウが書いた進捗も拾う（自分が動かしていないタスクの様子が分かる）
		for (const [taskId, entry] of await this.store.lastProgress()) {
			this.progressText.set(taskId, entry.text);
		}
		const merged = mergeTasks(this.list(), disk, this.knownIds);
		this.knownIds = new Set(disk.map((task) => task.taskId));
		for (const task of merged.toWrite) {
			await this.store.write(task);
			this.knownIds.add(task.taskId);
		}
		if (!merged.changed) {
			return;
		}
		this.tasks.clear();
		for (const task of merged.tasks) {
			this.tasks.set(task.taskId, task);
		}
		if (merged.removed.length > 0) {
			this.log(`[task] 他のウィンドウで ${merged.removed.length} 件が消されました`);
		}
		void this.storage.update(STORAGE_KEY, this.list());
		this.emit('changed', this.list());
	}

	/** 進捗を 1 行残す（T-261）。途中で止まったとき、どこまで進んだかの手がかりになる */
	private noteProgress(taskId: string, kind: 'start' | 'turn' | 'file' | 'note' | 'done', text: string): void {
		this.progressText.set(taskId, text);
		void this.store?.appendProgress(taskId, { at: Date.now(), kind, text });
	}

	/** 直近の進捗（板のカードに 1 行だけ出す。T-261） */
	lastProgress(): Record<string, string> {
		return Object.fromEntries(this.progressText);
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
		this.persistAndEmit(task);
		this.noteProgress(task.taskId, 'note', `作成（${task.branch}）`);
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
		this.persistAndEmit(task);
	}

	/** タグを付け替える（T-147）。空文字は落とし、重複は 1 つにまとめる */
	setTags(taskId: string, tags: readonly string[]): void {
		const task = this.mustGet(taskId);
		task.tags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
		task.updatedAt = Date.now();
		this.persistAndEmit(task);
	}

	/** 待機中タスクの優先度を変える（T-233）。走り出したあとに変えても意味がないので待機中だけ */
	setPriority(taskId: string, priority: TaskPriority): void {
		const task = this.mustGet(taskId);
		if (task.state !== 'pending' || task.priority === priority) {
			return;
		}
		task.priority = priority;
		task.updatedAt = Date.now();
		this.persistAndEmit(task);
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
			// 誰が持っているかを残す（T-260）。板を横断で持つようになったので、
			// 「別の窓が走らせている」ことが分からないと二重に開始できてしまう
			task.ownerWindowId = this.windowId;
			await this.sessions.createSession({
				cwd: task.worktreePath,
				firstMessage: task.prompt,
				reuseSessionId: sessionId
			});
			this.setState(task, 'running');
			this.noteProgress(taskId, 'start', `開始（セッション ${sessionId.slice(0, 8)}）`);
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
		this.noteProgress(taskId, 'done', `完了${wipCommit ? `（WIP ${wipCommit.slice(0, 8)}）` : ''}`);
		this.log(`[task] 完了 ${task.title}${wipCommit ? `（WIP ${wipCommit.slice(0, 8)} に保存）` : ''}`);
		await this.startNextPending();
		return { wipCommit };
	}

	/** 一覧から取り除く（完了済みの掃除用。worktree には触れない） */
	forget(taskId: string): void {
		this.tasks.delete(taskId);
		this.knownIds.delete(taskId);
		void this.store?.remove(taskId);
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
		if (event.kind === 'tool-use' && WRITE_TOOLS.has(event.toolName)) {
			// 何を触ったかは、止まったあとに一番効く手がかりになる（T-261）
			const path = filePathOf(event.input);
			if (path) {
				this.noteProgress(task.taskId, 'file', path);
			}
			return;
		}
		if (event.kind === 'turn-result') {
			this.noteProgress(task.taskId, 'turn', oneLine(event.resultText) ?? 'ターンが終わりました');
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
		this.persistAndEmit(task);
	}

	/** @param changed 変わったタスク。渡されたぶんだけ台帳へ書く（全件書き直さない・T-250 と同じ理由） */
	private persistAndEmit(changed?: KanbanTask): void {
		void this.storage.update(STORAGE_KEY, this.list());
		if (changed) {
			void this.store?.write(changed);
			this.knownIds.add(changed.taskId);
		}
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

/** 進捗は一覧で読むものなので、1 行に畳んでから残す */
function oneLine(text: string | undefined): string | undefined {
	const folded = text?.replace(/\s+/g, ' ').trim().slice(0, 200);
	return folded ? folded : undefined;
}
