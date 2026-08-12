/**
 * ワークフロー（T-149）と解説モード（T-045）の単体テスト。
 *
 * **自動で次へ進めない**ことが要。段の切れ目で人が確認できることが、この機能の値打ち。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	advance,
	BUILTIN_WORKFLOWS,
	describeProgress,
	EXPLAIN_MODE_PROMPT,
	fillStep,
	isFinished,
	nextStep,
	type WorkflowState
} from '../core/workflow';

const flow = BUILTIN_WORKFLOWS[0];
const start = (): WorkflowState => ({ workflowName: flow.name, stepIndex: 0, input: 'ログインを直す' });

test('出荷時の流れが 2 本あり、段ごとに名前が付いている', () => {
	assert.strictEqual(BUILTIN_WORKFLOWS.length, 2);
	assert.deepStrictEqual(flow.steps.map((step) => step.name), ['調査', '実装', 'テスト', 'レビュー']);
	assert.deepStrictEqual(BUILTIN_WORKFLOWS[1].steps.map((step) => step.name), ['再現', '原因', '修正', '回帰']);
});

test('最初の段は「調べるだけ」で、変更させない', () => {
	const prompt = fillStep(flow.steps[0], 'ログインを直す');
	assert.ok(prompt.includes('ログインを直す'));
	assert.ok(prompt.includes('調べるだけ'));
	assert.ok(prompt.includes('変更しないでください'));
	// 次へ進んでよいかを言わせる（言わせないと勝手に実装まで進む）
	assert.ok(prompt.includes('実装に進んでよいか'));
});

test('変数を持たない段は、入力を差し込まない', () => {
	const prompt = fillStep(flow.steps[1], 'ログインを直す');
	assert.ok(!prompt.includes('ログインを直す'));
});

test('テストの段は「通ったログ」を求め、通っていなければ言わせる', () => {
	const prompt = fillStep(flow.steps[2], '');
	assert.ok(prompt.includes('通ったログ'));
	assert.ok(prompt.includes('通っていない'));
});

test('段を進めると位置が動き、最後で終わる', () => {
	let state = start();
	assert.strictEqual(describeProgress(flow, state), `${flow.name} — 1/4 調査`);
	for (let i = 0; i < 4; i++) {
		assert.ok(nextStep(flow, state) !== undefined, `${i} 段目が無い`);
		state = advance(state);
	}
	assert.ok(isFinished(flow, state));
	assert.strictEqual(nextStep(flow, state), undefined);
	assert.ok(describeProgress(flow, state).includes('全 4 段が終わりました'));
});

test('最後の段だけは確認を挟まない（そこで終わりなので）', () => {
	assert.deepStrictEqual(flow.steps.map((step) => step.confirm), [true, true, true, false]);
});

test('解説モードは「なぜ」を求め、長い説明は求めない', () => {
	assert.ok(EXPLAIN_MODE_PROMPT.includes('なぜそれを読むのか'));
	assert.ok(EXPLAIN_MODE_PROMPT.includes('選ばなかった理由'));
	assert.ok(EXPLAIN_MODE_PROMPT.includes('長い説明は要りません'));
});
