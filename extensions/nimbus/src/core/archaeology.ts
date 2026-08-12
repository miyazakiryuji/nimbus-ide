/**
 * 考古学モード（tasks.md T-079）。
 *
 * 「なぜこのコードはこうなっているのか」は、コードを読んでも分からない。
 * 分かるのは**いつ・誰が・どのコミットで入れたか**で、そこに書かれた意図だけが手がかり。
 *
 * `git blame` の出力を読める形にして、コミットの言葉ごとエージェントに渡す。
 * VS Code に依存しない。
 */

export interface BlameLine {
	commit: string;
	author: string;
	/** ISO の日付（`2026-08-13`） */
	date: string;
	summary: string;
	/** 1 起点 */
	line: number;
}

export interface CommitGroup {
	commit: string;
	author: string;
	date: string;
	summary: string;
	/** その行たち（1 起点・昇順） */
	lines: number[];
}

const SHA_LINE = /^([0-9a-f]{40}) \d+ (\d+)/;

/**
 * `git blame --line-porcelain` を読む。
 * 同じコミットが続くとヘッダが省略されるので、**直前の値を引き継ぐ**必要がある。
 */
export function parseBlamePorcelain(output: string): BlameLine[] {
	const known = new Map<string, { author: string; date: string; summary: string }>();
	const lines: BlameLine[] = [];
	let commit: string | undefined;
	let finalLine = 0;
	let author = '';
	let date = '';
	let summary = '';

	for (const raw of output.split('\n')) {
		const header = SHA_LINE.exec(raw);
		if (header) {
			commit = header[1];
			finalLine = Number(header[2]);
			const remembered = known.get(commit);
			author = remembered?.author ?? '';
			date = remembered?.date ?? '';
			summary = remembered?.summary ?? '';
			continue;
		}
		if (raw.startsWith('author ')) {
			author = raw.slice('author '.length).trim();
		} else if (raw.startsWith('author-time ')) {
			const seconds = Number(raw.slice('author-time '.length).trim());
			date = Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString().slice(0, 10) : '';
		} else if (raw.startsWith('summary ')) {
			summary = raw.slice('summary '.length).trim();
		} else if (raw.startsWith('\t') && commit) {
			known.set(commit, { author, date, summary });
			lines.push({ commit, author, date, summary, line: finalLine });
		}
	}
	return lines;
}

/** コミット単位にまとめる。新しい順（同じ日付ならコミットの並び順） */
export function groupByCommit(lines: readonly BlameLine[]): CommitGroup[] {
	const groups = new Map<string, CommitGroup>();
	for (const line of lines) {
		const found = groups.get(line.commit);
		if (found) {
			found.lines.push(line.line);
			continue;
		}
		groups.set(line.commit, {
			commit: line.commit,
			author: line.author,
			date: line.date,
			summary: line.summary,
			lines: [line.line]
		});
	}
	return [...groups.values()]
		.map((group) => ({ ...group, lines: [...group.lines].sort((a, b) => a - b) }))
		.sort((a, b) => b.date.localeCompare(a.date) || b.lines.length - a.lines.length);
}

/** 画面に出す 1 行 */
export function describeCommit(group: CommitGroup): string {
	return `${group.date}  ${group.summary}  (${group.author} · ${group.lines.length} 行)`;
}

/**
 * セッションへ投入する文。
 * **「直して」ではなく「なぜこうなっているのかを説明して」。** 経緯を知らずに直すのが一番危ない。
 */
export function buildArchaeologyPrompt(
	file: string,
	startLine: number,
	endLine: number,
	groups: readonly CommitGroup[],
	code: string
): string {
	if (groups.length === 0) {
		return '';
	}
	return [
		`${file}:${startLine}–${endLine} が**なぜこうなっているのか**を調べてください。`,
		'',
		'この範囲を書いたコミット（新しい順）:',
		'',
		...groups.map((group) => `- \`${group.commit.slice(0, 8)}\` ${group.date} ${group.summary}（${group.author}・${group.lines.length} 行）`),
		'',
		'対象のコード:',
		'````',
		code,
		'````',
		'',
		'それぞれのコミットが**何を解決しようとしたのか**を、コミットの内容から読み取ってください。',
		'分からないものは「分からない」と書いてください。**推測を事実として書かないでください。**',
		'そのうえで、この形になっている理由をまとめてください。'
	].join('\n');
}
