/**
 * どこまで見たかを覚えておく（tasks.md T-160 レビュー済み／未レビューの管理）。
 *
 * 大きな変更は 1 回では見られない。中断して戻ってきたとき、**どこまで見たかを覚えているのは
 * 人間の仕事ではない**。ファイルごとに「見た」を持ち、変更されたら自動で外す。
 *
 * 「見た」は**そのときの中身に対して**付く。あとから変わったなら、見ていないのと同じ。
 * VS Code に依存しないので単体で検証できる。
 */

export interface ReviewMark {
	path: string;
	/** 見たときの中身の指紋（内容が変わったかを見るため） */
	fingerprint: string;
	at: number;
}

export interface ReviewState {
	marks: ReviewMark[];
}

export interface FileStatus {
	path: string;
	reviewed: boolean;
	/** 見たあとに変わったか */
	changedSinceReview: boolean;
}

/** 中身の指紋。ハッシュを持ち込まず、長さと粗い和で足りる（衝突しても実害が小さい） */
export function fingerprint(content: string): string {
	let sum = 0;
	for (let i = 0; i < content.length; i++) {
		sum = (sum * 31 + content.charCodeAt(i)) % 2147483647;
	}
	return `${content.length}-${sum}`;
}

export function markReviewed(state: ReviewState, path: string, content: string, at: number): ReviewState {
	const marks = state.marks.filter((mark) => mark.path !== path);
	return { marks: [...marks, { path, fingerprint: fingerprint(content), at }] };
}

export function unmark(state: ReviewState, path: string): ReviewState {
	return { marks: state.marks.filter((mark) => mark.path !== path) };
}

/** いまの差分に対して、どこまで見たか */
export function statusFor(state: ReviewState, files: readonly { path: string; content: string }[]): FileStatus[] {
	return files.map((file) => {
		const mark = state.marks.find((entry) => entry.path === file.path);
		if (!mark) {
			return { path: file.path, reviewed: false, changedSinceReview: false };
		}
		const changed = mark.fingerprint !== fingerprint(file.content);
		// 変わっていたら「見た」を取り消す。見たのは前の中身なので
		return { path: file.path, reviewed: !changed, changedSinceReview: changed };
	});
}

/** 差分に含まれなくなったファイルの印は捨てる（溜め続けない） */
export function prune(state: ReviewState, paths: readonly string[]): ReviewState {
	const alive = new Set(paths);
	return { marks: state.marks.filter((mark) => alive.has(mark.path)) };
}

export function renderProgress(statuses: readonly FileStatus[]): string {
	if (statuses.length === 0) {
		return '# レビューの進み\n\n見るものがありません。\n';
	}

	const done = statuses.filter((status) => status.reviewed);
	const changed = statuses.filter((status) => status.changedSinceReview);
	const lines = [
		'# レビューの進み',
		'',
		`- 見た: **${done.length} / ${statuses.length}**`,
		...(changed.length > 0 ? [`- **見たあとに変わった: ${changed.length}**（もう一度見てください）`] : []),
		''
	];

	for (const status of statuses) {
		const mark = status.changedSinceReview ? '🔄' : status.reviewed ? '✅' : '⬜️';
		lines.push(`- ${mark} \`${status.path}\``);
	}
	lines.push('');
	return lines.join('\n');
}
