/**
 * セッションの開始条件（T-148）と分岐の名前（T-036）の単体テスト。
 *
 * テンプレートは「入力を黙って捨てない」ことが要。捨てると、書いた指示が
 * 消えたことに気づかないまま走り出す。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	applyPreset,
	branchTitle,
	BUILTIN_PRESETS,
	describePreset,
	removePreset,
	upsertPreset
} from '../core/sessionPresets';

test('出荷時のテンプレートが入っている（空から始めさせない）', () => {
	assert.ok(BUILTIN_PRESETS.length >= 3);
	assert.deepStrictEqual(
		BUILTIN_PRESETS.map((preset) => preset.name),
		['調査（書き換えない）', '実装', 'レビュー']
	);
	// 調査とレビューは書き換えさせない
	assert.strictEqual(BUILTIN_PRESETS[0].permissionMode, 'plan');
	assert.strictEqual(BUILTIN_PRESETS[2].permissionMode, 'plan');
});

test('{input} を入力で置き換える', () => {
	assert.strictEqual(applyPreset({ name: 'x', prompt: '前\n{input}\n後' }, 'やること'), '前\nやること\n後');
});

test('{input} が無いテンプレートでも入力を捨てない', () => {
	assert.strictEqual(applyPreset({ name: 'x', prompt: '決まり文句' }, 'やること'), '決まり文句\n\nやること');
	// 入力が空なら、ひな形だけを送る
	assert.strictEqual(applyPreset({ name: 'x', prompt: '決まり文句' }, ''), '決まり文句');
});

test('ひな形が無ければ入力そのものを送る', () => {
	assert.strictEqual(applyPreset({ name: 'x' }, 'やること'), 'やること');
});

test('同じ名前のテンプレートは 2 つ作らない（どちらが呼ばれるか読めなくなる）', () => {
	const first = upsertPreset([], { name: 'a', prompt: '1' });
	const second = upsertPreset(first, { name: 'a', prompt: '2' });
	assert.deepStrictEqual(second, [{ name: 'a', prompt: '2' }]);
});

test('削除は名前で行う', () => {
	assert.deepStrictEqual(removePreset([{ name: 'a' }, { name: 'b' }], 'a'), [{ name: 'b' }]);
});

test('一覧の説明にはモデルと権限モードを出す', () => {
	assert.strictEqual(describePreset({ name: 'x', model: 'opus', permissionMode: 'plan' }), 'opus · plan');
	assert.strictEqual(describePreset({ name: 'x' }), 'default');
});

test('分岐の名前は A 案・B 案。5 を超えたら数字に落とす', () => {
	assert.deepStrictEqual(
		[0, 1, 4, 5].map((index) => branchTitle('ログイン修正', index)),
		['ログイン修正（A 案）', 'ログイン修正（B 案）', 'ログイン修正（E 案）', 'ログイン修正（6 案）']
	);
});
