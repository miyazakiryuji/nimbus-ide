/**
 * ターミナルで落ちたコマンドを、そのままセッションへ渡せる形にする（tasks.md T-169）。
 *
 * テストが落ちた・ビルドが通らないとき、人がやっているのは「出力を選択してコピーして貼る」だけ。
 * その間に何行かは削れるし、ANSI の色コードや進捗バーの書き戻しがそのまま混ざる。
 * ここでは**読める形に均して、末尾だけを切り出す**。フォークなら
 * シェル統合の出力がそのまま取れるので、人が写す作業自体が要らない。
 *
 * VS Code に依存しない。整形の判断だけを置く。
 */

/** 投入する出力の上限。長すぎるとそれだけで文脈を食い潰す */
export const DEFAULT_MAX_LINES = 200;
const MAX_CHARS = 12000;

/**
 * ANSI エスケープ列（色・カーソル移動・OSC）を落とす。
 * シェル統合の制御列（OSC 633）も同じ規則で消える。
 * 制御文字はソースに直接書かず、必ず `\u` 表記で置く（見えない文字は編集で壊れる）。
 */
export function stripAnsi(text: string): string {
	return text
		// OSC: ESC ] … BEL または ESC \
		.replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, '')
		// CSI ほか
		.replace(/[\u001B\u009B][[\]()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]/g, '')
		// 単独の BEL
		.replace(/\u0007/g, '');
}

/**
 * 進捗バーのような「同じ行への書き戻し」を畳む。
 * 端末は `\r` で行頭に戻って上書きするので、**最後に書かれたものだけ**が実際の表示。
 */
export function collapseCarriageReturns(text: string): string {
	return text
		.split('\n')
		.map((line) => {
			const index = line.lastIndexOf('\r');
			return index >= 0 ? line.slice(index + 1) : line;
		})
		.join('\n');
}

/** 読める形に均す（色を落とす → 書き戻しを畳む → 行末の空白を落とす） */
export function normalizeOutput(text: string): string {
	return collapseCarriageReturns(stripAnsi(text))
		.split('\n')
		.map((line) => line.replace(/\s+$/, ''))
		.join('\n');
}

/**
 * 末尾から切り出す。失敗の理由は出力の**終わり**にある。
 * 先頭を残しても、落ちた理由には届かない。
 */
export function tailLines(
	text: string,
	maxLines: number = DEFAULT_MAX_LINES,
	maxChars: number = MAX_CHARS
): { text: string; omittedLines: number } {
	const lines = normalizeOutput(text).split('\n');
	// 末尾の空行は数に入れない（プロンプトの改行で 1 行使われるため）
	while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
		lines.pop();
	}
	let kept = lines.slice(Math.max(0, lines.length - Math.max(1, maxLines)));
	let omitted = lines.length - kept.length;

	// 行数で足りても、1 行が極端に長いことがある（minified なログなど）
	while (kept.length > 1 && kept.join('\n').length > maxChars) {
		kept = kept.slice(1);
		omitted++;
	}
	const joined = kept.join('\n');
	return {
		text: joined.length > maxChars ? joined.slice(joined.length - maxChars) : joined,
		omittedLines: omitted
	};
}

/**
 * 投入を持ちかけないコマンド。
 * 失敗しても人が困っていない（自分で止めた・打ち間違えた）ものまで声をかけると、
 * 通知そのものを切られてしまう。
 */
const IGNORED_COMMANDS = new Set([
	'cd', 'ls', 'll', 'clear', 'exit', 'pwd', 'which', 'man', 'history', 'code', 'open',
	'vi', 'vim', 'nano', 'less', 'more', 'top', 'htop', 'ssh', 'tmux', 'claude', 'nimbus'
]);

/** 利用者が自分で止めたときの終了コード（Ctrl-C / SIGTERM） */
const INTERRUPTED_EXIT_CODES = new Set([130, 143]);

/**
 * 投入を持ちかけるべきか。
 * 終了コードが取れないとき（シェル統合が効いていない）は黙っている — 成否が分からないものを
 * 「失敗しました」と言うと、次から信用されなくなる。
 */
export function shouldOfferCapture(commandLine: string, exitCode: number | undefined): boolean {
	if (exitCode === undefined || exitCode === 0 || INTERRUPTED_EXIT_CODES.has(exitCode)) {
		return false;
	}
	const first = commandLine.trim().split(/\s+/)[0] ?? '';
	if (first.length === 0) {
		return false;
	}
	// `/usr/bin/ls` のような形でも名前で判断する
	const name = first.split('/').pop() ?? first;
	return !IGNORED_COMMANDS.has(name);
}

export interface TerminalFailure {
	commandLine: string;
	cwd?: string;
	exitCode: number;
	output: string;
	maxLines?: number;
}

/** 通知に出す一行。何が落ちたのかがタイトルだけで分かること */
export function failureHeadline(commandLine: string, exitCode: number): string {
	const command = commandLine.trim().replace(/\s+/g, ' ');
	const shown = command.length > 60 ? `${command.slice(0, 60)}…` : command;
	return `${shown} が失敗しました（終了コード ${exitCode}）`;
}

/**
 * セッションへ投入する文。
 *
 * 出力は 4 連バッククォートで囲む。ログの中に ``` が現れても壊れないようにするため。
 */
export function buildFailurePrompt(failure: TerminalFailure): string {
	const { text, omittedLines } = tailLines(failure.output, failure.maxLines ?? DEFAULT_MAX_LINES);
	const parts = [
		`ターミナルで実行した次のコマンドが失敗しました（終了コード ${failure.exitCode}）。`,
		'',
		`    ${failure.commandLine.trim()}`
	];
	if (failure.cwd) {
		parts.push('', `作業ディレクトリ: ${failure.cwd}`);
	}
	parts.push('', omittedLines > 0 ? `出力の末尾（先頭 ${omittedLines} 行は省略）:` : '出力:');
	parts.push('````', text.length > 0 ? text : '（出力はありません）', '````');
	parts.push('', '原因を調べて直してください。まず何が起きているかを説明してから、修正に入ってください。');
	return parts.join('\n');
}
