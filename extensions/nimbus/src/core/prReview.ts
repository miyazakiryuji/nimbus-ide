/**
 * PR レビューの取り込み（tasks.md T-116）。
 *
 * レビューコメントを読んで直す作業がつらいのは、**指摘とコードの間を往復する**ところ。
 * ブラウザで指摘を読み、エディタで場所を探し、直し、またブラウザに戻って返信する。
 * `gh` は指摘を取ってこられるが、`file:line` とコードの中身は繋いでくれない。
 *
 * ここは取ってきた JSON を「どこへの、どういう指摘か」に整え、
 * **その場所のコードを添えて**セッションに渡せる形にする。返信の下書きも同じ材料から作る。
 *
 * VS Code に依存しないので単体で検証できる。
 */

/** `gh pr view --json reviews,comments` と `gh api .../comments` から作る、正規化した 1 件 */
export interface ReviewComment {
	id: number;
	author: string;
	body: string;
	/** ファイルへの指摘なら入る。PR 全体へのコメントでは undefined */
	path?: string;
	/** 変更後のファイルの行。gh の `line`（無ければ `original_line`） */
	line?: number;
	/** 指摘が付いた差分の抜粋 */
	diffHunk?: string;
	/** 解決済みとして畳まれているか */
	resolved: boolean;
	/** 返信先。スレッドの先頭なら自分の id */
	inReplyTo?: number;
}

interface RawComment {
	id?: unknown;
	user?: { login?: unknown };
	body?: unknown;
	path?: unknown;
	line?: unknown;
	original_line?: unknown;
	diff_hunk?: unknown;
	in_reply_to_id?: unknown;
	/** GraphQL 経由で取ったときだけ入る */
	isResolved?: unknown;
}

function str(value: unknown): string | undefined {
	return typeof value === 'string' && value ? value : undefined;
}

function num(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * `gh api repos/{owner}/{repo}/pulls/{n}/comments` の配列を読む。
 * 形が違うもの（本文が無い等）は**落とす** — 中途半端に出すと、指摘の数が合わなくなる。
 */
export function parseReviewComments(json: unknown): ReviewComment[] {
	if (!Array.isArray(json)) {
		return [];
	}
	const comments: ReviewComment[] = [];
	for (const item of json as RawComment[]) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const id = num(item.id);
		const body = str(item.body);
		if (id === undefined || !body) {
			continue;
		}
		comments.push({
			id,
			author: str(item.user?.login) ?? '（不明）',
			body,
			path: str(item.path),
			// 変更後の行が無いものは、消えた行への指摘。元の行で示す
			line: num(item.line) ?? num(item.original_line),
			diffHunk: str(item.diff_hunk),
			resolved: item.isResolved === true,
			inReplyTo: num(item.in_reply_to_id)
		});
	}
	return comments;
}

/**
 * まだ対応していない指摘だけに絞る。
 * 解決済みと、自分の返信（スレッドの 2 件目以降）は外す。
 */
export function openComments(comments: readonly ReviewComment[]): ReviewComment[] {
	return comments.filter((comment) => !comment.resolved && comment.inReplyTo === undefined);
}

/** ファイルの指定が無い指摘（PR 全体へのコメント）をまとめる見出し */
export const NO_FILE = '（ファイル指定なし）';

/**
 * 同じファイルの指摘をまとめ、行の順に並べる。
 *
 * **ファイル指定なしは必ず最後**に置く。直せる場所がはっきりしているものから
 * 片付けるほうが手が動くため。並びを `localeCompare` に任せると、
 * 見出しが日本語なので環境の照合順序によって前にも後ろにも来てしまう。
 */
export function groupByFile(comments: readonly ReviewComment[]): { path: string; comments: ReviewComment[] }[] {
	const byPath = new Map<string, ReviewComment[]>();
	for (const comment of comments) {
		const key = comment.path ?? NO_FILE;
		byPath.set(key, [...(byPath.get(key) ?? []), comment]);
	}
	return [...byPath]
		.map(([path, list]) => ({
			path,
			comments: [...list].sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
		}))
		.sort((a, b) => {
			if (a.path === NO_FILE) {
				return 1;
			}
			if (b.path === NO_FILE) {
				return -1;
			}
			return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
		});
}

/** 選択肢の 1 行 */
export function describeComment(comment: ReviewComment): string {
	const where = comment.path ? `${comment.path}${comment.line ? `:${comment.line}` : ''}` : 'PR 全体';
	const summary = comment.body.replace(/\s+/g, ' ').trim().slice(0, 80);
	return `${where} — ${summary}`;
}

/**
 * 直してもらうための頼みかた。
 * **指摘をそのまま渡す**（要約しない）。要約すると、レビュアーの言葉のニュアンスが落ちる。
 */
export function fixPrompt(comments: readonly ReviewComment[]): string {
	const groups = groupByFile(comments);
    const parts = [
		`PR のレビュー指摘が ${comments.length} 件あります。**指摘のとおりに直してください。**`,
		'',
		'- 直す前に、指摘が今のコードに当てはまるか確かめてください（既に直っていることがあります）',
		'- 納得できない指摘は、直さずに**理由を書いて**ください。言われたとおりに直すことが目的ではありません',
		''
	];
	for (const group of groups) {
		parts.push(`## ${group.path}`, '');
		for (const comment of group.comments) {
			parts.push(`### ${comment.line ? `${comment.line} 行目` : '（行の指定なし）'}（${comment.author}）`, '', comment.body, '');
			if (comment.diffHunk) {
				parts.push('指摘がついた箇所:', '', '```diff', comment.diffHunk, '```', '');
			}
		}
	}
	return parts.join('\n');
}

/** 返信の下書きを頼む。**送信はしない**（人が読んでから出す） */
export function replyPrompt(comment: ReviewComment, whatWasDone: string): string {
	return [
		'次のレビュー指摘に対する**返信の下書き**を書いてください。',
		'',
		'- 直したなら、何をどう直したかを 1〜2 文で',
		'- 直していないなら、その理由を率直に。**取り繕わないこと**',
		'- 相手はコードを読める人なので、丁寧すぎる前置きは要りません',
		'',
		`## 指摘（${comment.author}）`,
		'',
		comment.body,
		'',
		'## こちらでやったこと',
		'',
		whatWasDone || '（まだ何もしていません）'
	].join('\n');
}
