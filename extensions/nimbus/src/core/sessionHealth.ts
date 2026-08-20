/**
 * セッションの残骸を見分ける（tasks.md T-303）。
 *
 * 台帳には 1 セッション 1 ファイルで記録が残る（`sessionStore.ts`）。持ち主は心拍で決まるので、
 * ウィンドウが落ちると**持ち主のいない記録がそのまま残る**。数が増えても誰も困らないが、
 * 「いま何本走っているのか」が分からなくなり、復帰の候補（T-252）にも紛れる。
 *
 * **判定は増やさない。** 生きている / 走っている / 忘れてよい の判断は
 * `sessionRegistry.ts` が既に持っているので、ここはそれを**組み合わせて仕分けるだけ**。
 *
 * **消す判断はしない。** 数えて見せるところまでで、消すかどうかは呼び出し側（人）が決める。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import {
	FORGET_AFTER_MS,
	OWNER_TTL_MS,
	forgettable,
	isFinishedStatus,
	isOwnerAlive,
	isRunningStatus,
	type SessionRecord
} from './sessionRegistry';

/** 記録 1 件の見立て */
export type SessionHealth =
	/** 持ち主が生きていて、いま走っている */
	| 'running'
	/** 持ち主は生きているが、走ってはいない（入力待ちなど） */
	| 'idle'
	/** 終わっている。復帰の候補として残るのは**正常** */
	| 'finished'
	/** 持ち主がいないのに終わってもいない。**これが残骸** */
	| 'orphaned'
	/** 持ち主がいないまま古くなった。もう残す意味がない */
	| 'forgettable';

export interface HealthOptions {
	/** 心拍が切れたと見なすまで */
	ttlMs?: number;
	/** 持ち主のいない記録を「忘れてよい」と見なすまで */
	forgetAfterMs?: number;
}

/**
 * 1 件を仕分ける。**古いものが先**（忘れてよいものは、残骸として数え直さない）。
 */
export function classifySession(record: SessionRecord, now: number, options?: HealthOptions): SessionHealth {
	const ttlMs = options?.ttlMs ?? OWNER_TTL_MS;
	const forgetAfterMs = options?.forgetAfterMs ?? FORGET_AFTER_MS;
	const alive = isOwnerAlive(record, now, ttlMs);

	if (!alive && now - record.updatedAt > forgetAfterMs) {
		return 'forgettable';
	}
	if (isFinishedStatus(record.status)) {
		return 'finished';
	}
	if (!alive) {
		// 走っていようが入力待ちだろうが、持ち主がいなければ誰も面倒を見ていない
		return 'orphaned';
	}
	return isRunningStatus(record.status) ? 'running' : 'idle';
}

/** 同じフォルダを、生きている持ち主が 2 つ以上で持っている状態 */
export interface CwdOverlap {
	cwd: string;
	sessionIds: string[];
}

/**
 * 重なりを探す。
 *
 * `sessionRegistry.overlappingSessions` は「**自分から見て**他が重なっているか」を見るもので、
 * 横断の点検には向かない（自分がいない）。ここは台帳全体を突き合わせる。
 * 判定に使う「生きているか」は同じ関数を通す。
 */
export function overlaps(
	records: readonly SessionRecord[],
	now: number,
	options?: HealthOptions
): CwdOverlap[] {
	const ttlMs = options?.ttlMs ?? OWNER_TTL_MS;
	const byCwd = new Map<string, string[]>();
	for (const record of records) {
		if (!isOwnerAlive(record, now, ttlMs) || isFinishedStatus(record.status)) {
			continue;
		}
		const found = byCwd.get(record.cwd);
		if (found) {
			found.push(record.sessionId);
		} else {
			byCwd.set(record.cwd, [record.sessionId]);
		}
	}
	return [...byCwd.entries()]
		.filter(([, ids]) => ids.length > 1)
		.map(([cwd, sessionIds]) => ({ cwd, sessionIds }));
}

export interface HealthReport {
	counts: Record<SessionHealth, number>;
	/** 持ち主がいないのに終わってもいない記録。**引き取るか、消すか**を決める対象 */
	orphaned: SessionRecord[];
	/** 古くなって、もう残す意味のない記録 */
	forgettable: SessionRecord[];
	/** 同じフォルダを生きた持ち主が 2 つ以上で持っている */
	overlaps: CwdOverlap[];
	total: number;
}

/** 台帳ぜんぶを見て、数えて返す */
export function inspectLedger(
	records: readonly SessionRecord[],
	now: number,
	options?: HealthOptions
): HealthReport {
	const counts: Record<SessionHealth, number> = {
		running: 0,
		idle: 0,
		finished: 0,
		orphaned: 0,
		forgettable: 0
	};
	const orphaned: SessionRecord[] = [];
	for (const record of records) {
		const health = classifySession(record, now, options);
		counts[health] += 1;
		if (health === 'orphaned') {
			orphaned.push(record);
		}
	}
	return {
		counts,
		orphaned,
		// 「忘れてよい」の判断は台帳側と同じものを使う（ここで別の線を引かない）
		forgettable: forgettable(records, now, options),
		overlaps: overlaps(records, now, options),
		total: records.length
	};
}

/** 直すところがあるか。無ければ黙っていてよい */
export function needsAttention(report: HealthReport): boolean {
	return report.orphaned.length > 0 || report.forgettable.length > 0 || report.overlaps.length > 0;
}

/** 人が読む 1 行。**数を出す** — 「残骸があります」だけでは、何件かが分からない */
export function summaryLine(report: HealthReport): string {
	if (report.total === 0) {
		return '台帳は空です（記録なし）。';
	}
	const parts = [
		`走行中 ${report.counts.running}`,
		`待機 ${report.counts.idle}`,
		`終了 ${report.counts.finished}`
	];
	if (report.counts.orphaned > 0) {
		parts.push(`**持ち主なし ${report.counts.orphaned}**`);
	}
	if (report.counts.forgettable > 0) {
		parts.push(`忘れてよい ${report.counts.forgettable}`);
	}
	if (report.overlaps.length > 0) {
		parts.push(`重なり ${report.overlaps.length}`);
	}
	return `${report.total} 件 — ${parts.join(' / ')}`;
}
