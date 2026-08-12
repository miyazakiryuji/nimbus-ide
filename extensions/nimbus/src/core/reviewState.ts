/**
 * レビュー済み／未レビューの管理（tasks.md T-160）。
 *
 * 変更が 40 ファイルを超えると、人は「どこまで見たか」を覚えていられない。
 * 途中で中断すると最初から見直すことになり、それが嫌でレビュー自体が雑になる。
 * ここは「見た」印を覚えておくだけの、小さくて確実な仕組み。
 *
 * **中身が変われば、見た印は消える。** 見たあとに書き換わったものを
 * 「レビュー済み」のまま置いておくと、確認したつもりの見落としが生まれる。
 * そのため印はパスではなく**内容の指紋**に対して付ける。
 *
 * VS Code に依存しないので単体で検証できる。
 */

/** ファイル 1 件の見えかた */
export interface ReviewEntry {
	path: string;
	/** いまの中身の指紋（差分の中身から作る） */
	fingerprint: string;
	reviewed: boolean;
	/** 見たあとに中身が変わったか。`reviewed` は落ちるが、理由を伝えるために持つ */
	changedSinceReview: boolean;
}

export interface ReviewProgress {
	total: number;
	reviewed: number;
	/** 見たあとに変わったもの */
	stale: number;
}

/**
 * 指紋。長さと中身から作る簡単なハッシュで十分 —
 * 衝突しても「見たはずのものをもう一度見る」だけで、実害が無い側に倒れる。
 */
export function fingerprint(content: string): string {
	let h1 = 0x811c9dc5;
	let h2 = 0x01000193;
	for (let i = 0; i < content.length; i++) {
		const c = content.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 0x01000193);
		h2 = Math.imul(h2 + c, 0x85ebca6b) ^ (h2 >>> 13);
	}
	return `${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}-${content.length.toString(36)}`;
}

/** 保存する形。パス → 見たときの指紋 */
export type ReviewMarks = Record<string, string>;

/**
 * いまの変更一覧と、保存してある印を突き合わせる。
 *
 * @param files パス → いまの差分の中身
 * @param marks 保存してある「見たときの指紋」
 */
export function buildEntries(files: ReadonlyMap<string, string>, marks: ReviewMarks): ReviewEntry[] {
	const entries: ReviewEntry[] = [];
	for (const [path, content] of files) {
		const current = fingerprint(content);
		const seen = marks[path];
		entries.push({
			path,
			fingerprint: current,
			reviewed: seen === current,
			// 見た記録はあるが指紋が違う＝そのあと書き換わった
			changedSinceReview: seen !== undefined && seen !== current
		});
	}
	return entries.sort((a, b) => {
		// 未レビューを先に、その中では「見たあとに変わったもの」を先に
		if (a.reviewed !== b.reviewed) {
			return a.reviewed ? 1 : -1;
		}
		if (a.changedSinceReview !== b.changedSinceReview) {
			return a.changedSinceReview ? -1 : 1;
		}
		return a.path.localeCompare(b.path);
	});
}

export function progressOf(entries: readonly ReviewEntry[]): ReviewProgress {
	return {
		total: entries.length,
		reviewed: entries.filter((entry) => entry.reviewed).length,
		stale: entries.filter((entry) => entry.changedSinceReview).length
	};
}

/** 「見た」印を付ける／外す。変更のなくなったファイルの印は落とす */
export function withMark(marks: ReviewMarks, entry: ReviewEntry, reviewed: boolean): ReviewMarks {
	const next = { ...marks };
	if (reviewed) {
		next[entry.path] = entry.fingerprint;
	} else {
		delete next[entry.path];
	}
	return next;
}

/** いま変更されていないファイルの印を捨てる（コミット後に溜め込まないため） */
export function pruneMarks(marks: ReviewMarks, present: Iterable<string>): ReviewMarks {
	const alive = new Set(present);
	const next: ReviewMarks = {};
	for (const [path, mark] of Object.entries(marks)) {
		if (alive.has(path)) {
			next[path] = mark;
		}
	}
	return next;
}

/** 進み具合の 1 行。ビューの見出しに出す */
export function formatProgress(progress: ReviewProgress): string {
	if (progress.total === 0) {
		return '変更なし';
	}
	const stale = progress.stale > 0 ? ` · 見たあとに変わった ${progress.stale}` : '';
	return `${progress.reviewed}/${progress.total} 済み${stale}`;
}
