/**
 * 生成された定型パターンをスニペットにする（tasks.md T-177）。
 *
 * エージェントに何度も同じ形を書かせるのは、時間もお金も無駄。
 * 一度うまく書けた形は**エディタ側に置いて**、次からは補完で出す。
 *
 * VS Code のスニペット形式（`.code-snippets`）に合わせて組み立てるだけ。
 * VS Code には依存しない。
 */

export interface SnippetEntry {
	prefix: string;
	body: string[];
	description?: string;
}

/**
 * スニペット本文へのエスケープ。
 * `$` と `}` と `\` は VS Code のスニペット構文で意味を持つので、そのまま置くと壊れる
 * （`${1:foo}` のつもりが無いのにプレースホルダとして解釈される）。
 */
export function escapeSnippetBody(code: string): string[] {
	return code
		.replace(/\\/g, '\\\\')
		.replace(/\$/g, '\\$')
		.replace(/\}/g, '\\}')
		.split(/\r?\n/);
}

/** 行頭の共通インデントを落とす。選択範囲がぶら下がった状態で保存されないように */
export function dedent(code: string): string {
	const lines = code.split(/\r?\n/);
	const indents = lines
		.filter((line) => line.trim().length > 0)
		.map((line) => /^[\t ]*/.exec(line)?.[0] ?? '');
	if (indents.length === 0) {
		return code;
	}
	let common = indents[0];
	for (const indent of indents) {
		while (!indent.startsWith(common) && common.length > 0) {
			common = common.slice(0, -1);
		}
	}
	return common.length === 0 ? code : lines.map((line) => (line.startsWith(common) ? line.slice(common.length) : line)).join('\n');
}

/** 保存する 1 件を組み立てる */
export function buildSnippet(name: string, prefix: string, code: string, description?: string): Record<string, SnippetEntry> {
	return {
		[name]: {
			prefix: prefix.trim(),
			body: escapeSnippetBody(dedent(code).replace(/\s+$/, '')),
			description
		}
	};
}

/**
 * 既存のスニペットファイルへ足す。
 * **同じ名前があれば上書きする**（同じ名前で違う中身が 2 つあっても選べない）。
 */
export function mergeSnippets(
	existing: string,
	added: Record<string, SnippetEntry>
): { text: string; replaced: boolean } {
	let parsed: Record<string, SnippetEntry> = {};
	if (existing.trim().length > 0) {
		try {
			parsed = JSON.parse(existing) as Record<string, SnippetEntry>;
		} catch {
			// 壊れた JSON は捨てずに残す判断もあるが、書き足せないので作り直す
			parsed = {};
		}
	}
	const replaced = Object.keys(added).some((key) => key in parsed);
	return { text: `${JSON.stringify({ ...parsed, ...added }, undefined, 2)}\n`, replaced };
}

/** ファイル名に使える形にする（`.code-snippets` の名前は自由だが、記号は避ける） */
export function snippetFileName(languageId: string): string {
	const safe = languageId.replace(/[^a-zA-Z0-9_-]/g, '') || 'nimbus';
	return `${safe}.code-snippets`;
}
