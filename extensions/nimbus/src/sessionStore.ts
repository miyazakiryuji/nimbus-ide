/**
 * セッション台帳の読み書き（tasks.md T-247 / T-250 / T-251）。
 *
 * 判断は `core/sessionRegistry.ts`。ここは**置き場所と書きかた**だけを持つ。
 *
 * ## 1 セッション 1 ファイル
 *
 * 全セッションを 1 つの JSON に入れると、書くたびに「全部読んで全部書き直す」ことになり、
 * 同時に書いた分が**黙って消える**（T-250 の監査ログと同じ壊れかた）。
 * セッションごとにファイルを分ければ、書き手が重ならないので、そもそも競合しない。
 * 横断で見たいときは、ディレクトリを読めばよい。
 *
 * ## 書き出しは間引く
 *
 * イベントは 1 ターンで数百件流れる。そのたびに書くと、並列で走らせたときに
 * ディスクが律速になる（T-248）。状態が動いたときだけ印を付け、まとめて書く。
 */
import { randomUUID } from 'crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import {
	HEARTBEAT_INTERVAL_MS,
	OWNER_TTL_MS,
	forgettable,
	type SessionRecord
} from './core/sessionRegistry';

/** 書き出しをまとめる待ち時間。人間には気づけない範囲で、書き込み回数だけ落とす */
const FLUSH_DELAY_MS = 250;

/** 横断の読み取りをこの間だけ使い回す。ステータスバーの更新でディスクを叩き続けないため */
const READ_CACHE_MS = 1_000;

export interface SessionStoreOptions {
	windowId?: string;
	pid?: number;
	now?: () => number;
	heartbeatMs?: number;
	log?: (message: string) => void;
}

/** 台帳の置き場所と書きかた。VS Code に依存しないので、テストからも素の一時ディレクトリで使える */
export class SessionStore {
	/** このウィンドウが持っているセッション */
	private readonly mine = new Map<string, SessionRecord>();
	private readonly dirty = new Set<string>();
	private readonly now: () => number;
	private readonly log: (message: string) => void;
	private flushTimer: ReturnType<typeof setTimeout> | undefined;
	private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
	/** 最後に読んだ他ウィンドウぶんの記録と、その時刻 */
	private lastRead: SessionRecord[] = [];
	private lastReadAt = 0;
	private disposed = false;

	readonly windowId: string;
	private readonly pid: number;

	constructor(private readonly dir: string, options: SessionStoreOptions = {}) {
		this.windowId = options.windowId ?? randomUUID();
		this.pid = options.pid ?? process.pid;
		this.now = options.now ?? Date.now;
		this.log = options.log ?? (() => undefined);
		const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
		this.heartbeatTimer = setInterval(() => this.beat(), heartbeatMs);
		// 心拍だけのために拡張ホストを起こし続けない
		this.heartbeatTimer.unref?.();
	}

	/** 台帳の全部（他のウィンドウの分も含む）。壊れた記録は数に入れず読み飛ばす */
	async list(options?: { fresh?: boolean }): Promise<SessionRecord[]> {
		if (!options?.fresh && this.now() - this.lastReadAt < READ_CACHE_MS) {
			return this.merged();
		}
		let names: string[] = [];
		try {
			names = await readdir(this.dir);
		} catch {
			// まだ 1 つも書いていない
		}
		const records: SessionRecord[] = [];
		for (const name of names) {
			if (!name.endsWith('.json')) {
				continue;
			}
			try {
				const parsed = JSON.parse(await readFile(join(this.dir, name), 'utf8')) as SessionRecord;
				if (parsed?.sessionId && parsed.owner) {
					records.push(parsed);
				}
			} catch {
				// 書きかけ・壊れた記録は無かったことにする。台帳が読めないことを、動かない理由にしない
			}
		}
		this.lastRead = records;
		this.lastReadAt = this.now();
		return this.merged();
	}

	/**
	 * 読んだものと、自分がいま持っているものを重ねる。
	 * **自分の分はディスクより手元が新しい**（書き出しは間引いてある）ので、手元で上書きする。
	 */
	private merged(): SessionRecord[] {
		const others = this.lastRead.filter((record) => !this.mine.has(record.sessionId));
		return [...others, ...this.mine.values()];
	}

	/** このウィンドウが持っている記録 */
	own(): SessionRecord[] {
		return [...this.mine.values()];
	}

	/**
	 * 最後に読んだ横断の一覧。**同期で**参照したいところ（ステータスバー・板の枠計算）用。
	 * 他ウィンドウの読み直しは心拍のついでに行うので、最大でも心拍 1 回ぶんしか古くならない。
	 * 自分の分は常にいまの値。
	 */
	snapshot(): SessionRecord[] {
		return this.merged();
	}

	/** 読み直して覚える。始めてよいかを決める前など、古い数で判断したくないときに使う */
	async refresh(): Promise<SessionRecord[]> {
		return this.list({ fresh: true });
	}

