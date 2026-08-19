/**
 * どのワークスペースフォルダの話かを決める。
 *
 * 要件は「**フォルダが 1 つなら何も聞かない**」と
 * 「入れ子のルートでは近い方が当たる」の 2 つ。
 *
 * 守っている修正（T-274）: T-173
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { needsPicking, rootFor } from '../core/workspaceRoots';

const MONOREPO = [
	{ name: 'repo', path: '/w/repo' },
	{ name: 'app', path: '/w/repo/packages/app' }
];

test('フォルダが 1 つなら、手がかりが無くてもそれを使う', () => {
	assert.deepStrictEqual(rootFor([{ name: 'a', path: '/w/a' }], undefined), { name: 'a', path: '/w/a' });
	assert.strictEqual(needsPicking([{ name: 'a', path: '/w/a' }], undefined), false);
});

test('入れ子のルートでは、いちばん深く一致するものを選ぶ', () => {
	assert.deepStrictEqual(rootFor(MONOREPO, '/w/repo/packages/app/lib/main.dart'), MONOREPO[1]);
	assert.deepStrictEqual(rootFor(MONOREPO, '/w/repo/tool/x.ts'), MONOREPO[0]);
});

test('手がかりで決まるなら聞かない', () => {
	assert.strictEqual(needsPicking(MONOREPO, '/w/repo/packages/app/lib/main.dart'), false);
});

test('どのフォルダにも属さないファイルのときだけ聞く', () => {
	assert.strictEqual(rootFor(MONOREPO, '/elsewhere/x.ts'), undefined);
	assert.strictEqual(needsPicking(MONOREPO, '/elsewhere/x.ts'), true);
	assert.strictEqual(needsPicking(MONOREPO, undefined), false);
});

test('フォルダが無ければ決まらない', () => {
	assert.strictEqual(rootFor([], '/w/a/x.ts'), undefined);
	assert.strictEqual(needsPicking([], undefined), false);
});
