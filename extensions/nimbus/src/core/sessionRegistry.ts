/**
 * セッションの台帳 — プロセスをまたいで「誰が何を持っているか」を決める
 * （tasks.md T-247 / T-251 / T-252 / T-253）。
 *
 * `session/SessionManager.ts` の `Map` は**そのウィンドウの中にしか無い**。
 * ウィンドウ（＝拡張ホスト）ごとに別の SessionManager が立つので、
 * - 落ちたら、走っていたセッションは誰からも見えなくなる（T-252）
 * - 同じセッションを 2 つのウィンドウから触れてしまう（T-247）
 * - 「今いくつ走っているか」がウィンドウの中でしか数えられない（T-251）
 * - 同じフォルダを別のウィンドウが編集していても気づけない（T-253）
 *
 * ここはその 4 つを**判断だけ**にしたもの。読み書き（＝ファイル）は `src/sessionStore.ts`。
 *
 * ## 持ち主の決めかた
 *
 * ロックを「取ったら離すもの」にすると、落ちたときに離されず、誰も触れない記録が残る。
 * そこで**心拍（heartbeat）で持つ** — 持ち主は一定間隔で時刻を書き直し、
 * 途切れたら「手放した」と見なす。落ちても壊れない代わりに、
 * 奪えるようになるまで最大 `OWNER_TTL_MS` かかる。止まったものを触れないより、その方がよい。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { SessionStatus } from '../events';

/** 心拍の間隔。持ち主が生きていることを、この間隔で書き直す */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/** 心拍が途切れてから「持ち主はいない」と見なすまで。間隔の 4 倍（負荷で 1〜2 回飛んでも奪わない） */
export const OWNER_TTL_MS = 20_000;

/** 持ち主のいない記録を台帳から落とすまで。復帰（T-252）の候補として残しておく期間 */
export const FORGET_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** 台帳に置く、ウィンドウ（拡張ホスト）1 つ分の印 */
export interface SessionOwner {
	/** 拡張ホストの起動ごとに作る ID。ウィンドウを一意にする */
	windowId: string;
	/** 同じ windowId を別プロセスが名乗っていないことの裏取り */
	pid: number;
	/** 最後に心拍を書いた時刻 */
	heartbeatAt: number;
}

/** 1 セッション分の、プロセスをまたいで残る記録 */
export interface SessionRecord {
	/** Nimbus 内部 ID（イベントのキー） */
	sessionId: string;
	/** 続きから開くための鍵（T-252）。session-init が来るまでは無い */
	claudeSessionId?: string;
	status: SessionStatus;
	cwd: string;
	model?: string;
	/** 最初に頼んだこと。復帰の選択肢に出すので 1 行に畳んである */
	title?: string;
	createdAt: number;
	/** 最後に状態が動いた時刻（心拍とは別。並べ替えに使う） */
	updatedAt: number;
	totalCostUsd?: number;
	owner: SessionOwner;
}

/**
 * 台帳から読んだものが、**画面に出せる形**をしているか（T-347）。
 *
 * 台帳はプロセスの外にある — 別ウィンドウ・別バージョン・手編集が書きうる。
 * `SessionStore.list` は「壊れた記録は数に入れず読み飛ばす」と宣言しているのに、
 * 見ていたのは `sessionId` と `owner` が**真か**だけだった。そのため
 * `sessionId: 123` のような型違いが素通りし、一覧を組む側の
 * `record.sessionId.slice(0, 8)` が TypeError を投げて、**セッション一覧そのものが
 * 開かなくなる**（無事な記録まで巻き添えで見えなくなる）。敵対的試験 adv-01 で顕在化した。
 *
 * 必ず要るのは 2 つだけ（`sessionId` と `owner`）。他は**在るなら型が合っていること**を見る —
 * 欠けているだけの記録を、ここで新たに隠さないため。
 */
export function isSessionRecord(value: unknown): value is SessionRecord {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.sessionId !== 'string' || record.sessionId.length === 0) {
		return false;
	}
	if (typeof record.owner !== 'object' || record.owner === null || Array.isArray(record.owner)) {
		return false;
	}
	for (const key of ['claudeSessionId', 'status', 'cwd', 'model', 'title']) {
		if (record[key] !== undefined && typeof record[key] !== 'string') {
			return false;
		}
	}
	for (const key of ['createdAt', 'updatedAt', 'totalCostUsd']) {
		if (record[key] !== undefined && typeof record[key] !== 'number') {
			return false;
		}
	}
	return true;
}

