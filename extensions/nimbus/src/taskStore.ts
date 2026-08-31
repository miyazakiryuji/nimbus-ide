/**
 * 板の読み書き（tasks.md T-259 / T-261）。
 *
 * 判断は `core/taskSync.ts`。ここは置き場所と書きかただけを持つ。
 *
 * セッションの台帳（`sessionStore.ts`）と同じ形にしてある —
 * **1 タスク 1 ファイル**（同時に書いても消えない）、書くときは別名 → `rename`、
 * 進捗は**追記だけ**（T-250 と同じ理由。読んで書き直すと並列で消える）。
 */
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { normalizeState, type KanbanTask } from './core/tasks';
import type { ProgressEntry } from './core/taskSync';

export interface TaskStoreOptions {
	log?: (message: string) => void;
}

export class TaskStore {
	private readonly log: (message: string) => void;
	/** 状態を寄せたことを知らせた記録（T-351）。板は 5 秒ごとに読み直すので、同じ札で何度も言わない */
	private readonly reported = new Set<string>();

	constructor(private readonly dir: string, options: TaskStoreOptions = {}) {
		this.log = options.log ?? (() => undefined);
	}

	/** 全ウィンドウぶんの板。壊れた記録は読み飛ばし、知らない状態は既知へ寄せる */
	async load(): Promise<KanbanTask[]> {
		let names: string[] = [];
		try {
			names = await readdir(this.dir);
		} catch {
			// まだ 1 つも書いていない
		}
		const tasks: KanbanTask[] = [];
		for (const name of names) {
			if (!name.endsWith('.json')) {
				continue;
			}
			try {
				const parsed = JSON.parse(await readFile(join(this.dir, name), 'utf8')) as KanbanTask;
				if (parsed?.taskId && parsed.title) {
					// 状態は今まで無検証だった（T-351）。別ウィンドウ・旧版・手編集が置いた
					// 知らない状態はどの列にも入らず板から消えるのに、数にだけ残る。
					// 読み出しの境で既知へ寄せて、数えたものが必ず見えるようにする
					const state = normalizeState(parsed.state);
					if (state === parsed.state) {
						tasks.push(parsed);
						continue;
					}
					this.report(parsed.taskId, parsed.state, state);
					tasks.push({ ...parsed, state });
				}
			} catch {
				// 書きかけ・壊れた記録は無かったことにする
			}
		}
		return tasks;
	}

	/**
	 * 状態を寄せたことを 1 度だけ知らせる（T-351）。
	 * 黙って寄せると「置いたはずの状態と違う」に気づけないが、5 秒ごとに同じ行を吐くと
	 * ログが埋まって他の手掛かりが読めなくなる。札と寄せ元の組ごとに 1 度だけ出す。
	 */
	private report(taskId: string, from: unknown, to: string): void {
		const key = `${taskId}:${String(from)}`;
		if (this.reported.has(key)) {
			return;
		}
		this.reported.add(key);
		this.log(`[tasks] 知らない状態「${String(from)}」を ${to} として読みました（${taskId}）`);
	}

	/** 1 件書く。書いている途中を読ませないため、別名で書いてから置き換える */
	async write(task: KanbanTask): Promise<void> {
		const target = join(this.dir, `${task.taskId}.json`);
		const temporary = `${target}.${process.pid}.tmp`;
		try {
			await mkdir(this.dir, { recursive: true });
			await writeFile(temporary, `${JSON.stringify(task)}\n`, 'utf8');
			await rename(temporary, target);
		} catch (error) {
			this.log(`[tasks] 記録を書けませんでした: ${message(error)}`);
			try {
				await rm(temporary, { force: true });
			} catch {
				// 消せなくても次の書き込みで上書きされる
			}
		}
	}

	/** 板から消す。進捗の記録も一緒に消す（タスクが無いのに履歴だけ残っても読めない） */
	async remove(taskId: string): Promise<void> {
		for (const name of [`${taskId}.json`, `${taskId}.progress.jsonl`]) {
			try {
				await rm(join(this.dir, name), { force: true });
			} catch (error) {
				this.log(`[tasks] 記録を消せませんでした: ${message(error)}`);
			}
		}
	}

	/**
	 * 進捗を 1 行足す（T-261）。**追記だけ**なので、どのウィンドウから書いても行が消えない。
	 * 途中で止まったときに「どこまで何をしたか」が残っていることが目的なので、
	 * 書けなかったことで作業を止めない。
	 */
	async appendProgress(taskId: string, entry: ProgressEntry): Promise<void> {
		try {
			await mkdir(this.dir, { recursive: true });
			await appendFile(join(this.dir, `${taskId}.progress.jsonl`), `${JSON.stringify(entry)}\n`, 'utf8');
		} catch (error) {
			this.log(`[tasks] 進捗を書けませんでした: ${message(error)}`);
		}
	}

	/** 1 タスクの進捗（古い順） */
	async readProgress(taskId: string): Promise<ProgressEntry[]> {
		let text = '';
		try {
			text = await readFile(join(this.dir, `${taskId}.progress.jsonl`), 'utf8');
		} catch {
			return [];
		}
		const entries: ProgressEntry[] = [];
		for (const line of text.split('\n')) {
			if (!line.trim()) {
				continue;
			}
			try {
				const parsed = JSON.parse(line) as ProgressEntry;
				if (typeof parsed?.at === 'number') {
					entries.push(parsed);
				}
			} catch {
				// 途中で切れた行は読み飛ばす
			}
		}
		return entries.sort((a, b) => a.at - b.at);
	}

	/** taskId → 最後の進捗（板の 1 行と、ヘルスチェックの材料に使う） */
	async lastProgress(): Promise<Map<string, ProgressEntry>> {
		const result = new Map<string, ProgressEntry>();
		let names: string[] = [];
		try {
			names = await readdir(this.dir);
		} catch {
			return result;
		}
		for (const name of names) {
			if (!name.endsWith('.progress.jsonl')) {
				continue;
			}
			const taskId = name.slice(0, -'.progress.jsonl'.length);
			const entries = await this.readProgress(taskId);
			const last = entries[entries.length - 1];
			if (last) {
				result.set(taskId, last);
			}
		}
		return result;
	}

	/** taskId → 最後に進捗を書いた時刻（ヘルスチェック用・T-262） */
	async lastProgressAt(): Promise<Map<string, number>> {
		return new Map([...(await this.lastProgress())].map(([taskId, entry]) => [taskId, entry.at]));
	}
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
