/**
 * カバレッジ差分（tasks.md T-109）。
 *
 * 全体のカバレッジ率は、上がっても下がっても誰も動かない数字になりがち。
 * 効くのは「**この変更で増えた行が、テストされているか**」だけ。
 * 足した行と、テスト実行が報告したカバレッジを突き合わせる。
 *
 * VS Code に依存しない。差分の解析と突き合わせだけを置く。
 */

/** `+++ b/path` — 追加先のファイル */
const FILE_HEADER = /^\+\+\+ (?:b\/)?(.+)$/;
/** `@@ -12,3 +14,5 @@` — 追加側の開始行と行数 */
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * `git diff -U0` の出力から、ファイルごとの「足された行」（1 起点）を取り出す。
 *
 * `-U0` で呼ぶ前提なので、hunk の見出しだけを見れば足りる（本文を数えなくてよい）。
 */
export function parseAddedLines(diff: string): Map<string, number[]> {
	const byFile = new Map<string, number[]>();
	let current: string | undefined;

	for (const line of diff.split('\n')) {
		const file = FILE_HEADER.exec(line);
		if (file) {
			// 削除されたファイルは追加行を持たない
			current = file[1] === '/dev/null' ? undefined : file[1];
			continue;
		}
		const hunk = HUNK_HEADER.exec(line);
		if (!hunk || !current) {
			continue;
		}
		const start = Number(hunk[1]);
		const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
		if (count === 0) {
			// 削除だけの hunk。追加行は無い
			continue;
		}
		const lines = byFile.get(current) ?? [];
		for (let line = start; line < start + count; line++) {
			lines.push(line);
		}
		byFile.set(current, lines);
	}
	return byFile;
}

export interface CoverageEntry {
	/** 表示用のパス */
	file: string;
	/** 足された行（1 起点） */
	added: number[];
	/** そのうち、実行されなかった行 */
	uncovered: number[];
	/** 足された行のうち、カバレッジが計測されていた行数（空行やコメントは計測対象外になる） */
	measured: number;
}

/**
 * 足した行のうち、実行されなかったものを返す。
 *
 * **計測対象でない行（空行・コメント・型だけの行）は「未カバー」にしない。**
 * それを混ぜると、直しようのない指摘で埋まって誰も読まなくなる。
 */
export function uncoveredAmong(
	added: readonly number[],
	executedByLine: ReadonlyMap<number, boolean>
): { uncovered: number[]; measured: number } {
	const uncovered: number[] = [];
	let measured = 0;
	for (const line of added) {
		const executed = executedByLine.get(line);
		if (executed === undefined) {
			continue;
		}
		measured++;
		if (!executed) {
			uncovered.push(line);
		}
	}
	return { uncovered, measured };
}

/** 行番号を `14, 15, 22–25` の形に畳む。連番が並ぶと読みにくいため */
export function formatLineRanges(lines: readonly number[]): string {
	const sorted = [...new Set(lines)].sort((a, b) => a - b);
	const parts: string[] = [];
	let start: number | undefined;
	let previous: number | undefined;

	const flush = (): void => {
		if (start === undefined || previous === undefined) {
			return;
		}
		parts.push(start === previous ? `${start}` : `${start}–${previous}`);
	};

	for (const line of sorted) {
		if (start === undefined || previous === undefined) {
			start = line;
		} else if (line !== previous + 1) {
			flush();
			start = line;
		}
		previous = line;
	}
	flush();
	return parts.join(', ');
}

/** 画面に出す要約 */
export function renderCoverageDiff(entries: readonly CoverageEntry[]): string {
	const withGaps = entries.filter((entry) => entry.uncovered.length > 0);
	if (entries.length === 0) {
		return 'カバレッジを計測した実行が見つかりません。テストをカバレッジつきで走らせてから実行してください。';
	}
	if (withGaps.length === 0) {
		const measured = entries.reduce((total, entry) => total + entry.measured, 0);
		return `足した行のうち計測できた ${measured} 行は、すべてテストで実行されています。`;
	}
	return withGaps
		.map(
			(entry) =>
				`${entry.file} — 追加 ${entry.added.length} 行中 ${entry.uncovered.length} 行が未カバー: ${formatLineRanges(entry.uncovered)}`
		)
		.join('\n');
}

/** セッションへ投入する文 */
export function buildCoveragePrompt(entries: readonly CoverageEntry[]): string {
	const withGaps = entries.filter((entry) => entry.uncovered.length > 0);
	if (withGaps.length === 0) {
		return '';
	}
	const lines = withGaps.map(
		(entry) => `- ${entry.file}:${formatLineRanges(entry.uncovered)}`
	);
	return [
		'この変更で足した行のうち、次の行はテストで一度も実行されていません。',
		'',
		...lines,
		'',
		'ここを通すテストを書いてください。既存のテストの書き方に合わせ、',
		'何を確かめるべきかを先に挙げてから書いてください。'
	].join('\n');
}
