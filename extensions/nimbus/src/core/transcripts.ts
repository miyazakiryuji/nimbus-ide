/**
 * 過去セッションの横断検索（tasks.md T-034）。
 *
 * 「あの実装どうやったっけ」を思い出す手段が、Claude Code 単体だと事実上無い。
 * 自前で会話を貯め直す前に、**Claude Code 本体が既に残しているもの**を読む。
 * 記録は `~/.claude/projects/<作業ディレクトリを潰した名前>/<セッションID>.jsonl` にある。
 *
 * ここはファイルを読む以外の判断（検索・絞り込み・抜粋）をすべて純粋な関数にしてあるので、
 * 拡張ホストなしで検証できる。
 */

export interface TranscriptEntry {
	role: 'user' | 'assistant';
	text: string;
	/** ISO 文字列。無いこともある */
	timestamp?: string;
	/** このターンで使われたツール名 */
	tools: string[];
	/** このターンで触れたファイルパス */
	files: string[];
}

export interface TranscriptMatch {
	entry: TranscriptEntry;
	/** どのセッションの記録か（ファイル名から取った ID） */
	sessionId: string;
	/** 一致した箇所の前後を切り出したもの */
	snippet: string;
}

export interface SearchQuery {
	/** すべて含まれることを求める語 */
	terms: string[];
	/** `file:` で絞る（部分一致） */
	file?: string;
	/** `tool:` で絞る（前方一致・大文字小文字を無視） */
	tool?: string;
}

/**
 * 作業ディレクトリから記録の置き場を作る。
 * Claude Code は区切り文字・ドット・アンダースコアを `-` に潰した名前を使う。
 * （実測: `/Users/x/…/10_products/Nimbus` → `-Users-x-…-10-products-Nimbus`。
 * アンダースコアも潰れるので、ここを外すとこのリポジトリの記録が 1 件も引けない）
 */
export function projectDirName(cwd: string): string {
	return cwd.replace(/[/\\._]/g, '-');
}

/** ツール呼び出しの入力からファイルパスらしきものを拾う */
function filesFromToolInput(input: unknown): string[] {
	if (typeof input !== 'object' || input === null) {
		return [];
	}
	const found: string[] = [];
	for (const key of ['file_path', 'notebook_path', 'path']) {
		const value = (input as Record<string, unknown>)[key];
		if (typeof value === 'string' && value.length > 0) {
			found.push(value);
		}
	}
	return found;
}

/**
 * JSONL を 1 行ずつ読む。
 * 壊れた行・知らない種別は黙って飛ばす（記録は Nimbus が書いたものではないので、
 * 形が変わっても検索が全部止まらないようにする）。
 */
export function parseTranscript(jsonl: string): TranscriptEntry[] {
	const entries: TranscriptEntry[] = [];
	for (const line of jsonl.split('\n')) {
		if (line.trim().length === 0) {
			continue;
		}
		let record: Record<string, unknown>;
		try {
			record = JSON.parse(line) as Record<string, unknown>;
		} catch {
			continue;
		}
		const type = record['type'];
		if (type !== 'user' && type !== 'assistant') {
			continue;
		}
		// サブエージェントの発言（isSidechain）と内部用の行（isMeta）は結果を汚すので落とす。
		// 探しているのは「自分が何を頼んだか」「Claude が何を返したか」のほう
		if (record['isSidechain'] === true || record['isMeta'] === true) {
			continue;
		}
		const message = record['message'] as { content?: unknown } | undefined;
		const content = message?.content;
		const texts: string[] = [];
		const tools: string[] = [];
		const files: string[] = [];

		if (typeof content === 'string') {
			texts.push(content);
		} else if (Array.isArray(content)) {
			for (const block of content) {
				if (typeof block !== 'object' || block === null) {
					continue;
				}
				const b = block as Record<string, unknown>;
				if (b['type'] === 'text' && typeof b['text'] === 'string') {
					texts.push(b['text']);
				} else if (b['type'] === 'tool_use') {
					if (typeof b['name'] === 'string') {
						tools.push(b['name']);
					}
					files.push(...filesFromToolInput(b['input']));
				}
			}
		}

		const text = texts.join('\n').trim();
		if (text.length === 0 && tools.length === 0) {
			continue;
		}
		entries.push({
			role: type,
			text,
			timestamp: typeof record['timestamp'] === 'string' ? record['timestamp'] : undefined,
			tools,
			files
		});
	}
	return entries;
}

