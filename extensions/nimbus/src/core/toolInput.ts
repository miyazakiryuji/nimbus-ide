/**
 * ツール呼び出しの入力から、共通して要るものを取り出す。
 *
 * 「どのファイルを触ったか」は `activity.ts`（1 セッションを畳む）と
 * `sessionFiles.ts`（全セッション横断）の両方が要る。同じ取り出し方を 2 つ持つと、
 * 片方だけキー名を足したときにズレる（ドクターの duplication が拾った）。
 */

/** ファイルを読むツール */
export const READ_TOOLS: ReadonlySet<string> = new Set(['Read', 'NotebookRead']);
/** ファイルを書くツール */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * 入力から対象ファイルのパスを取り出す。
 * ツールごとにキー名が違う（`file_path` / `notebook_path` / `path`）ので、ここで吸収する。
 */
export function filePathOf(input: unknown): string | undefined {
	if (!input || typeof input !== 'object') {
		return undefined;
	}
	const record = input as Record<string, unknown>;
	const path = record['file_path'] ?? record['notebook_path'] ?? record['path'];
	return typeof path === 'string' && path ? path : undefined;
}

/** Bash など、パスではなくコマンドで「何をしているか」が分かるもの */
export function commandOf(input: unknown): string | undefined {
	if (!input || typeof input !== 'object') {
		return undefined;
	}
	const command = (input as Record<string, unknown>)['command'];
	return typeof command === 'string' && command ? command.replace(/\s+/g, ' ').trim() : undefined;
}