	/**
	 * 自分の持ちものとして記録する（無ければ作る）。書き出しは間引かれる。
	 * @returns 更新後の記録
	 */
	upsert(
		sessionId: string,
		patch: Partial<Omit<SessionRecord, 'sessionId' | 'owner'>> & { cwd?: string }
	): SessionRecord {
		const at = this.now();
		const existing = this.mine.get(sessionId);
		const record: SessionRecord = {
			sessionId,
			status: patch.status ?? existing?.status ?? 'starting',
			cwd: patch.cwd ?? existing?.cwd ?? '',
			createdAt: existing?.createdAt ?? at,
			updatedAt: at,
			claudeSessionId: patch.claudeSessionId ?? existing?.claudeSessionId,
			model: patch.model ?? existing?.model,
			// 名前は**最初に頼んだこと**。後の発言で上書きすると、選ぶときの手がかりが消える
			title: existing?.title ?? patch.title,
			totalCostUsd: patch.totalCostUsd ?? existing?.totalCostUsd,
			owner: { windowId: this.windowId, pid: this.pid, heartbeatAt: at }
		};
		this.mine.set(sessionId, record);
		this.markDirty(sessionId);
		return record;
	}

	/** 記録を台帳から消す（セッションを忘れるとき） */
	async forget(sessionId: string): Promise<void> {
		this.mine.delete(sessionId);
		this.dirty.delete(sessionId);
		this.lastRead = this.lastRead.filter((record) => record.sessionId !== sessionId);
		this.lastReadAt = 0;
		try {
			await rm(join(this.dir, `${sessionId}.json`), { force: true });
		} catch (error) {
			this.log(`[sessions] 記録を消せませんでした: ${message(error)}`);
		}
	}

	/** 置き去りの記録を掃除する。持ち主がいないまま長く残ったものだけ落とす */
	async sweep(): Promise<number> {
		const records = await this.list({ fresh: true });
		const targets = forgettable(records, this.now()).filter((record) => !this.mine.has(record.sessionId));
		for (const record of targets) {
			try {
				await rm(join(this.dir, `${record.sessionId}.json`), { force: true });
			} catch {
				// 消せなくても実害はない（次回また拾う）
			}
		}
		if (targets.length > 0) {
			this.lastReadAt = 0;
		}
		return targets.length;
	}

	/** 溜まっている書き出しを今すぐ済ませる */
	async flush(): Promise<void> {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = undefined;
		}
		const targets = [...this.dirty];
		this.dirty.clear();
		if (targets.length === 0) {
			return;
		}
		try {
			await mkdir(this.dir, { recursive: true });
		} catch (error) {
			this.log(`[sessions] 置き場所を作れませんでした: ${message(error)}`);
			return;
		}
		for (const sessionId of targets) {
			const record = this.mine.get(sessionId);
			if (!record) {
				continue;
			}
			await this.write(record);
		}
	}

	/**
	 * このウィンドウの持ちものを手放す（閉じるとき）。
	 * 心拍を過去に倒しておくと、開き直したときに TTL を待たずに「続きから」を出せる（T-252）。
	 */
	async release(): Promise<void> {
		const at = this.now() - OWNER_TTL_MS * 2;
		for (const record of this.mine.values()) {
			record.owner = { ...record.owner, heartbeatAt: at };
			this.dirty.add(record.sessionId);
		}
		await this.flush();
	}

	dispose(): void {
		this.disposed = true;
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = undefined;
		}
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = undefined;
		}
	}

	private markDirty(sessionId: string): void {
		this.dirty.add(sessionId);
		// 他のウィンドウの分は読み直す。自分の分は merged() で常に手元が勝つ
		this.lastReadAt = 0;
		if (this.flushTimer || this.disposed) {
			return;
		}
		this.flushTimer = setTimeout(() => {
			this.flushTimer = undefined;
			void this.flush();
		}, FLUSH_DELAY_MS);
		this.flushTimer.unref?.();
	}

	/** 心拍。持っていることを示すだけなので、状態が動いていなくても書く */
	private beat(): void {
		if (this.mine.size > 0) {
			const at = this.now();
			for (const record of this.mine.values()) {
				record.owner = { ...record.owner, heartbeatAt: at };
				this.dirty.add(record.sessionId);
			}
			void this.flush();
		}
		// 他のウィンドウの動きも、心拍のついでに拾っておく（同期で参照できる形にしておくため）
		void this.list({ fresh: true });
	}

	/**
	 * 1 件書く。**同じ場所へ直接書かない** — 書いている途中に別のウィンドウが読むと、
	 * 尻切れの JSON を読むことになる。別名で書いてから置き換える（rename は不可分）。
	 */
	private async write(record: SessionRecord): Promise<void> {
		const target = join(this.dir, `${record.sessionId}.json`);
		const temporary = `${target}.${this.pid}.tmp`;
		try {
			await writeFile(temporary, `${JSON.stringify(record)}\n`, 'utf8');
			await rename(temporary, target);
		} catch (error) {
			this.log(`[sessions] 記録を書けませんでした: ${message(error)}`);
			try {
				await rm(temporary, { force: true });
			} catch {
				// 消せなくても次の書き込みで上書きされる
			}
		}
	}
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
