/**
 * 実機ログの取り込み（tasks.md T-074）。
 *
 * クラッシュログを貼っても、そのままでは長すぎて文脈を食うだけ。
 * 欲しいのは「**どこで落ちたか**」で、それは**自分のコードのフレーム**にしか無い。
 * ライブラリとランタイムのフレームを畳んで、開くべき場所を先に出す。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface StackFrame {
	/** 元の行（そのまま残す。切り取ると読めなくなる） */
	raw: string;
	/** 取り出せたファイルのパス */
	file?: string;
	line?: number;
	/** 自分のコードらしいか */
	own: boolean;
}

/**
 * 自分のコードではないと分かる場所。
 *
 * `dart:` は **`.dart:` に当たらないように**する必要がある
 * （`login_page.dart:42` の中に `dart:` が含まれるため。実際にこれで
 * 自分のファイルをライブラリと誤判定した）。直前が単語文字とドットでないときだけ拾う。
 */
const FOREIGN = /(node_modules|\.pub-cache|flutter\/packages|\/usr\/lib|(?<![\w.])dart:|package:flutter\/|<anonymous>|node:internal)/;

/**
 * よくある形からファイルと行を拾う。
 * 完全な解析はしない — 言語ごとに形が違うので、**拾えたものだけ**使う。
 */
const PATTERNS: RegExp[] = [
	// Dart / Flutter: `#12  Foo.bar (package:app/main.dart:42:5)`
	/\((?<file>[^\s()]+?):(?<line>\d+)(?::\d+)?\)/,
	// JS / TS: `at foo (/w/src/a.ts:12:3)` / `at /w/src/a.ts:12:3`
	/at\s+(?:[^\s(]+\s+\()?(?<file2>[^\s()]+?):(?<line2>\d+)(?::\d+)?\)?/,
	// Swift / Kotlin: `at App.swift:42` / `App.kt:42`
	/(?<file3>[\w./-]+\.(?:swift|kt|java|py|rb|go)):(?<line3>\d+)/
];

function extract(line: string): { file?: string; line?: number } {
	for (const pattern of PATTERNS) {
		const match = pattern.exec(line);
		const groups = match?.groups;
		if (!groups) {
			continue;
		}
		const file = groups['file'] ?? groups['file2'] ?? groups['file3'];
		const lineNumber = groups['line'] ?? groups['line2'] ?? groups['line3'];
		if (file) {
			return { file, line: lineNumber ? Number(lineNumber) : undefined };
		}
	}
	return {};
}

export interface CrashReport {
	/** 例外の種類とメッセージ（先頭の数行から拾う） */
	headline: string;
	frames: StackFrame[];
	/** 自分のコードのフレームだけ */
	ownFrames: StackFrame[];
}

/** 見出しにする行数。長い前置きは要らない */
const HEADLINE_LINES = 3;

export function parseCrashLog(text: string): CrashReport {
	const lines = text.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
	const frames: StackFrame[] = [];
	for (const line of lines) {
		const { file, line: lineNumber } = extract(line);
		if (!file) {
			continue;
		}
		frames.push({ raw: line.trim(), file, line: lineNumber, own: !FOREIGN.test(line) });
	}
	// 見出しは、フレームでない先頭の行から取る（例外名とメッセージがここにある）
	const headline = lines
		.filter((line) => !extract(line).file)
		.slice(0, HEADLINE_LINES)
		.join(' ')
		.trim();
	return { headline: headline || '（種類を読み取れませんでした）', frames, ownFrames: frames.filter((f) => f.own) };
}

/**
 * セッションへ渡す文を組み立てる。
 *
 * **全文は貼らない。** 自分のコードのフレームを先に置き、
 * それ以外は「畳んだ」ことだけ伝える。長い全文を渡すと文脈を食うだけで、
 * 読むべき場所は結局その中の数行しかない。
 */
export function buildCrashPrompt(report: CrashReport, maxOwn = 8): string {
	const lines = ['実機で落ちました。原因を調べてください。', '', `症状: ${report.headline}`, ''];
	if (report.ownFrames.length > 0) {
		lines.push('このプロジェクトのコードで通ったところ:', '');
		for (const frame of report.ownFrames.slice(0, maxOwn)) {
			lines.push(`- ${frame.raw}`);
		}
		if (report.ownFrames.length > maxOwn) {
			lines.push(`- （ほか ${report.ownFrames.length - maxOwn} 件）`);
		}
		lines.push('');
		lines.push('まず上の行を開いて読み、原因の見当を述べてください。直すのはその後です。');
	} else {
		// 自分のコードが 1 つも無いなら、そう言う（無いものをあるように見せない）
		lines.push(
			'このプロジェクトのコードのフレームは見つかりませんでした。',
			`ライブラリ側のフレームが ${report.frames.length} 件あります。呼び出し元から辿ってください。`
		);
	}
	const foreign = report.frames.length - report.ownFrames.length;
	if (foreign > 0) {
		lines.push('', `（ライブラリ・ランタイムのフレーム ${foreign} 件は畳みました）`);
	}
	return lines.join('\n');
}
