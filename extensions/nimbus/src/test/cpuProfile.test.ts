/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { test } from 'node:test';
import { buildProfilePrompt, classifyOrigin, ownCode, parseProfile, renderProfile } from '../core/cpuProfile';

/** `node --cpu-prof` が出す形（実物から起こした） */
const PROFILE = JSON.stringify({
	nodes: [
		{ id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1 }, children: [2, 3, 4, 5, 6] },
		{ id: 2, callFrame: { functionName: '(program)', url: '', lineNumber: -1 } },
		{ id: 3, callFrame: { functionName: 'slowThing', url: 'file:///work/app/src/slow.ts', lineNumber: 41 } },
		{ id: 4, callFrame: { functionName: 'normalizeString', url: 'node:path', lineNumber: 90 } },
		{ id: 5, callFrame: { functionName: 'parse', url: 'file:///work/app/node_modules/yaml/index.js', lineNumber: 9 } },
		{ id: 6, callFrame: { functionName: '(idle)', url: '', lineNumber: -1 } },
		// 同じ関数が別の呼び出し経路で 2 度出る
		{ id: 7, callFrame: { functionName: 'slowThing', url: 'file:///work/app/src/slow.ts', lineNumber: 41 } }
	],
	samples: [3, 4, 5, 6, 7, 2],
	timeDeltas: [4000, 1000, 2000, 3000, 6000, 4000],
	startTime: 1000000,
	endTime: 1020000
});

test('自己時間は samples と timeDeltas から出す（hitCount ではなく）', () => {
	const summary = parseProfile(PROFILE);
	assert.deepStrictEqual(
		summary.hotSpots.map((spot) => [spot.name, spot.selfMs, spot.origin]),
		[
			// 4000 + 6000 マイクロ秒（別経路の同じ関数をまとめている）
			['slowThing', 10, 'own'],
			['parse', 2, 'dependency'],
			['normalizeString', 1, 'runtime']
		]
	);
});

test('計測した長さと待っていた時間を出す', () => {
	const summary = parseProfile(PROFILE);
	assert.deepStrictEqual([summary.totalMs, summary.idleMs], [20, 3]);
});

test('どこのコードかを分ける（node_modules を自分のコードに混ぜない）', () => {
	assert.deepStrictEqual(
		['file:///work/src/a.ts', 'node:path', 'file:///work/node_modules/x/i.js', ''].map(classifyOrigin),
		['own', 'runtime', 'dependency', 'engine']
	);
	// node:internal も ランタイム
	assert.strictEqual(classifyOrigin('node:internal/modules/cjs/loader'), 'runtime');
});

test('直しに行ける場所だけを取り出せる', () => {
	assert.deepStrictEqual(
		ownCode(parseProfile(PROFILE).hotSpots).map((spot) => spot.name),
		['slowThing']
	);
});

test('読めないものは、読めないと言う', () => {
	assert.deepStrictEqual(parseProfile('{'), { hotSpots: [], totalMs: 0, idleMs: 0 });
	assert.ok(renderProfile(parseProfile('{')).includes('読み取れませんでした'));
});

test('報告は 直せる場所 を先に出し、測り直しを促す', () => {
	const report = renderProfile(parseProfile(PROFILE));
	assert.ok(report.indexOf('直しに行ける場所') < report.indexOf('直接は直せない'));
	assert.ok(report.includes('slow.ts:42'));
	assert.ok(report.includes('測り直して比べてください'));
});

test('自分のコードに時間が出ていなければ、呼ぶ回数を減らす方へ向ける', () => {
	const onlyRuntime = JSON.stringify({
		nodes: [{ id: 1, callFrame: { functionName: 'read', url: 'node:fs', lineNumber: 1 } }],
		samples: [1],
		timeDeltas: [5000],
		startTime: 0,
		endTime: 5000
	});
	const summary = parseProfile(onlyRuntime);
	assert.ok(renderProfile(summary).includes('自分のコードには、目立つ時間が出ていません'));
	assert.ok(buildProfilePrompt(summary).includes('呼ぶ回数を減らせないか'));
});

test('頼みかたは「まず理由と測り方」で、いきなり直させない', () => {
	const prompt = buildProfilePrompt(parseProfile(PROFILE));
	assert.ok(prompt.includes('まだ直さないでください'));
	assert.ok(prompt.includes('速くなったことをどう確かめるか'));
	// 直せない場所は渡さない
	assert.ok(!prompt.includes('normalizeString'));
});

test('無名関数は、場所で呼べるようにする', () => {
	const anonymous = JSON.stringify({
		nodes: [{ id: 1, callFrame: { functionName: '', url: 'file:///work/src/a.ts', lineNumber: 7 } }],
		samples: [1],
		timeDeltas: [1000],
		startTime: 0,
		endTime: 1000
	});
	assert.deepStrictEqual(parseProfile(anonymous).hotSpots, [
		{ name: '(無名)', file: 'file:///work/src/a.ts', line: 8, selfMs: 1, origin: 'own' }
	]);
});
