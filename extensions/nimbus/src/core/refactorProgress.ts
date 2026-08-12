/**
 * 段階的リファクタの進捗管理（tasks.md T-111）。
 *
 * 「全 120 箇所中 48 箇所置換済み」が見えないと、大きな置き換えは**途中でやめる**。
 * どこまでやったか分からなくなるからで、残りの数さえ出ていれば再開できる。
 *
 * VS Code に依存しない。検索結果の数え方と、進捗の見せ方だけを置く。
 */
import { bar } from './usage';

/** 追いかけている置き換え 1 件 */
export interface RefactorTrack {
	id: string;
	/** 人が読む名前 */
	label: string;
	/** 残りを数えるための検索語（正規表現） */
	pattern: string;
	/** 始めたときの件数。これを分母にする */
	initial: number;
	createdAt: number;
}

export interface RefactorProgress {
	track: RefactorTrack;
	remaining: number;
	/** 置換済み（分母より増えることもある — 途中で増やしたとき） */
	done: number;
	percent: number;
}

/**
 * `git grep -c <pattern>` の出力（`path:count` の行）を数える。
 * ファイル単位の件数を持っておくと「どこが残っているか」まで出せる。
 */
export function parseGrepCounts(output: string): Map<string, number> {
	const counts = new Map<string, number>();
	for (const line of output.split('\n')) {
		const index = line.lastIndexOf(':');
		if (index <= 0) {
			continue;
		}
		const path = line.slice(0, index);
		const count = Number(line.slice(index + 1));
		if (path.length > 0 && Number.isFinite(count) && count > 0) {
			counts.set(path, count);
		}
	}
	return counts;
}

export function totalOf(counts: ReadonlyMap<string, number>): number {
	let total = 0;
	for (const count of counts.values()) {
		total += count;
	}
	return total;
}

export function progressOf(track: RefactorTrack, remaining: number): RefactorProgress {
	const done = Math.max(0, track.initial - remaining);
	const percent = track.initial === 0 ? 100 : Math.min(100, (done / track.initial) * 100);
	return { track, remaining, done, percent };
}

/** 一覧に出す 1 行。`▰▰▱▱▱ 48/120（残り 72）` */
export function renderProgress(progress: RefactorProgress): string {
	const { track, remaining, done, percent } = progress;
	return `${bar(percent, 5)} ${done}/${track.initial}（残り ${remaining}）  ${track.label}`;
}

/** 残っている場所の多い順。手を付ける順番はここで決まる */
export function rankRemaining(counts: ReadonlyMap<string, number>, limit = 20): { file: string; count: number }[] {
	return [...counts.entries()]
		.map(([file, count]) => ({ file, count }))
		.sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))
		.slice(0, Math.max(1, limit));
}

/** セッションへ投入する文。残りの多い場所から潰させる */
export function buildRefactorPrompt(
	progress: RefactorProgress,
	remaining: readonly { file: string; count: number }[]
): string {
	if (remaining.length === 0) {
		return '';
	}
	const lines = remaining.map((entry) => `- ${entry.file}（${entry.count} 箇所）`);
	return [
		`置き換えの続きをお願いします: ${progress.track.label}`,
		`いま ${progress.done}/${progress.track.initial} 箇所まで終わっていて、残りは ${progress.remaining} 箇所です。`,
		'',
		`検索に使っているパターン: \`${progress.track.pattern}\``,
		'',
		'残っている場所（多い順）:',
		...lines,
		'',
		'**一度に全部やらないでください。** 上から数ファイルずつ直して、',
		'そのたびにテストを走らせてから次に進んでください。'
	].join('\n');
}
