/**
 * スタックトレースの解決（T-105）の単体テスト。
 *
 * いちばん効くのは「自分のコードの一番上」を選べること。ライブラリの中で落ちていても、
 * 直せるのはたいてい自分の側なので、そこを外すと役に立たない。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { describeFrame, firstOwnFrame, parseStackTrace, resolvePackageUri } from '../core/stackTrace';

const dartTrace = [
	'Unhandled exception:',
	'#0      _rootRun (dart:async/zone.dart:1391:13)',
	'#1      MyApp.build (package:app/ui/home.dart:42:7)',
	'#2      StatelessElement.build (package:flutter/src/widgets/framework.dart:5480:49)'
].join('\n');

const jsTrace = [
	'TypeError: Cannot read properties of undefined',
	'    at handle (/repo/src/handler.ts:10:5)',
	'    at /repo/node_modules/express/lib/router.js:281:22',
	'    at process (node:internal/process/task_queues:95:5)'
].join('\n');

test('Dart のトレースから関数名と位置を拾う', () => {
	assert.deepStrictEqual(
		parseStackTrace(dartTrace).map((f) => ({ file: f.file, line: f.line, symbol: f.symbol, own: f.own })),
		[
			{ file: 'dart:async/zone.dart', line: 1391, symbol: '_rootRun', own: false },
			{ file: 'package:app/ui/home.dart', line: 42, symbol: 'MyApp.build', own: true },
			{ file: 'package:flutter/src/widgets/framework.dart', line: 5480, symbol: 'StatelessElement.build', own: false }
		]
	);
});

test('JavaScript のトレースから拾う（関数名なしの行も）', () => {
	assert.deepStrictEqual(
		parseStackTrace(jsTrace).map((f) => `${f.file}:${f.line}:${f.own}`),
		['/repo/src/handler.ts:10:true', '/repo/node_modules/express/lib/router.js:281:false', 'node:internal/process/task_queues:95:false']
	);
});

test('自分のコードの一番上を選ぶ（ライブラリで落ちていても）', () => {
	assert.deepStrictEqual(
		[firstOwnFrame(parseStackTrace(dartTrace))?.file, firstOwnFrame(parseStackTrace(jsTrace))?.file],
		['package:app/ui/home.dart', '/repo/src/handler.ts']
	);
});

test('自分のコードが無ければ先頭を返す（何も返さないよりまし）', () => {
	const onlyForeign = parseStackTrace('#0      x (dart:core/errors.dart:1:1)');
	assert.strictEqual(firstOwnFrame(onlyForeign)?.file, 'dart:core/errors.dart');
});

test('同じ場所は 1 度だけ（再スローで並ぶため）', () => {
	assert.strictEqual(parseStackTrace([jsTrace, jsTrace].join('\n')).length, 3);
});

test('素の位置表記（file:// つき）も拾う', () => {
	assert.deepStrictEqual(
		parseStackTrace('Error at file:///repo/lib/main.dart:7:3 — 詳細').map((f) => `${f.file}:${f.line}:${f.column}`),
		['/repo/lib/main.dart:7:3']
	);
});

test('package: は自分のパッケージのときだけ lib/ に寄せる', () => {
	assert.deepStrictEqual(
		[
			resolvePackageUri('package:app/ui/home.dart', 'app'),
			resolvePackageUri('package:flutter/src/x.dart', 'app'),
			resolvePackageUri('/repo/a.dart', 'app')
		],
		['lib/ui/home.dart', undefined, undefined]
	);
});

test('一覧の 1 行は関数名があれば添える', () => {
	assert.deepStrictEqual(
		parseStackTrace(jsTrace).slice(0, 1).map(describeFrame),
		['handle — /repo/src/handler.ts:10:5']
	);
});