/**
 * 入力を検索条件にする。
 * `file:` と `tool:` は絞り込み、それ以外の語は**すべて含まれること**を求める
 * （思い出し方は曖昧なので、語を足すほど絞れるほうが使いやすい）。
 */
export function parseQuery(input: string): SearchQuery {
	const terms: string[] = [];
	let file: string | undefined;
	let tool: string | undefined;
	for (const token of input.split(/\s+/).filter(Boolean)) {
		if (token.startsWith('file:') && token.length > 5) {
			file = token.slice(5);
		} else if (token.startsWith('tool:') && token.length > 5) {
			tool = token.slice(5);
		} else {
			terms.push(token);
		}
	}
	return { terms, file, tool };
}

/** 一致した箇所の前後を切り出す。長い応答をそのまま並べても読めないため */
export function snippetAround(text: string, term: string, width = 80): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	if (term.length === 0) {
		return flat.slice(0, width * 2);
	}
	const at = flat.toLowerCase().indexOf(term.toLowerCase());
	if (at < 0) {
		return flat.slice(0, width * 2);
	}
	const start = Math.max(0, at - width);
	const end = Math.min(flat.length, at + term.length + width);
	return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
}

/** 1 セッション分の記録を検索する */
export function searchEntries(entries: TranscriptEntry[], query: SearchQuery, sessionId: string): TranscriptMatch[] {
	const matches: TranscriptMatch[] = [];
	for (const entry of entries) {
		if (query.file && !entry.files.some((f) => f.includes(query.file as string))) {
			continue;
		}
		if (query.tool && !entry.tools.some((t) => t.toLowerCase().startsWith((query.tool as string).toLowerCase()))) {
			continue;
		}
		const haystack = `${entry.text}\n${entry.files.join('\n')}`.toLowerCase();
		if (!query.terms.every((term) => haystack.includes(term.toLowerCase()))) {
			continue;
		}
		matches.push({ entry, sessionId, snippet: snippetAround(entry.text, query.terms[0] ?? '') });
	}
	return matches;
}

/**
 * 記録 1 本の見出し。
 * 一覧に UUID だけが並んでも、どれが目当てか分からない。
 * Claude Code は `type: "ai-title"` の行に**要約タイトル**を残しているので、それを使う。
 */
export interface TranscriptSessionMeta {
	sessionId: string;
	title?: string;
	cwd?: string;
	gitBranch?: string;
	/** 最初と最後のレコードの時刻（ISO 文字列） */
	startedAt?: string;
	endedAt?: string;
}

/**
 * 記録全体から見出しを拾う。`parseTranscript` とは別に舐めるのではなく、
 * 呼び出し側が同じ行を 1 回ずつ渡す形にしてある（大きなファイルを 2 度読まないため）。
 */
export function readSessionMeta(line: string, into: TranscriptSessionMeta): void {
	if (line.trim().length === 0) {
		return;
	}
	let record: Record<string, unknown>;
	try {
		record = JSON.parse(line) as Record<string, unknown>;
	} catch {
		return;
	}
	if (record['type'] === 'ai-title' && typeof record['aiTitle'] === 'string') {
		into.title = record['aiTitle'];
	}
	if (!into.cwd && typeof record['cwd'] === 'string') {
		into.cwd = record['cwd'];
	}
	if (!into.gitBranch && typeof record['gitBranch'] === 'string') {
		into.gitBranch = record['gitBranch'];
	}
	const at = record['timestamp'];
	if (typeof at === 'string' && at) {
		if (into.startedAt === undefined || at < into.startedAt) {
			into.startedAt = at;
		}
		if (into.endedAt === undefined || at > into.endedAt) {
			into.endedAt = at;
		}
	}
}

/** 表示用の日時（記録は ISO なので、読める形に落とす） */
export function formatTimestamp(timestamp: string | undefined): string {
	if (!timestamp) {
		return '';
	}
	const at = timestamp.replace('T', ' ');
	return at.slice(0, 16);
}
