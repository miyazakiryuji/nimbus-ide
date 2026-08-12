/**
 * スタックトレースから「開くべき場所」を取り出す（tasks.md T-105）。
 *
 * 例外ログを貼っても、結局そこから自分でファイルを探して開くことになる。
 * その往復が毎回いちばん時間を食うので、**貼った時点で該当行まで行ける**ようにする。
 *
 * 対応するのは Dart / Flutter と JavaScript / TypeScript（Node）。
 * どちらも実際の出力から起こしてある。VS Code に依存しないので単体で検証できる。
 */

export interface StackFrame {
	/** ファイルの場所（`package:` はそのまま持つ。解決は呼び出し側） */
	file: string;
	line: number;
	column?: number;
	/** 関数名など（取れたときだけ） */
	symbol?: string;
	/** 自分のコードらしいか（ライブラリ・生成物・ランタイムでない） */
	own: boolean;
}

/** 自分のコードでないと判断する手がかり */
const FOREIGN = [
	'node_modules/',
	'/flutter/packages/',
	'dart:',
	'package:flutter/',
	'node:internal/',
	'/.pub-cache/',
	'.dart_tool/',
	'/out/',
	'/dist/'
];

function isOwn(file: string): boolean {
	return !FOREIGN.some((part) => file.includes(part));
}

/**
 * Dart / Flutter の行。
 *   `#0      MyApp.build (package:app/main.dart:42:7)`
 *   `#1      _rootRun (dart:async/zone.dart:1391:13)`
 */
const DART = /^\s*#\d+\s+(.+?)\s+\((.+?):(\d+)(?::(\d+))?\)\s*$/;

/**
 * JavaScript / TypeScript の行。
 *   `    at foo (/repo/src/a.ts:10:5)`
 *   `    at /repo/src/a.ts:10:5`
 */
const JS_WITH_SYMBOL = /^\s*at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)\s*$/;
const JS_BARE = /^\s*at\s+(.+?):(\d+):(\d+)\s*$/;

/** `file:///path/to/a.dart:10:5` のような素の位置表記（Flutter の警告などで出る） */
const BARE_LOCATION = /(?:^|\s)((?:file:\/\/)?[\w./\\@-]+\.(?:dart|ts|tsx|js|jsx|mjs|cjs)):(\d+)(?::(\d+))?/;

function frame(file: string, line: string, column?: string, symbol?: string): StackFrame {
	const path = file.replace(/^file:\/\//, '');
	return {
		file: path,
		line: Number(line),
		...(column ? { column: Number(column) } : {}),
		...(symbol ? { symbol } : {}),
		own: isOwn(path)
	};
}

/**
 * 貼られたテキストから位置を拾う。
 * 同じ場所が何度も出る（再スローなど）ので、**重複は最初の 1 つだけ**残す。
 */
export function parseStackTrace(text: string): StackFrame[] {
	const frames: StackFrame[] = [];
	const seen = new Set<string>();
	for (const line of text.split('\n')) {
		let parsed: StackFrame | undefined;
		const dart = DART.exec(line);
		const jsWith = JS_WITH_SYMBOL.exec(line);
		const jsBare = JS_BARE.exec(line);
		if (dart) {
			parsed = frame(dart[2], dart[3], dart[4], dart[1]);
		} else if (jsWith) {
			parsed = frame(jsWith[2], jsWith[3], jsWith[4], jsWith[1]);
		} else if (jsBare) {
			parsed = frame(jsBare[1], jsBare[2], jsBare[3]);
		} else {
			const bare = BARE_LOCATION.exec(line);
			if (bare) {
				parsed = frame(bare[1], bare[2], bare[3]);
			}
		}
		if (!parsed) {
			continue;
		}
		const key = `${parsed.file}:${parsed.line}:${parsed.column ?? ''}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		frames.push(parsed);
	}
	return frames;
}

/**
 * 最初に開くべき場所。
 * ライブラリの中で落ちていても、直せるのはたいてい**自分のコードの一番上のフレーム**。
 * 自分のコードが 1 つも無ければ先頭を返す（何も返さないより、どこかは開けたほうがいい）。
 */
export function firstOwnFrame(frames: readonly StackFrame[]): StackFrame | undefined {
	return frames.find((f) => f.own) ?? frames[0];
}

/**
 * `package:app/main.dart` のような Dart の表記を実ファイルへ寄せる。
 * `package:<パッケージ名>/<パス>` は、そのパッケージのソースなら `lib/<パス>` に当たる。
 * 当てられないときは undefined（当てずっぽうで開かない）。
 */
export function resolvePackageUri(file: string, packageName: string | undefined): string | undefined {
	const match = /^package:([^/]+)\/(.+)$/.exec(file);
	if (!match) {
		return undefined;
	}
	if (packageName && match[1] === packageName) {
		return `lib/${match[2]}`;
	}
	return undefined;
}

/** 一覧に出すときの 1 行 */
export function describeFrame(frame: StackFrame): string {
	const where = `${frame.file}:${frame.line}${frame.column ? `:${frame.column}` : ''}`;
	return frame.symbol ? `${frame.symbol} — ${where}` : where;
}
