/**
 * スキル・サブエージェントの共有（tasks.md T-070）。
 *
 * 「マーケット」と言っても、**新しい仕組みは足さない**。
 * 配る中身は T-043 の配布物（`core/bundle.ts`）そのままで、
 * 足りないのは「**どこに何があるか**」の一覧だけ。
 *
 * 一覧は JSON を 1 枚置くだけにする（`https` のどこかに置ける）。
 * サーバーも登録も要らないので、GitHub Pages でも Gist でも成立する。
 * OSS として出す方向とはこの形がいちばん噛み合う。
 *
 * VS Code に依存しないので単体で検証できる。
 */

/** 一覧に並ぶ 1 件 */
export interface MarketEntry {
	/** 一覧の中で一意な名前 */
	id: string;
	name: string;
	description: string;
	/** 配布物（`core/bundle.ts` が読める JSON）の場所。`https` のみ */
	url: string;
	/** 誰が出しているか。**必ず要る** — 出どころの分からないものを入れさせない */
	author: string;
	/** 何が入っているか。中身を開く前に分かるようにする */
	contains?: { skills?: number; agents?: number; commands?: number };
	/** 探すための言葉 */
	tags?: string[];
	updated?: string;
}

export interface Market {
	name: string;
	entries: MarketEntry[];
}

export type MarketCheck = { ok: true; market: Market } | { ok: false; reason: string };

/** 1 枚の一覧に載せてよい数。多すぎると選べないし、読み込みも重い */
const MAX_ENTRIES = 500;

function isHttps(url: string): boolean {
	try {
		return new URL(url).protocol === 'https:';
	} catch {
		return false;
	}
}

/**
 * 一覧を読む。
 *
 * **形が違うものは、途中まで読んで使わない。** 一部だけ壊れた一覧を
 * 部分的に受け入れると、「入れたつもりが入っていない」が起きる。
 * 何行目がどう違うのかまで言う（一覧を書く側が直せるように）。
 */
export function parseMarket(text: string): MarketCheck {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { ok: false, reason: 'JSON として読めません' };
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return { ok: false, reason: '一覧はオブジェクトである必要があります' };
	}
	const source = raw as { name?: unknown; entries?: unknown };
	if (typeof source.name !== 'string' || source.name.trim().length === 0) {
		return { ok: false, reason: 'name がありません' };
	}
	if (!Array.isArray(source.entries)) {
		return { ok: false, reason: 'entries が配列ではありません' };
	}
	if (source.entries.length > MAX_ENTRIES) {
		return { ok: false, reason: `entries が多すぎます（${MAX_ENTRIES} 件まで）` };
	}

	const entries: MarketEntry[] = [];
	const seen = new Set<string>();
	for (const [index, item] of source.entries.entries()) {
		const at = `entries[${index}]`;
		if (!item || typeof item !== 'object') {
			return { ok: false, reason: `${at} がオブジェクトではありません` };
		}
		const entry = item as Record<string, unknown>;
		for (const field of ['id', 'name', 'description', 'url', 'author'] as const) {
			if (typeof entry[field] !== 'string' || (entry[field] as string).trim().length === 0) {
				return { ok: false, reason: `${at}.${field} がありません` };
			}
		}
		const id = (entry['id'] as string).trim();
		if (seen.has(id)) {
			return { ok: false, reason: `${at}.id が重複しています: ${id}` };
		}
		seen.add(id);
		// **https だけを通す。** ここを緩めると、一覧を差し替えるだけで
		// 任意の場所から設定を入れさせられる
		const url = (entry['url'] as string).trim();
		if (!isHttps(url)) {
			return { ok: false, reason: `${at}.url は https だけを受け付けます: ${url}` };
		}
		entries.push({
			id,
			name: (entry['name'] as string).trim(),
			description: (entry['description'] as string).trim(),
			url,
			author: (entry['author'] as string).trim(),
			contains: entry['contains'] as MarketEntry['contains'],
			tags: Array.isArray(entry['tags']) ? (entry['tags'] as unknown[]).map(String) : undefined,
			updated: typeof entry['updated'] === 'string' ? entry['updated'] : undefined
		});
	}
	return { ok: true, market: { name: source.name.trim(), entries } };
}

/** 言葉で絞る。名前・説明・作者・タグのどれかに当たれば拾う */
export function search(entries: readonly MarketEntry[], query: string): MarketEntry[] {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) {
		return [...entries];
	}
	return entries.filter((entry) =>
		[entry.name, entry.description, entry.author, ...(entry.tags ?? [])]
			.join(' ')
			.toLowerCase()
			.includes(needle)
	);
}

/** 一覧に出す 1 行。**中身と出どころを必ず添える**（開く前に判断できるように） */
export function describeEntry(entry: MarketEntry): string {
	const parts: string[] = [];
	const contains = entry.contains;
	if (contains) {
		if (contains.skills) {
			parts.push(`スキル ${contains.skills}`);
		}
		if (contains.agents) {
			parts.push(`サブエージェント ${contains.agents}`);
		}
		if (contains.commands) {
			parts.push(`コマンド ${contains.commands}`);
		}
	}
	const what = parts.length > 0 ? parts.join(' / ') : '中身の記載なし';
	return `${entry.author} · ${what}${entry.updated ? ` · ${entry.updated}` : ''}`;
}

/**
 * 既定の一覧。
 *
 * **空にしておく。** 出荷時にどこかを指しておくと、
 * 「Nimbus が推している」ことになってしまう。誰の一覧を見るかは利用者が決める。
 */
export const DEFAULT_MARKET_URLS: readonly string[] = [];

/**
 * 入れる前に見せる警告。
 *
 * 配布物には `settings.json` が入りうる（`core/bundle.ts` の `BUNDLED_FILES`）。
 * つまり**他人の設定でこちらの承認方針が変わりうる**。
 * T-043 の取り込みは差分を見せてから当てるが、
 * **出どころが他人であることは、その前に言っておく**。
 */
export function installWarning(entry: MarketEntry): string {
	return [
		`${entry.name}（${entry.author}）を入れます。`,
		'',
		'配布物にはスキル・サブエージェント・コマンドのほか、',
		'**設定（settings.json）が含まれることがあります**。',
		'設定には承認の方針が含まれるので、中身を見てから入れてください。',
		'',
		`取得元: ${entry.url}`
	].join('\n');
}
