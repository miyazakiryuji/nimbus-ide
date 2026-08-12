/**
 * 書き換え系ツールの提案を「選べる部品」に割る（tasks.md T-113）。
 *
 * `core/hunks.ts` が行差分そのものを扱うのに対して、ここは**ツールごとの形**を吸収する。
 * 同じ「一部だけ採用」でも、ツールによって自然な単位が違うため:
 *
 * - `Write`   … いまのファイルと提案された全文の差分を hunk に割る
 * - `Edit`    … `old_string` と `new_string` の差分を hunk に割り、`new_string` を組み直す
 * - `MultiEdit` … 個々の編集そのものが単位。差分を取らず、採る編集だけを残す
 *
 * VS Code に依存しないので単体で検証できる（選び違えると**書かれる内容が変わる**）。
 */
import { applyHunks, describeHunk, diffHunks, previewHunk } from './hunks';

export interface EditPart {
	/** 選択肢の 1 行 */
	label: string;
	/** 差分のプレビュー */
	detail: string;
}

export interface PartialEditPlan {
	/** 選べる部品。2 つ以上あるときだけ「一部だけ採用」を出す意味がある */
	parts: EditPart[];
	/** 選んだ番号だけを反映した、ツールに渡し直す入力 */
	rebuild: (selected: ReadonlySet<number>) => Record<string, unknown>;
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
	return input && typeof input === 'object' ? (input as Record<string, unknown>) : undefined;
}

function str(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === 'string' ? value : undefined;
}

/** hunk の並びを、選択肢と組み立て直しの両方に使える形にする */
function planFromDiff(
	before: string,
	after: string,
	rebuildWith: (text: string) => Record<string, unknown>
): PartialEditPlan | undefined {
	const hunks = diffHunks(before, after);
	if (hunks.length === 0) {
		return undefined;
	}
	return {
		parts: hunks.map((hunk) => ({ label: describeHunk(hunk), detail: previewHunk(hunk) })),
		rebuild: (selected) => rebuildWith(applyHunks(before, hunks, selected))
	};
}

/** 1 件の編集を 1 行で言い表す（MultiEdit の選択肢に使う） */
function describeEdit(edit: Record<string, unknown>, index: number): EditPart {
	const oldText = str(edit, 'old_string') ?? '';
	const newText = str(edit, 'new_string') ?? '';
	const flat = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 60);
	return {
		label: `${index + 1} 件目: ${flat(oldText) || '（空）'} → ${flat(newText) || '（空）'}`,
		detail: `- ${flat(oldText)} ⏎ + ${flat(newText)}`
	};
}

/**
 * このツール呼び出しを部分採用できるか。できるなら選択肢と組み立て直しを返す。
 *
 * @param readFile 変更前の内容を読む。読めない（新規ファイル）ときは undefined
 * @returns 部品が 2 つ以上あるときだけ計画を返す。1 つなら「許可／拒否」と変わらないので undefined
 */
export function planPartialEdit(
	toolName: string,
	input: unknown,
	readFile: (path: string) => string | undefined
): PartialEditPlan | undefined {
	const record = asRecord(input);
	if (!record) {
		return undefined;
	}

	let plan: PartialEditPlan | undefined;
	if (toolName === 'Write') {
		const path = str(record, 'file_path');
		const content = str(record, 'content');
		if (path === undefined || content === undefined) {
			return undefined;
		}
		// 新規ファイルは変更前が空。全体が 1 つの hunk になるので部分採用は出ない
		plan = planFromDiff(readFile(path) ?? '', content, (text) => ({ ...record, content: text }));
	} else if (toolName === 'Edit') {
		const oldText = str(record, 'old_string');
		const newText = str(record, 'new_string');
		if (oldText === undefined || newText === undefined) {
			return undefined;
		}
		// old_string は置き換え対象としてそのまま残す。組み直すのは new_string だけ
		plan = planFromDiff(oldText, newText, (text) => ({ ...record, new_string: text }));
	} else if (toolName === 'MultiEdit') {
		const edits = record['edits'];
		if (!Array.isArray(edits) || edits.length === 0) {
			return undefined;
		}
		const entries = edits.map(asRecord);
		if (entries.some((entry) => entry === undefined)) {
			return undefined;
		}
		plan = {
			parts: entries.map((entry, index) => describeEdit(entry!, index)),
			rebuild: (selected) => ({ ...record, edits: edits.filter((_, index) => selected.has(index)) })
		};
	}

	// 部品が 1 つなら、部分採用は「許可」と同じ。選択肢を増やすだけ無駄なので出さない
	return plan && plan.parts.length > 1 ? plan : undefined;
}