/** 同時実行の枠を使っている状態か。入力待ちは人間の番なので数えない */
export function isRunningStatus(status: SessionStatus): boolean {
	return status === 'starting' || status === 'running';
}

/** 終わった状態か */
export function isFinishedStatus(status: SessionStatus): boolean {
	return status === 'completed' || status === 'error';
}

/** 持ち主が生きているか（心拍が TTL 以内か） */
export function isOwnerAlive(record: SessionRecord, now: number, ttlMs = OWNER_TTL_MS): boolean {
	return now - record.owner.heartbeatAt < ttlMs;
}

/** この記録を自分（このウィンドウ）が持っているか */
export function isMine(record: SessionRecord, windowId: string): boolean {
	return record.owner.windowId === windowId;
}

/**
 * 他のウィンドウが**生きたまま**持っているか。
 * true のものへ送信・中断をかけてはいけない（二重操作になる）。
 */
export function heldByOther(record: SessionRecord, windowId: string, now: number, ttlMs = OWNER_TTL_MS): boolean {
	return !isMine(record, windowId) && isOwnerAlive(record, now, ttlMs);
}

/** いま走っているセッション（全ウィンドウ合計）。持ち主が死んでいるものは走っていない */
export function runningSessions(records: readonly SessionRecord[], now: number, ttlMs = OWNER_TTL_MS): SessionRecord[] {
	return records.filter((record) => isRunningStatus(record.status) && isOwnerAlive(record, now, ttlMs));
}

export interface Admission {
	/** 新しく始めてよいか */
	allowed: boolean;
	/** いま走っている数（全ウィンドウ合計） */
	running: number;
	limit: number;
	/** 断るときに画面へ出す理由 */
	reason?: string;
	/** 自分以外のウィンドウが走らせている数（「他の窓が使っている」を言うため） */
	elsewhere: number;
}

/**
 * 新しいセッションを始めてよいかを、**1 か所で**決める（T-251）。
 *
 * F4 のタスクキューは自分が起こしたタスクしか数えていないので、
 * コックピットから直に始めたセッションや、別ウィンドウのセッションが枠の外にいた。
 * 台帳を数えれば、どこから起きたものでも同じ 1 つの上限に収まる。
 *
 * `limit` が 0 以下なら上限なしとして扱う（設定で外せるようにしておく）。
 */
export function admit(
	records: readonly SessionRecord[],
	options: { limit: number; windowId: string; now: number; ttlMs?: number }
): Admission {
	const ttlMs = options.ttlMs ?? OWNER_TTL_MS;
	const running = runningSessions(records, options.now, ttlMs);
	const elsewhere = running.filter((record) => !isMine(record, options.windowId)).length;
	if (options.limit <= 0) {
		return { allowed: true, running: running.length, limit: options.limit, elsewhere };
	}
	if (running.length < options.limit) {
		return { allowed: true, running: running.length, limit: options.limit, elsewhere };
	}
	const where = elsewhere > 0 ? `（うち ${elsewhere} 件は別のウィンドウ）` : '';
	return {
		allowed: false,
		running: running.length,
		limit: options.limit,
		elsewhere,
		reason: `同時に走らせる上限（${options.limit}）に達しています${where}。どれかが終わってから始めてください`
	};
}

/** ステータスバーなどに出す 1 行。上限に近いことは、詰まる前に見えていてほしい */
export function describeRunning(running: number, limit: number): string {
	return limit <= 0 ? `走っているセッション ${running}` : `走っているセッション ${running}/${limit}`;
}

/**
 * 「続きから」を出せる記録（T-252）。
 *
 * 条件は 3 つ — **持ち主がいない**（生きているものを横取りしない）、
 * **終わっていない**、**Claude 側の session_id がある**（無いと再開できない）。
 * 新しい順に返す。
 *
 * @param cwd 指定すると、その配下のセッションだけを返す（別プロジェクトの続きは出さない）
 */
