/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { test } from 'node:test';
import { describePlan, maxPanes, MIN_COLUMNS, planPanes } from '../core/terminalLayout';

test('幅から、読める枚数を出す', () => {
	assert.deepStrictEqual(
		[240, 120, 80, 40, 20].map((width) => maxPanes(width)),
		[5, 2, 1, 1, 1]
	);
});

test('幅が分からないときは 4 枚まで（画面の広さを勝手に決めない）', () => {
	assert.deepStrictEqual([maxPanes(), maxPanes(0)], [4, 4]);
});

test('頼まれた枚数がそのまま置けるなら、何も言わない', () => {
	assert.deepStrictEqual(planPanes({ count: 3, widthColumns: 240 }), {
		panes: [
			{ name: 'ターミナル 1', cwd: undefined },
			{ name: 'ターミナル 2', cwd: undefined },
			{ name: 'ターミナル 3', cwd: undefined }
		]
	});
});

test('幅が足りなければ減らし、減らしたと言う（黙って減らさない）', () => {
	const plan = planPanes({ count: 6, widthColumns: 120 });
	assert.strictEqual(plan.panes.length, 2);
	assert.ok(plan.note?.includes('6 枚は幅が足りないので 2 枚にしました'));
	assert.ok(plan.note?.includes(`${MIN_COLUMNS} 桁`));
});

test('フォルダが複数あれば、フォルダごとに 1 枚（どれがどれか分かるように）', () => {
	assert.deepStrictEqual(
		planPanes({
			count: 4,
			widthColumns: 240,
			folders: [
				{ name: 'app', path: '/w/app' },
				{ name: 'api', path: '/w/api' }
			]
		}).panes,
		[
			{ name: 'app 1', cwd: '/w/app' },
			{ name: 'api 1', cwd: '/w/api' },
			{ name: 'app 2', cwd: '/w/app' },
			{ name: 'api 2', cwd: '/w/api' }
		]
	);
});

test('フォルダが 1 つなら、そのフォルダで通し番号', () => {
	assert.deepStrictEqual(planPanes({ count: 2, widthColumns: 240, folders: [{ name: 'app', path: '/w/app' }] }).panes, [
		{ name: 'ターミナル 1', cwd: '/w/app' },
		{ name: 'ターミナル 2', cwd: '/w/app' }
	]);
});

test('枚数がフォルダ数に足りなければ、出ていないフォルダを名指しする', () => {
	const plan = planPanes({
		count: 2,
		widthColumns: 240,
		folders: [
			{ name: 'app', path: '/w/app' },
			{ name: 'api', path: '/w/api' },
			{ name: 'docs', path: '/w/docs' }
		]
	});
	assert.ok(plan.note?.includes('docs は出ていません'));
});

test('0 枚や小数を頼まれても 1 枚は出す', () => {
	assert.deepStrictEqual([planPanes({ count: 0 }).panes.length, planPanes({ count: 2.7 }).panes.length], [1, 2]);
});

test('押す前に、何が起きるかを見せる', () => {
	assert.strictEqual(
		describePlan(planPanes({ count: 2, widthColumns: 240 })),
		'2 枚: ターミナル 1 / ターミナル 2'
	);
	assert.ok(describePlan(planPanes({ count: 9, widthColumns: 120 })).includes('幅が足りない'));
});

test('読めないと分かっていても、頼んだ枚数のまま並べる道は残す', () => {
	const forced = planPanes({ count: 6, widthColumns: 120, force: true });
	assert.strictEqual(forced.panes.length, 6);
	assert.strictEqual(forced.note, undefined);
});
