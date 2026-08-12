/**
 * 行差分を「かたまり（hunk）」に割り、選んだかたまりだけを適用する（tasks.md T-113）。
 *
 * 提案された変更が 1 か所しかないなら、承認は「はい／いいえ」で足りる。困るのは
 * **1 回の書き換えに、採りたい変更と採りたくない変更が混ざっている**とき。今までは
 * 丸ごと拒否して「ここだけ直して」と言い直すしかなく、往復が 1 回増えていた。
 *
 * ここは差分の計算と適用だけを持つ。VS Code に依存しないので単体で検証できる
 * （選び違えると**書かれる内容が変わる**場所なので必ずテストする）。
 */

export interface Hunk {
	/** 変更前の何行目から（0 始まり・この位置の行を beforeLines と置き換える） */
	beforeStart: number;
	/** 置き換えられる側の行（削除される行。挿入だけの hunk では空） */
	beforeLines: string[];
	/** 置き換える側の行（追加される行。削除だけの hunk では空） */
	afterLines: string[];
}

/**
 * LCS の計算量は行数の積になる。巨大ファイルで固まらせないための上限で、
 * 超えたときは「全体で 1 かたまり」に落とす（部分採用はできないが、止まるよりよい）。
 */
const MAX_MATRIX_CELLS = 4_000_000;

/**
 * 行に割る。`split('\n')` と `join('\n')` は往復するので、
 * 末尾の改行の有無も CRLF もそのまま保たれる。
 */
function toLines(text: string): string[] {
	return text.split('\n');
}

/** 先頭から一致する行数 */
function commonPrefix(a: readonly string[], b: readonly string[]): number {
	const limit = Math.min(a.length, b.length);
	let i = 0;
	while (i < limit && a[i] === b[i]) {
		i++;
	}
	return i;
}

/** 末尾から一致する行数（先頭の一致分とは重ねない） */
function commonSuffix(a: readonly string[], b: readonly string[], prefix: number): number {
	const limit = Math.min(a.length, b.length) - prefix;
	let i = 0;
	while (i < limit && a[a.length - 1 - i] === b[b.length - 1 - i]) {
		i++;
	}
	return i;
}

/**
 * 変わった区間だけを hunk として返す。変更が無ければ空配列。
 *
 * 先に前後の一致部分を削ってから LCS にかける。実際の書き換えは
 * 「大きなファイルの一部分」がほとんどなので、これだけで大半は軽くなる。
 */
export function diffHunks(before: string, after: string): Hunk[] {
	if (before === after) {
		return [];
	}
	const beforeLines = toLines(before);
	const afterLines = toLines(after);
	const prefix = commonPrefix(beforeLines, afterLines);
	const suffix = commonSuffix(beforeLines, afterLines, prefix);
	const beforeMid = beforeLines.slice(prefix, beforeLines.length - suffix);
	const afterMid = afterLines.slice(prefix, afterLines.length - suffix);

	// 片側が空＝まるごと追加／まるごと削除。LCS を回すまでもない
	if (beforeMid.length === 0 || afterMid.length === 0) {
		return [{ beforeStart: prefix, beforeLines: beforeMid, afterLines: afterMid }];
	}
	if (beforeMid.length * afterMid.length > MAX_MATRIX_CELLS) {
		return [{ beforeStart: prefix, beforeLines: beforeMid, afterLines: afterMid }];
	}
	return groupIntoHunks(beforeMid, afterMid, prefix);
}

/** LCS の表を作り、後ろから辿って hunk に束ねる */
function groupIntoHunks(before: readonly string[], after: readonly string[], offset: number): Hunk[] {
	const n = before.length;
	const m = after.length;
	const width = m + 1;
	const lcs = new Int32Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lcs[i * width + j] =
				before[i] === after[j]
					? lcs[(i + 1) * width + (j + 1)] + 1
					: Math.max(lcs[(i + 1) * width + j], lcs[i * width + (j + 1)]);
		}
	}

	const hunks: Hunk[] = [];
	let i = 0;
	let j = 0;
	// 連続する削除・追加を 1 つの hunk にまとめる。間に一致行が挟まったら切る
	let pending: Hunk | undefined;
	const flush = (): void => {
		if (pending) {
			hunks.push(pending);
			pending = undefined;
		}
	};
	const pendingAt = (): Hunk => {
		if (!pending) {
			pending = { beforeStart: offset + i, beforeLines: [], afterLines: [] };
		}
		return pending;
	};

	while (i < n && j < m) {
		if (before[i] === after[j]) {
			flush();
			i++;
			j++;
		} else if (lcs[(i + 1) * width + j] >= lcs[i * width + (j + 1)]) {
			pendingAt().beforeLines.push(before[i]);
			i++;
		} else {
			pendingAt().afterLines.push(after[j]);
			j++;
		}
	}
	while (i < n) {
		pendingAt().beforeLines.push(before[i]);
		i++;
	}
	while (j < m) {
		pendingAt().afterLines.push(after[j]);
		j++;
	}
	flush();
	return hunks;
}

/**
 * 選んだ hunk だけを適用した全文を作る。
 * 選ばれなかった hunk は**変更前のまま**残る（＝採用しない）。
 */
export function applyHunks(before: string, hunks: readonly Hunk[], selected: ReadonlySet<number>): string {
	const beforeLines = toLines(before);
	const result: string[] = [];
	let cursor = 0;
	// beforeStart の昇順で並んでいる前提（diffHunks はそう作る）
	hunks.forEach((hunk, index) => {
		result.push(...beforeLines.slice(cursor, hunk.beforeStart));
		result.push(...(selected.has(index) ? hunk.afterLines : hunk.beforeLines));
		cursor = hunk.beforeStart + hunk.beforeLines.length;
	});
	result.push(...beforeLines.slice(cursor));
	return result.join('\n');
}

/** 選択肢に出す 1 行。「何行目で、何行減って何行増えるか」 */
export function describeHunk(hunk: Hunk): string {
	const line = hunk.beforeStart + 1;
	const removed = hunk.beforeLines.length;
	const added = hunk.afterLines.length;
	if (removed === 0) {
		return `${line} 行目に ${added} 行を追加`;
	}
	if (added === 0) {
		return `${line} 行目から ${removed} 行を削除`;
	}
	return `${line} 行目から ${removed} 行を ${added} 行に置き換え`;
}

/** 何行まで見せるか。長い hunk で選択肢が埋まらないように頭だけ出す */
const PREVIEW_LINES = 6;

/** `-` と `+` の並びにしたプレビュー。1 行に畳んで QuickPick の detail に出す */
export function previewHunk(hunk: Hunk): string {
	const lines = [
		...hunk.beforeLines.map((line) => `- ${line}`),
		...hunk.afterLines.map((line) => `+ ${line}`)
	];
	const shown = lines.slice(0, PREVIEW_LINES).map((line) => line.replace(/\s+/g, ' ').trim());
	return lines.length > PREVIEW_LINES ? `${shown.join(' ⏎ ')} …（他 ${lines.length - PREVIEW_LINES} 行）` : shown.join(' ⏎ ');
}
