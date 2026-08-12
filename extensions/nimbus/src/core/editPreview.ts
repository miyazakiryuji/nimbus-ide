/**
 * 「Claude がこれから何を書き換えるのか」を組み立てる純粋ロジック。
 *
 * VS Code に依存しないので、拡張ホストを起動せずに単体で検証できる。
 * 実ファイルへの書き込みは一切しない（読み取りは呼び出し側から関数で渡す）。
 */

export interface EditPreview {
	filePath: string;
	/** 変更前（ファイルが無い場合は undefined） */
	original?: string;
	proposed: string;
}

interface EditInput {
	file_path?: unknown;
	content?: unknown;
	old_string?: unknown;
	new_string?: unknown;
	replace_all?: unknown;
	edits?: unknown;
}

/** 1 件の置換を適用する。対象が見つからない場合は null（＝差分を作れない） */
function applyReplacement(source: string, oldString: string, newString: string, replaceAll: boolean): string | null {
	if (oldString === '') {
		// 空文字の置換は SDK 側でも許されない。差分を作らず素通しする
		return null;
	}
	if (!source.includes(oldString)) {
		return null;
	}
	if (replaceAll) {
		return source.split(oldString).join(newString);
	}
	const index = source.indexOf(oldString);
	return source.slice(0, index) + newString + source.slice(index + oldString.length);
}

/**
 * ツール入力から「適用後の内容」を組み立てる。
 * 差分を作れない場合（対象文字列が見つからない等）は undefined を返し、呼び出し側は
 * 差分表示を諦めて通常の確認だけを出す。実行を止めたり内容を書き換えたりはしない。
 */
export function buildPreview(toolName: string, input: unknown, readFile: (path: string) => string | undefined): EditPreview | undefined {
	if (!input || typeof input !== 'object') {
		return undefined;
	}
	const edit = input as EditInput;
	const filePath = typeof edit.file_path === 'string' ? edit.file_path : undefined;
	if (!filePath) {
		return undefined;
	}

	if (toolName === 'Write') {
		if (typeof edit.content !== 'string') {
			return undefined;
		}
		return { filePath, original: readFile(filePath), proposed: edit.content };
	}

	if (toolName === 'Edit') {
		const original = readFile(filePath);
		if (original === undefined || typeof edit.old_string !== 'string' || typeof edit.new_string !== 'string') {
			return undefined;
		}
		const proposed = applyReplacement(original, edit.old_string, edit.new_string, edit.replace_all === true);
		return proposed === null ? undefined : { filePath, original, proposed };
	}

	if (toolName === 'MultiEdit' && Array.isArray(edit.edits)) {
		const original = readFile(filePath);
		if (original === undefined) {
			return undefined;
		}
		let current = original;
		for (const raw of edit.edits) {
			if (!raw || typeof raw !== 'object') {
				return undefined;
			}
			const one = raw as EditInput;
			if (typeof one.old_string !== 'string' || typeof one.new_string !== 'string') {
				return undefined;
			}
			const next = applyReplacement(current, one.old_string, one.new_string, one.replace_all === true);
			if (next === null) {
				return undefined;
			}
			current = next;
		}
		return { filePath, original, proposed: current };
	}

	return undefined;
}
