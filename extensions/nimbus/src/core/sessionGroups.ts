/**
 * タブ（セッションの束）と Home（tasks.md T-314）。
 *
 * 利用者とすり合わせた形: タブは **Nimbus のセッションを入れる自由な束**で、
 * フォルダやタスク板とは結合しない。サイドバーの縮小版コックピットは **Home** —
 * タブごとの束で全セッションと状態が見え、押すとその場で会話に切り替わる。
 *
 * ここは**判断だけ**。ファイルの読み書きは `src/groupStore.ts`、描画は webview 側。
 *
 * ## 既定タブ
 *
 * どの束にも入っていないセッションは**既定タブ「作業」**に入る。
 * タブという概念が増えても、既存のセッションが行き場を失わないため（後方互換）。
 * 既定タブは消せない — 消せると「未所属」という 2 つ目の行き場が要ることになり、
 * 概念が 1 つ増える。
 *
 * VS Code に依存しないので単体で検証できる。
 */

/** 既定タブの ID。定義が無くても常に在るものとして扱う */
export const DEFAULT_GROUP_ID = 'default';

/** 既定タブの表示名 */
export const DEFAULT_GROUP_NAME = '作業';

/** タブ名の長さの上限。狭いサイドバーで折り返しの洪水にしない */
export const MAX_GROUP_NAME = 30;

/** タブ 1 枚の定義 */
export interface SessionGroup {
	id: string;
	name: string;
	createdAt: number;
	/** 並び順。作った順を既定とし、並び替えはこの値で行う */
	order: number;
}

/** 永続化する形（`groups.json`）。定義と所属だけを持ち、セッションの中身は持たない */
export interface GroupsFile {
	groups: SessionGroup[];
	/** sessionId → groupId。ここに無いセッションは既定タブ */
	members: Record<string, string>;
}

/** 空の状態（ファイルがまだ無いとき） */
export function emptyGroups(): GroupsFile {
	return { groups: [], members: {} };
}

/**
 * 読み込んだ JSON を、壊れていても使える形に直す。
 *
 * 台帳と同じ方針 — 読めない部分は**黙って既定に倒す**のではなく、形として通る分だけ拾う。
 * ここで例外を投げると、groups.json が 1 か所壊れただけで Home ごと開かなくなる。
 */
export function normalizeGroups(raw: unknown): GroupsFile {
	const file = emptyGroups();
	if (!raw || typeof raw !== 'object') {
		return file;
	}
	const data = raw as { groups?: unknown; members?: unknown };
	if (Array.isArray(data.groups)) {
		for (const entry of data.groups) {
			if (!entry || typeof entry !== 'object') {
				continue;
			}
			const group = entry as Record<string, unknown>;
			if (typeof group['id'] !== 'string' || group['id'].length === 0 || group['id'] === DEFAULT_GROUP_ID) {
				// 既定タブの定義は保存させない（名前を変えられると「未所属の行き場」が揺れる）
				continue;
			}
			if (typeof group['name'] !== 'string') {
				continue;
			}
			file.groups.push({
				id: group['id'],
				name: group['name'],
				createdAt: typeof group['createdAt'] === 'number' ? group['createdAt'] : 0,
				order: typeof group['order'] === 'number' ? group['order'] : file.groups.length
			});
		}
	}
	if (data.members && typeof data.members === 'object') {
		for (const [sessionId, groupId] of Object.entries(data.members as Record<string, unknown>)) {
			if (typeof groupId === 'string' && groupId.length > 0) {
				file.members[sessionId] = groupId;
			}
		}
	}
	return file;
}

/**
 * タブ名として通るかを検査し、通る形にして返す。通らなければ undefined。
 *
 * - 空白だけの名前は無い（見えないタブになる）
 * - 長すぎる名前は切らずに**断る**。黙って切ると「付けた名前と違う」が起きる
 * - 同名は許す（区別は利用者の自由。禁止すると「作業 2」を強いることになる）
 */
export function normalizeGroupName(name: string): string | undefined {
	const trimmed = name.replace(/\s+/g, ' ').trim();
	if (trimmed.length === 0 || trimmed.length > MAX_GROUP_NAME) {
		return undefined;
	}
	return trimmed;
}

/** タブを足す。名前が通らなければ何もしない */
export function addGroup(file: GroupsFile, id: string, name: string, createdAt: number): GroupsFile {
	const normalized = normalizeGroupName(name);
	if (!normalized || file.groups.some((group) => group.id === id)) {
		return file;
	}
	const order = file.groups.reduce((max, group) => Math.max(max, group.order), -1) + 1;
	return {
		...file,
		groups: [...file.groups, { id, name: normalized, createdAt, order }]
	};
}

