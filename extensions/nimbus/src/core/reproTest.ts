/**
 * 再現手順の生成（tasks.md T-143）。
 *
 * 障害のログを見て直しにいくとき、いちばんやってはいけないのが
 * **再現しないまま直したつもりになる**こと。直ったかどうかを確かめる手立てが無いまま
 * コードだけ変わり、次に同じ障害が来たときにまた最初から調べ直すことになる。
 *
 * ここは、ログから**まず落ちるテスト**の雛形を起こす。赤 → 緑の順序を作るのが目的。
 *
 * **入力までは分からない。** どんな値を渡すと落ちるかはログには書かれていないことが多く、
 * そこを埋めるのは人と Claude の仕事。だから雛形は「ここを埋めれば落ちるはず」の形にして、
 * **埋めるべき場所を隠さない**。
 *
 * スタックの読み取りは `core/stackTrace.ts`（T-105）を使う。同じものを二度書かない。
 * VS Code に依存しないので単体で検証できる。
 */
import { parseStackTrace, type StackFrame } from './stackTrace';

export type TestFramework = 'node' | 'vitest' | 'jest' | 'dart';

/** package.json / pubspec.yaml の中身から、使うテストの書き方を決める */
export function detectFramework(files: readonly string[], manifest: string): TestFramework | undefined {
	if (files.includes('pubspec.yaml')) {
		return 'dart';
	}
	if (!files.includes('package.json')) {
		return undefined;
	}
	if (/"vitest"\s*:/.test(manifest)) {
		return 'vitest';
	}
	if (/"jest"\s*:/.test(manifest)) {
		return 'jest';
	}
	return 'node';
}

export interface ErrorReport {
	/** `TypeError` など。取れなければ undefined */
	type?: string;
	message: string;
	frames: StackFrame[];
	/** 自分のコードで最初に出てくる場所。ここが再現の入口になる */
	origin?: StackFrame;
}

/** 1 行目から `TypeError: メッセージ` を読む */
const HEAD = /^\s*(?:Uncaught\s+)?((?:[A-Z][\w.$]*)?(?:Error|Exception))\s*:\s*(.+?)\s*$/;

/**
 * 貼られたログを読む。Sentry の本文でも、端末に出た例外でも、
 * **1 行目とスタックがあれば読める**形にしてある。
 */
export function parseErrorReport(text: string): ErrorReport | undefined {
	const lines = text.split('\n');
	let type: string | undefined;
	let message = '';
	for (const line of lines) {
		const match = HEAD.exec(line);
		if (match) {
			type = match[1];
			message = match[2];
			break;
		}
	}
	const frames = parseStackTrace(text);
	if (!message) {
		// 型が読めなくても、最初の中身のある行をメッセージとして扱う
		message = lines.map((line) => line.trim()).find((line) => line && !/^\s*at\s/.test(line)) ?? '';
	}
	if (!message && frames.length === 0) {
		return undefined;
	}
	// `firstOwnFrame`（T-105）は見つからなければ先頭に落とすが、ここではそれだと
	// 依存の中にテストを置くことになる。**自分のコードだけ**を入口にする
	return { type, message, frames, origin: frames.find((frame) => frame.own) };
}

