/**
 * 出す前に見る（tasks.md T-215）。
 *
 * 事故は、知らなかったから起きるのではない。**確かめる順番を決めていないから**起きる。
 * 「テスト通したっけ」「あれ、コミットしてない変更あるかも」を、出すたびに思い出す。
 *
 * ここでは**止めるもの**と**知らせるだけのもの**を分ける。
 * 全部を赤くすると、赤いのが普通になって誰も読まなくなる。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface PreflightInput {
	/** コミットしていない変更のパス */
	dirtyFiles: readonly string[];
	/** push していないコミット数 */
	unpushedCommits: number;
	/** いまのブランチ */
	branch: string;
	/** 出す先として想定しているブランチ */
	releaseBranch: string;
	/** テストの結果。走らせていなければ undefined */
	testsPassed?: boolean;
	/** ビルドの結果。走らせていなければ undefined */
	buildPassed?: boolean;
	/** 変更の中にあった、消し忘れの目印 */
	leftovers: readonly { file: string; line: number; text: string }[];
	/** package.json の版が前回の出荷から上がっているか */
	versionBumped?: boolean;
}

export type CheckStatus = 'ok' | 'warn' | 'stop' | 'unknown';

export interface CheckResult {
	id: string;
	label: string;
	status: CheckStatus;
	/** 何が起きるか・次に何をするか */
	detail: string;
}

