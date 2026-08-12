/**
 * 他ツールからの設定インポート（tasks.md T-068）と、ワンクリック導入（T-071）。
 *
 * Cursor / Copilot から移ってくる人にとって、**いちばん高い壁は書き直し**。
 * 指示書（ルール）は書式が違うだけで、中身はそのまま使えることが多い。
 *
 * **勝手に変換しない。** 何をどこへ移すかを見せて、選ばせる。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export type SourceTool = 'cursor' | 'copilot' | 'windsurf';

export interface ImportCandidate {
	tool: SourceTool;
	/** 元のファイル（ワークスペースからの相対パス） */
	from: string;
	/** 取り込み先（`.claude/` からの相対、または CLAUDE.md） */
	to: string;
	description: string;
}

/**
 * 探す先。**中身は変換しない**（Markdown はどのツールでも Markdown）。
 * 置き場所と名前を合わせるだけにする。
 */
export const IMPORT_SOURCES: readonly { tool: SourceTool; from: string; to: string; description: string }[] = [
	{
		tool: 'cursor',
		from: '.cursorrules',
		to: 'CLAUDE.md',
		description: 'Cursor のルール。CLAUDE.md へ追記します'
	},
	{
		tool: 'cursor',
		from: '.cursor/rules',
		to: 'CLAUDE.md',
		description: 'Cursor のルール（新しい置き場所）'
	},
	{
		tool: 'copilot',
		from: '.github/copilot-instructions.md',
		to: 'CLAUDE.md',
		description: 'GitHub Copilot の指示書'
	},
	{
		tool: 'windsurf',
		from: '.windsurfrules',
		to: 'CLAUDE.md',
		description: 'Windsurf のルール'
	}
];

export function candidatesFor(existingFiles: readonly string[]): ImportCandidate[] {
	const present = new Set(existingFiles);
	return IMPORT_SOURCES.filter((source) => present.has(source.from)).map((source) => ({ ...source }));
}

/**
 * CLAUDE.md へ追記する形を作る。
 *
 * **既存を書き換えず、末尾に足す。** どこから来たかを見出しに書くので、
 * あとから「これは Cursor から持ってきたもの」と分かる。
 */
export function appendBlock(existing: string, candidate: ImportCandidate, content: string, date: string): string {
	const heading = `## ${candidate.from} から取り込み（${date}）`;
	if (existing.includes(heading)) {
		// 同じ日に二度取り込んでも重ねない
		return existing;
	}
	const body = content.trim();
	if (!body) {
		return existing;
	}
	const separator = existing.trim().length > 0 ? '\n\n' : '';
	return `${existing.trimEnd()}${separator}${heading}\n\n${body}\n`;
}

/**
 * ワンクリック導入（T-071）。
 * 他人の環境を**そのまま試す**ための入口で、中身は T-043 の配布物と同じ。
 * 違うのは「URL から読む」ところだけ。
 */
export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/**
 * 受け取ってよい URL か。
 * **`https` だけ**を通す。`file:` や `http:` を通すと、
 * 「リンクを押しただけ」で意図しないものが入る経路になる。
 */
export function checkBundleUrl(raw: string): UrlCheck {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return { ok: false, reason: 'URL として読めません' };
	}
	if (url.protocol !== 'https:') {
		return { ok: false, reason: `https だけを受け付けます（受け取ったもの: ${url.protocol}）` };
	}
	return { ok: true, url: url.toString() };
}