/** テストの置き場所と名前。`src/a/b.ts` から落ちたなら `src/a/b.repro.test.ts` */
export function reproTestPath(origin: StackFrame | undefined, framework: TestFramework): string | undefined {
	const file = origin?.file;
	if (!file) {
		return undefined;
	}
	const path = file.replace(/\\/g, '/');
	if (framework === 'dart') {
		const dart = /^(?:lib\/)?(.*)\.dart$/.exec(path.replace(/^.*?lib\//, 'lib/').replace(/^lib\//, ''));
		return dart ? `test/${dart[1]}_repro_test.dart` : undefined;
	}
	const ts = /^(.*)\.([jt]sx?)$/.exec(path);
	return ts ? `${ts[1]}.repro.test.${ts[2]}` : undefined;
}

function jsHeader(framework: TestFramework): string[] {
	if (framework === 'vitest') {
		return ["import { expect, test } from 'vitest';"];
	}
	if (framework === 'jest') {
		return [];
	}
	return ["import * as assert from 'assert';", "import { test } from 'node:test';"];
}

function jsAssert(framework: TestFramework, expression: string, contains: string): string {
	if (framework === 'node') {
		return `\t\tassert.match(String(error), /${contains}/);`;
	}
	return `\t\texpect(String(error)).toContain(${expression});`;
}

/** 正規表現に入れても壊れない形にする */
function escapeForRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** 引用符に入れても壊れない形にする */
function escapeForQuotes(text: string): string {
	return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * まず落ちるテストの雛形。
 *
 * **通る形では作らない。** 通るテストを置いても、再現できていないことに気づけない。
 * 入力が分からない場所は `TODO` にして、そこを埋めるまで落ち続けるようにする。
 */
export function buildReproTest(report: ErrorReport, framework: TestFramework): string {
	const title = `${report.type ? `${report.type}: ` : ''}${report.message}`.slice(0, 120);
	const where = report.origin ? `${report.origin.file}:${report.origin.line}` : '（場所が読み取れませんでした）';

	if (framework === 'dart') {
		return [
			"import 'package:test/test.dart';",
			'',
			'// 障害の再現テスト（Nimbus が起こした雛形）',
			`// 起きたこと: ${title}`,
			`// 出たところ: ${where}`,
			'//',
			'// **このテストは、いまは落ちます。** どんな入力で落ちたかはログに書かれていないので、',
			'// TODO を埋めて「落ちること」を再現してから、直して緑にしてください。',
			'',
			'void main() {',
			`  test('再現: ${escapeForQuotes(report.message).slice(0, 60)}', () {`,
			'    // TODO: 落ちたときの入力を書く',
			'    fail(\'再現の入力がまだ書かれていません\');',
			'  });',
			'}',
			''
		].join('\n');
	}

	const lines = [
		...jsHeader(framework),
		'',
		'// 障害の再現テスト（Nimbus が起こした雛形）',
		`// 起きたこと: ${title}`,
		`// 出たところ: ${where}`,
		'//',
		'// **このテストは、いまは落ちます。** どんな入力で落ちたかはログに書かれていないので、',
		'// TODO を埋めて「落ちること」を再現してから、直して緑にしてください。',
		'',
		`test('再現: ${escapeForQuotes(report.message).slice(0, 60)}', () => {`,
		'\tlet error: unknown;',
		'\ttry {',
		'\t\t// TODO: 落ちたときの呼び出しを書く',
		`\t\tthrow new Error('再現の入力がまだ書かれていません');`,
		'\t} catch (caught) {',
		'\t\terror = caught;',
		'\t}',
		'',
		jsAssert(framework, `'${escapeForQuotes(report.message).slice(0, 60)}'`, escapeForRegex(report.message).slice(0, 60)),
		'});',
		''
	];
	return lines.join('\n');
}

/** 直す前に読ませる、状況のまとめ */
export function formatReport(report: ErrorReport): string {
	const lines = [
		'# 障害の再現',
		'',
		`**${report.type ? `${report.type}: ` : ''}${report.message}**`,
		''
	];
	if (report.origin) {
		lines.push(`自分のコードで最初に出てくるのは \`${report.origin.file}:${report.origin.line}\` です。`, '');
	} else {
		lines.push(
			'自分のコードの行が見つかりませんでした（依存の中だけで落ちている可能性があります）。',
			''
		);
	}
	if (report.frames.length > 0) {
		lines.push('## スタック', '');
		for (const frame of report.frames.slice(0, 15)) {
			lines.push(`- \`${frame.file}:${frame.line}\`${frame.symbol ? ` — ${frame.symbol}` : ''}`);
		}
		lines.push('');
	}
	lines.push(
		'## 先にやること',
		'',
		'**再現するテストを先に書いてください。**再現できないまま直すと、直ったかどうかを',
		'確かめる手立てが無くなり、次に同じ障害が来たときにまた最初から調べ直すことになります。',
		'',
		'- どんな入力で落ちたかはログに書かれていないことが多い。そこは推測せず、**分からないと書く**',
		'- 再現できたら、その状態（赤）をコミットしてから直す',
		''
	);
	return lines.join('\n');
}
