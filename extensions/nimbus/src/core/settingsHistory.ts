/**
 * 設定のバージョン管理（tasks.md T-095）。
 *
 * スキルや CLAUDE.md を直したあと「前のほうが良かった」と思っても、戻せない。
 * Git に入っていれば済む話だが、**`.claude/` を commit していないプロジェクトは多い**
 * （個人の設定と混ざるため）。せめて Nimbus 側で世代を持つ。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface Snapshot {
	/** ISO 8601 */
	at: string;
	/** `.claude/` からの相対パス */
	path: string;
	content: string;
	/** 何をしたときの控えか */
	reason: string;
}

/** 1 ファイルあたりに残す世代数。多すぎても選べない */
export const MAX_PER_FILE = 10;

/**
 * 控えを足す。
 * **中身が同じなら足さない** — 同じものが並ぶと、どれが違うのか分からなくなる。
 */
export function addSnapshot(history: readonly Snapshot[], snapshot: Snapshot): Snapshot[] {
	const forFile = history.filter((item) => item.path === snapshot.path);
	const latest = forFile[forFile.length - 1];
	if (latest && latest.content === snapshot.content) {
		return [...history];
	}
	const others = history.filter((item) => item.path !== snapshot.path);
	// 古いものから落とす
	const kept = [...forFile, snapshot].slice(-MAX_PER_FILE);
	return [...others, ...kept];
}

/** そのファイルの世代を新しい順に */
export function historyFor(history: readonly Snapshot[], path: string): Snapshot[] {
	return history.filter((item) => item.path === path).reverse();
}

/** 控えのあるファイル。新しく触ったものが上 */
export function trackedFiles(history: readonly Snapshot[]): { path: string; count: number; latestAt: string }[] {
	const byPath = new Map<string, Snapshot[]>();
	for (const item of history) {
		byPath.set(item.path, [...(byPath.get(item.path) ?? []), item]);
	}
	return [...byPath.entries()]
		.map(([path, items]) => ({
			path,
			count: items.length,
			latestAt: items[items.length - 1].at
		}))
		.sort((a, b) => b.latestAt.localeCompare(a.latestAt));
}

/** 世代 1 件の説明。**何行変わったか**が分かると、戻す先を選べる */
export function describeSnapshot(snapshot: Snapshot, previous: Snapshot | undefined): string {
	const when = snapshot.at.slice(0, 16).replace('T', ' ');
	if (!previous) {
		return `${when} · ${snapshot.reason}（最初の控え）`;
	}
	const before = previous.content.split('\n').length;
	const after = snapshot.content.split('\n').length;
	const delta = after - before;
	const change = delta === 0 ? '行数は同じ' : delta > 0 ? `+${delta} 行` : `${delta} 行`;
	return `${when} · ${snapshot.reason} · ${change}`;
}
