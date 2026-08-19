/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** 守っている修正（T-274）: T-223 */

import * as assert from 'assert';
import { test } from 'node:test';
import {
	buildGifArgs,
	describeSize,
	estimateBytes,
	manualInstructions,
	MAX_FRAMES,
	planCapture,
	renderPlan
} from '../core/gifExport';

test('収まる長さなら、頼まれたとおりに撮る', () => {
	assert.deepStrictEqual(planCapture(10, 5), { frames: 50, intervalMs: 200, seconds: 10 });
});

test('枚数が上限を超えたら、長さは守って滑らかさを落とす', () => {
	const plan = planCapture(30, 10);
	assert.deepStrictEqual([plan.frames, plan.seconds, plan.intervalMs], [120, 30, 250]);
	assert.ok(plan.note?.includes('4 fps に落としました'));
});

test('1 fps でも収まらない長さは、長さを削って、削ったと言う', () => {
	const plan = planCapture(300, 10);
	assert.deepStrictEqual([plan.frames, plan.seconds], [MAX_FRAMES, MAX_FRAMES]);
	assert.ok(plan.note?.includes('長すぎる'));
});

test('境目: 1 fps でちょうど収まる長さは、長さを削らない', () => {
	const plan = planCapture(MAX_FRAMES, 10);
	assert.deepStrictEqual([plan.frames, plan.seconds, plan.intervalMs], [MAX_FRAMES, MAX_FRAMES, 1000]);
	assert.ok(!plan.note?.includes('長すぎる'));
	// 1 枚超えるだけで、長さを削る側に入る
	assert.ok(planCapture(MAX_FRAMES + 1, 10).note?.includes('長すぎる'));
});

test('fps は 1〜10 に収める（それ以上細かくしてもファイルが増えるだけ）', () => {
	assert.deepStrictEqual([planCapture(5, 60).frames, planCapture(5, 0).frames], [50, 5]);
});

test('0 秒でも 1 秒は撮る', () => {
	assert.strictEqual(planCapture(0, 5).seconds, 1);
});

test('大きさは、貼る前に分かる形で言う', () => {
	assert.deepStrictEqual(
		[describeSize(estimateBytes(120, 800)), describeSize(estimateBytes(5, 400))],
		['11.7 MB', '125 KB']
	);
});

test('色は 1 度作って使い回す（既定の 256 色だと文字が読めなくなる）', () => {
	const args = buildGifArgs({ inputPattern: '/tmp/f-%03d.png', outputPath: '/tmp/out.gif', fps: 5, width: 800 });
	const filter = args[args.indexOf('-vf') + 1];
	assert.ok(filter.includes('palettegen'));
	assert.ok(filter.includes('paletteuse'));
	assert.ok(filter.includes('split[a][b]'));
	// 繰り返し再生
	assert.deepStrictEqual([args[args.indexOf('-loop') + 1], args[args.length - 1]], ['0', '/tmp/out.gif']);
});

test('ffmpeg が無いときは、そのまま打てる形で渡す', () => {
	const text = manualInstructions({
		inputPattern: '/tmp/f-%03d.png',
		outputPath: '/tmp/out.gif',
		fps: 5,
		width: 800
	});
	assert.ok(text.includes('ffmpeg -y -framerate 5 -i /tmp/f-%03d.png'));
	assert.ok(text.includes('brew install ffmpeg'));
	// 撮ったものが無駄にならないと分かる
	assert.ok(text.includes('フレームは撮ってあるので'));
});

test('計画は、撮る前に枚数と大きさを見せる', () => {
	const text = renderPlan(planCapture(30, 10), 800);
	assert.ok(text.includes('30 秒 / 120 枚（4 fps）'));
	assert.ok(text.includes('MB'));
	assert.ok(text.includes('4 fps に落としました'));
});
