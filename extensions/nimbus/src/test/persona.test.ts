/**
 * ペルソナ・状態の色・書く番（T-063 / T-064 / T-190 / T-191）の単体テスト。
 *
 * 色は**新しい配色を足さない**（既存トークンへ寄せる）方針なので、
 * 「異常でない状態を目立たせない」ことを押さえる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	BUILTIN_PERSONAS,
	findPersona,
	stateColor,
	stateLabel,
	TURN_MODE_LABEL,
	turnModeInstruction
} from '../core/persona';

test('既定は「そのまま」で、何も足さない', () => {
	assert.strictEqual(BUILTIN_PERSONAS[0].name, 'そのまま');
	assert.strictEqual(BUILTIN_PERSONAS[0].instruction, '');
	assert.strictEqual(findPersona(undefined).name, 'そのまま');
	assert.strictEqual(findPersona('知らない名前').name, 'そのまま');
});

test('ゆあでも技術的な正確さは崩させない', () => {
	const yua = findPersona('ゆあ');
	assert.ok(yua.instruction.includes('技術的な正確さは崩さない'));
	assert.ok(yua.instruction.includes('分かったふり'));
});

test('止まっている状態だけを目立たせる（動いているだけなら色を変えない）', () => {
	assert.strictEqual(stateColor('waiting-approval'), 'statusBarItem.warningBackground');
	assert.strictEqual(stateColor('error'), 'statusBarItem.errorBackground');
	// 作業中は異常ではないので、目立たせない
	assert.strictEqual(stateColor('thinking'), undefined);
	assert.strictEqual(stateColor('idle'), undefined);
});

test('状態は日本語 1 語で出す', () => {
	assert.deepStrictEqual(
		(['idle', 'thinking', 'waiting-approval', 'error'] as const).map(stateLabel),
		['待機中', '作業中', '承認待ち', 'エラー']
	);
});

test('私が書く番では、提案もさせない', () => {
	const human = turnModeInstruction('human');
	assert.ok(human.includes('ファイルを変更しないでください'));
	assert.ok(human.includes('聞かれるまで提案もしないでください'));
});

test('肩越しは、壊れるときだけ口を出させる（好みには口を出させない）', () => {
	const shoulder = turnModeInstruction('shoulder');
	assert.ok(shoulder.includes('ふだんは黙って'));
	assert.ok(shoulder.includes('明らかに壊れる'));
	assert.ok(shoulder.includes('好みの問題'));
});

test('エージェントの番に戻せる', () => {
	assert.ok(turnModeInstruction('agent').includes('いつもどおり'));
	assert.deepStrictEqual(Object.keys(TURN_MODE_LABEL).sort(), ['agent', 'human', 'shoulder']);
});
