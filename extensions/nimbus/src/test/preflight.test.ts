/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { test } from 'node:test';
import { addedLinesFromDiff, canShip, findLeftovers, renderPreflight, runPreflight, type PreflightInput } from '../core/preflight';

const CLEAN: PreflightInput = {
	dirtyFiles: [],
	unpushedCommits: 0,
	branch: 'main',
	releaseBranch: 'main',
	testsPassed: true,
	buildPassed: true,
	leftovers: [],
	versionBumped: true
};

function statuses(input: PreflightInput): Record<string, string> {
	return Object.fromEntries(runPreflight(input).map((result) => [result.id, result.status]));
}

test('全部そろっていれば出せる', () => {
	assert.deepStrictEqual(statuses(CLEAN), {
		branch: 'ok',
		dirty: 'ok',
		unpushed: 'ok',
		tests: 'ok',
		build: 'ok',
		leftovers: 'ok',
		version: 'ok'
	});
	assert.ok(canShip(runPreflight(CLEAN)));
});

test('走らせていない確認は ok にしない（「まだ見ていない」と「問題なかった」は違う）', () => {
	const results = runPreflight({ ...CLEAN, testsPassed: undefined, buildPassed: undefined });
	assert.deepStrictEqual(
		results.filter((result) => result.status === 'unknown').map((result) => result.id),
		['tests', 'build']
	);
	// 確かめていないものがあるうちは出せない
	assert.strictEqual(canShip(results), false);
});

test('コミットしていない変更と push していないコミットは止める', () => {
	const results = statuses({ ...CLEAN, dirtyFiles: ['src/a.ts'], unpushedCommits: 2 });
	assert.deepStrictEqual([results.dirty, results.unpushed], ['stop', 'stop']);
});

test('出す先と違うブランチは、止めずに知らせる', () => {
	assert.strictEqual(statuses({ ...CLEAN, branch: 'feature/x' }).branch, 'warn');
});

test('.only( は止める（他のテストが走っていないため）', () => {
	const results = runPreflight({
		...CLEAN,
		leftovers: [{ file: 'src/test/a.test.ts', line: 3, text: 'test.only("x", () => {})' }]
	});
	const only = results.find((result) => result.id === 'only');
	assert.strictEqual(only?.status, 'stop');
	assert.ok(only.detail.includes('他のテストが走っていません'));
	// 消し忘れ側には数えない
	assert.strictEqual(results.find((result) => result.id === 'leftovers')?.status, 'ok');
});

test('console.log は知らせるだけ（全部赤くすると誰も読まなくなる）', () => {
	assert.strictEqual(
		statuses({ ...CLEAN, leftovers: [{ file: 'src/a.ts', line: 9, text: 'console.log(x)' }] }).leftovers,
		'warn'
	);
});

test('変更した行から消し忘れを拾う。テストの中の console.log は数えない', () => {
	assert.deepStrictEqual(
		findLeftovers([
			{ path: 'src/a.ts', addedLines: [{ line: 1, text: 'console.log(x)' }, { line: 2, text: 'const y = 1' }] },
			{ path: 'src/test/a.test.ts', addedLines: [{ line: 5, text: '  console.log(y)' }, { line: 6, text: 'test.only("x")' }] },
			{ path: 'src/b.ts', addedLines: [{ line: 3, text: '  debugger' }] }
		]),
		[
			{ file: 'src/a.ts', line: 1, text: 'console.log(x)' },
			{ file: 'src/test/a.test.ts', line: 6, text: 'test.only("x")' },
			{ file: 'src/b.ts', line: 3, text: 'debugger' }
		]
	);
});

test('版が上がっていなければ知らせる', () => {
	assert.strictEqual(statuses({ ...CLEAN, versionBumped: false }).version, 'warn');
});

test('止まっているものがあれば、まず「出せません」と書き、片づける順を出す', () => {
	const report = renderPreflight(runPreflight({ ...CLEAN, dirtyFiles: ['src/a.ts'], testsPassed: false }));
	assert.ok(report.includes('まだ出せません'));
	assert.ok(report.indexOf('先に片づけるもの') > report.indexOf('まだ出せません'));
	assert.ok(report.includes('中身の妥当性は見ていません'));
});

test('全部そろっていれば「出せます」と書く', () => {
	assert.ok(renderPreflight(runPreflight(CLEAN)).includes('**出せます。**'));
});

test('diff から、足した行を正しい行番号で拾う', () => {
	const diff = [
		'diff --git a/src/a.ts b/src/a.ts',
		'--- a/src/a.ts',
		'+++ b/src/a.ts',
		'@@ -10,0 +11,2 @@',
		'+console.log(1)',
		'+const x = 2',
		'@@ -20,1 +23,1 @@',
		'-const old = 1',
		'+debugger'
	].join('\n');
	assert.deepStrictEqual(addedLinesFromDiff(diff), [
		{
			path: 'src/a.ts',
			addedLines: [
				{ line: 11, text: 'console.log(1)' },
				{ line: 12, text: 'const x = 2' },
				{ line: 23, text: 'debugger' }
			]
		}
	]);
});

test('--- で始まる行を、消した行と間違えない（ファイル見出しの一部）', () => {
	const diff = '--- a/x.ts\n+++ b/x.ts\n@@ -1,0 +1,1 @@\n+debugger';
	assert.deepStrictEqual(addedLinesFromDiff(diff), [{ path: 'x.ts', addedLines: [{ line: 1, text: 'debugger' }] }]);
});

test('データや文書は走査しない（JSON のコード例を消し忘れと呼ばない）', () => {
	assert.deepStrictEqual(
		findLeftovers([
			{ path: 'docs/history/notes.json', addedLines: [{ line: 3, text: '"example": "console.log(x)"' }] },
			{ path: 'README.md', addedLines: [{ line: 1, text: '    debugger' }] }
		]),
		[]
	);
});

test('出力するのが仕事のファイルの console.log は数えない', () => {
	assert.deepStrictEqual(
		findLeftovers([
			{ path: 'nimbus/branding/make-icon.mjs', addedLines: [{ line: 5, text: 'console.log("done")' }] },
			{ path: 'scripts/release.ts', addedLines: [{ line: 2, text: 'console.log("ok")' }] },
			// コードを組み立てている文字列の中
			{ path: 'src/core/sandbox.ts', addedLines: [{ line: 87, text: "\t'console.log(failed)'," }] }
		]),
		[]
	);
	// 同じファイルでも debugger は残す（出力ではないので）
	assert.deepStrictEqual(
		findLeftovers([{ path: 'scripts/release.ts', addedLines: [{ line: 9, text: 'debugger' }] }]),
		[{ file: 'scripts/release.ts', line: 9, text: 'debugger' }]
	);
});