/** タブを改名する。既定タブと、名前が通らないときは何もしない */
export function renameGroup(file: GroupsFile, id: string, name: string): GroupsFile {
	const normalized = normalizeGroupName(name);
	if (!normalized || id === DEFAULT_GROUP_ID) {
		return file;
	}
	if (!file.groups.some((group) => group.id === id)) {
		return file;
	}
	return {
		...file,
		groups: file.groups.map((group) => (group.id === id ? { ...group, name: normalized } : group))
	};
}

/**
 * タブを消す。**中のセッションは消さず、既定タブへ移す**。
 *
 * タブは束であって持ち主ではない。束を畳んだらセッションごと消える、は
 * 取り返しがつかなすぎる（人間工学 E3 — 取り消せない結果を、軽い操作に載せない）。
 */
export function removeGroup(file: GroupsFile, id: string): GroupsFile {
	if (id === DEFAULT_GROUP_ID || !file.groups.some((group) => group.id === id)) {
		return file;
	}
	const members: Record<string, string> = {};
	for (const [sessionId, groupId] of Object.entries(file.members)) {
		if (groupId !== id) {
			members[sessionId] = groupId;
		}
		// 消したタブの所属は落とす = 既定タブへ戻る
	}
	return {
		groups: file.groups.filter((group) => group.id !== id),
		members
	};
}

/** セッションをタブへ入れる。既定タブへは所属を消すことで入れる（余計な記録を残さない） */
export function assignSession(file: GroupsFile, sessionId: string, groupId: string): GroupsFile {
	if (groupId === DEFAULT_GROUP_ID) {
		if (!(sessionId in file.members)) {
			return file;
		}
		const members = { ...file.members };
		delete members[sessionId];
		return { ...file, members };
	}
	if (!file.groups.some((group) => group.id === groupId)) {
		return file;
	}
	return { ...file, members: { ...file.members, [sessionId]: groupId } };
}

/** このセッションが入っているタブ。定義が消えていれば既定タブ */
export function groupOf(file: GroupsFile, sessionId: string): string {
	const groupId = file.members[sessionId];
	if (!groupId || !file.groups.some((group) => group.id === groupId)) {
		return DEFAULT_GROUP_ID;
	}
	return groupId;
}

/** Home に出す束 1 つ。中身は呼び出し側の型（セッションのタブ表示）をそのまま持つ */
export interface HomeGroup<T> {
	id: string;
	name: string;
	/** 既定タブか（改名・削除の操作を出さない目印） */
	isDefault: boolean;
	sessions: T[];
}

/**
 * Home の束を組み立てる。**空のタブも出す** — 作った直後のタブが見えないと、
 * 「作れたのか」が分からない（T-244）。並びは 既定タブ → order 順。
 */
export function buildHome<T extends { sessionId: string }>(
	file: GroupsFile,
	sessions: readonly T[]
): HomeGroup<T>[] {
	const byGroup = new Map<string, T[]>();
	for (const session of sessions) {
		const groupId = groupOf(file, session.sessionId);
		const list = byGroup.get(groupId);
		if (list) {
			list.push(session);
		} else {
			byGroup.set(groupId, [session]);
		}
	}
	const home: HomeGroup<T>[] = [
		{
			id: DEFAULT_GROUP_ID,
			name: DEFAULT_GROUP_NAME,
			isDefault: true,
			sessions: byGroup.get(DEFAULT_GROUP_ID) ?? []
		}
	];
	for (const group of [...file.groups].sort((a, b) => a.order - b.order)) {
		home.push({ id: group.id, name: group.name, isDefault: false, sessions: byGroup.get(group.id) ?? [] });
	}
	return home;
}

/**
 * 消えたセッションの所属を掃除する。
 * 台帳の `sweep()` と同じ発想 — 残っていても実害は無いが、育つ一方のものは刈る。
 */
export function pruneMembers(file: GroupsFile, liveSessionIds: ReadonlySet<string>): GroupsFile {
	const members: Record<string, string> = {};
	let changed = false;
	for (const [sessionId, groupId] of Object.entries(file.members)) {
		if (liveSessionIds.has(sessionId)) {
			members[sessionId] = groupId;
		} else {
			changed = true;
		}
	}
	return changed ? { ...file, members } : file;
}