export function resumeCandidates(
	records: readonly SessionRecord[],
	options: { now: number; ttlMs?: number; cwd?: string }
): SessionRecord[] {
	const ttlMs = options.ttlMs ?? OWNER_TTL_MS;
	return records
		.filter((record) => !isOwnerAlive(record, options.now, ttlMs))
		.filter((record) => !isFinishedStatus(record.status))
		.filter((record) => Boolean(record.claudeSessionId))
		.filter((record) => !options.cwd || pathOverlap(record.cwd, options.cwd) !== undefined)
		.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** パスの重なりかた（自分から見た相手） */
export type PathOverlap =
	/** 同じフォルダ */
	| 'same'
	/** 自分の中に相手がいる */
	| 'contains'
	/** 相手の中に自分がいる */
	| 'contained';

/** 末尾の区切りを落として比べられる形にする */
function normalizePath(value: string): string {
	const trimmed = value.replace(/[\\/]+$/, '');
	return trimmed.length > 0 ? trimmed : '/';
}

/**
 * 2 つの作業ディレクトリが重なっているか。
 * 重ならなければ undefined。文字の前方一致だけで見ると `/w/app` と `/w/app2` を
 * 重なりと誤判定するので、区切りの境目まで見る。
 */
export function pathOverlap(a: string, b: string): PathOverlap | undefined {
	const left = normalizePath(a);
	const right = normalizePath(b);
	if (left === right) {
		return 'same';
	}
	if (right.startsWith(`${left}/`) || right.startsWith(`${left}\\`)) {
		return 'contains';
	}
	if (left.startsWith(`${right}/`) || left.startsWith(`${right}\\`)) {
		return 'contained';
	}
	return undefined;
}

export interface OverlapHit {
	record: SessionRecord;
	overlap: PathOverlap;
}

/**
 * 同じ場所を触っている、生きた他セッション（T-253）。
 *
 * 同じフォルダを 2 つのセッションが同時に編集すると、**片方の前提が黙って壊れる** —
 * 読んだ内容が、書く頃には別物になっている。コンフリクトとして出るならまだよく、
 * 出ないまま矛盾したコードになるほうが困る。だから始める前に言う。
 */
export function overlappingSessions(
	records: readonly SessionRecord[],
	options: { cwd: string; windowId: string; now: number; ttlMs?: number; ignoreSessionId?: string }
): OverlapHit[] {
	const ttlMs = options.ttlMs ?? OWNER_TTL_MS;
	const hits: OverlapHit[] = [];
	for (const record of records) {
		if (record.sessionId === options.ignoreSessionId) {
			continue;
		}
		if (!isOwnerAlive(record, options.now, ttlMs) || isFinishedStatus(record.status)) {
			continue;
		}
		const overlap = pathOverlap(options.cwd, record.cwd);
		if (overlap) {
			hits.push({ record, overlap });
		}
	}
	return hits;
}

/**
 * 重なりの知らせ（T-253）。**止めはしない** — 意図してやることもあるので、
 * 何が起きるかと、避けかた（worktree）を添えて判断を返す。
 */
export function describeOverlap(hits: readonly OverlapHit[]): string | undefined {
	if (hits.length === 0) {
		return undefined;
	}
	const other = hits.length === 1 ? '別のセッション' : `別の ${hits.length} セッション`;
	const where = hits[0].overlap === 'same' ? '同じフォルダ' : '重なるフォルダ';
	return `${other}が${where}で動いています（${hits[0].record.cwd}）。同時に編集すると、`
		+ '片方が読んだ内容が黙って古くなります。分けて進めるなら worktree を切ってください';
}

/** 台帳から落としてよい記録（持ち主がいないまま置き去りになったもの） */
export function forgettable(
	records: readonly SessionRecord[],
	now: number,
	options?: { ttlMs?: number; forgetAfterMs?: number }
): SessionRecord[] {
	const ttlMs = options?.ttlMs ?? OWNER_TTL_MS;
	const forgetAfterMs = options?.forgetAfterMs ?? FORGET_AFTER_MS;
	/*
	 * **「最後に生きていた時刻」は `updatedAt` だけでは決まらない**（T-374・Codex の指摘 2026-09-01）。
	 *
	 * 心拍（`beat()`）は `owner.heartbeatAt` だけを進め、`updatedAt` は触らない。
	 * だから「7 日以上 `awaiting-input` のまま窓を開けっぱなしにしていたセッション」は、
	 * 直前まで心拍が打たれていても `updatedAt` は 7 日前のまま。閉じて開き直すと、
	 * 復元候補を作るより先に `sweep()` が消してしまう ＝ **開いていたものが消える**（T-368 と同じ形）。
	 * 心拍も含めた最後の生存時刻で測る。
	 */
	return records.filter(
		(record) =>
			!isOwnerAlive(record, now, ttlMs) &&
			now - Math.max(record.updatedAt, record.owner.heartbeatAt) > forgetAfterMs
	);
}