/** 消し忘れると本番で困る目印。**`TODO` は入れない**（多すぎて意味を失う） */
export const LEFTOVER_PATTERNS: readonly RegExp[] = [
	/\bdebugger\b/,
	/console\.log\(/,
	/\bFIXME\b/,
	/\.only\(/,
	/\bXXX\b/
];

/**
 * 走査する対象か。
 *
 * **データや文書は見ない。** このリポジトリの差分で試したところ、残った 13 件が
 * すべて JSON の中のコード例だった。`.json` や `.md` にコードが載っているのは当たり前で、
 * それを消し忘れと呼ぶと、本物が埋もれる。
 */
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|rb|php|cs|c|cc|cpp|h|hpp|m|mm|scala|dart|vue|svelte)$/;

/**
 * その `console.log` を消し忘れとして数えるか。
 *
 * **出力するのが仕事のファイルでは数えない。** このリポジトリの差分で試したところ、
 * 上位がすべてビルドスクリプトの進捗表示だった（33 件中 25 件）。
 * 数えるべきでないものが並ぶと、リスト自体が読まれなくなる。
 */
function countsAsLeftover(path: string, text: string): boolean {
	// テスト・スクリプト・ビルドの出力は残っていて当然
	if (/(^|\/)(test|tests|__tests__|scripts?|build|bin|tools)\//.test(path) || /\.(test|spec)\.[jt]sx?$/.test(path)) {
		return false;
	}
	// コマンドとして走らせるファイル（進捗を出すのが仕事）
	if (/\.[cm]js$/.test(path)) {
		return false;
	}
	// 文字列の中の `console.log`（コードを組み立てているところ）
	const index = text.indexOf('console.log(');
	return !/['"`]\s*$/.test(text.slice(0, index));
}

/** 変更した行から、消し忘れを拾う */
export function findLeftovers(
	files: readonly { path: string; addedLines: readonly { line: number; text: string }[] }[]
): { file: string; line: number; text: string }[] {
	const found: { file: string; line: number; text: string }[] = [];
	for (const file of files) {
		if (!SOURCE.test(file.path)) {
			continue;
		}
		for (const added of file.addedLines) {
			const matched = LEFTOVER_PATTERNS.find((pattern) => pattern.test(added.text));
			if (!matched) {
				continue;
			}
			if (/console\.log\(/.test(added.text) && !countsAsLeftover(file.path, added.text)) {
				continue;
			}
			found.push({ file: file.path, line: added.line, text: added.text.trim() });
		}
	}
	return found;
}

/** 変更した行（`+` で始まる行）を、ファイルごとに集める */
export function addedLinesFromDiff(diff: string): { path: string; addedLines: { line: number; text: string }[] }[] {
	const files: { path: string; addedLines: { line: number; text: string }[] }[] = [];
	let current: { path: string; addedLines: { line: number; text: string }[] } | undefined;
	let lineNumber = 0;

	for (const line of diff.split('\n')) {
		const header = /^\+\+\+ b\/(.+)$/.exec(line);
		if (header) {
			current = { path: header[1], addedLines: [] };
			files.push(current);
			continue;
		}
		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
		if (hunk) {
			lineNumber = Number(hunk[1]);
			continue;
		}
		if (!current || line.startsWith('---')) {
			continue;
		}
		if (line.startsWith('+')) {
			current.addedLines.push({ line: lineNumber, text: line.slice(1) });
			lineNumber++;
		} else if (!line.startsWith('-')) {
			lineNumber++;
		}
	}
	return files;
}

/**
 * 見る。
 *
 * **走らせていない確認は `ok` にしない。** 「まだ見ていない」と「見て問題なかった」は違う。
 * ここを一緒にすると、チェックリストが「押すだけのボタン」になる。
 */
export function runPreflight(input: PreflightInput): CheckResult[] {
	const results: CheckResult[] = [];

	results.push({
		id: 'branch',
		label: 'ブランチ',
		status: input.branch === input.releaseBranch ? 'ok' : 'warn',
		detail:
			input.branch === input.releaseBranch
				? `${input.branch} にいます`
				: `いま ${input.branch} にいます（出す先は ${input.releaseBranch}）。意図した通りか確かめてください`
	});

	results.push({
		id: 'dirty',
		label: 'コミットしていない変更',
		status: input.dirtyFiles.length === 0 ? 'ok' : 'stop',
		detail:
			input.dirtyFiles.length === 0
				? 'ありません'
				: `${input.dirtyFiles.length} 件あります。**出したものと手元が食い違います** — ${input.dirtyFiles.slice(0, 3).join(', ')}${input.dirtyFiles.length > 3 ? ' ほか' : ''}`
	});

	results.push({
		id: 'unpushed',
		label: 'push していないコミット',
		status: input.unpushedCommits === 0 ? 'ok' : 'stop',
		detail:
			input.unpushedCommits === 0
				? 'ありません'
				: `${input.unpushedCommits} 件あります。**手元にしかない変更は、出した先に入りません**`
	});

	results.push({
		id: 'tests',
		label: 'テスト',
		status: input.testsPassed === undefined ? 'unknown' : input.testsPassed ? 'ok' : 'stop',
		detail:
			input.testsPassed === undefined
				? 'まだ走らせていません'
				: input.testsPassed
					? '通りました'
					: '落ちています'
	});

	results.push({
		id: 'build',
		label: 'ビルド',
		status: input.buildPassed === undefined ? 'unknown' : input.buildPassed ? 'ok' : 'stop',
		detail:
			input.buildPassed === undefined ? 'まだ走らせていません' : input.buildPassed ? '通りました' : '落ちています'
	});

	// `.only(` は「1 件だけ通って全部通ったように見える」ので、警告ではなく止める
	const onlyCalls = input.leftovers.filter((leftover) => /\.only\(/.test(leftover.text));
	if (onlyCalls.length > 0) {
		results.push({
			id: 'only',
			label: 'テストの絞り込み',
			status: 'stop',
			detail: `\`.only(\` が ${onlyCalls.length} 件残っています。**他のテストが走っていません** — ${onlyCalls[0].file}:${onlyCalls[0].line}`
		});
	}

	const others = input.leftovers.filter((leftover) => !/\.only\(/.test(leftover.text));
	results.push({
		id: 'leftovers',
		label: '消し忘れ',
		status: others.length === 0 ? 'ok' : 'warn',
		detail:
			others.length === 0
				? 'ありません'
				: `${others.length} 件（${others.slice(0, 2).map((leftover) => `${leftover.file}:${leftover.line}`).join(', ')}）`
	});

	results.push({
		id: 'version',
		label: '版',
		status: input.versionBumped === undefined ? 'unknown' : input.versionBumped ? 'ok' : 'warn',
		detail:
			input.versionBumped === undefined
				? '確かめられませんでした'
				: input.versionBumped
					? '上がっています'
					: '前回の出荷から上がっていません。同じ版が二度出ると、どちらが動いているか分からなくなります'
	});

	return results;
}

/** 出してよいか。**「まだ見ていない」は「よい」ではない** */
export function canShip(results: readonly CheckResult[]): boolean {
	return results.every((result) => result.status === 'ok' || result.status === 'warn');
}

const MARK: Record<CheckStatus, string> = { ok: '✅', warn: '⚠️', stop: '⛔️', unknown: '❔' };

export function renderPreflight(results: readonly CheckResult[]): string {
	const stops = results.filter((result) => result.status === 'stop');
	const unknowns = results.filter((result) => result.status === 'unknown');

	const lines = ['# 出す前に', ''];

	if (stops.length > 0) {
		lines.push(`**まだ出せません。** 止まっているものが ${stops.length} 件あります。`, '');
	} else if (unknowns.length > 0) {
		lines.push(`止まっているものはありませんが、**${unknowns.length} 件はまだ確かめていません**。`, '');
	} else {
		lines.push('**出せます。**', '');
	}

	for (const result of results) {
		lines.push(`- ${MARK[result.status]} **${result.label}** — ${result.detail}`);
	}
	lines.push('');

	if (stops.length > 0) {
		lines.push('## 先に片づけるもの', '');
		for (const stop of stops) {
			lines.push(`1. ${stop.label} — ${stop.detail}`);
		}
		lines.push('');
	}

	lines.push('**このリストは、思い出す手間を無くすためのものです。** 中身の妥当性は見ていません。', '');
	return lines.join('\n');
}
