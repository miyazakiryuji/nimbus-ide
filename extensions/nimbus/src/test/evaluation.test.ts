/**
 * 回帰テスト・ブレ幅・モデル比較（T-165 / T-166 / T-167）の単体テスト。
 *
 * **部分点を付けない**ことと、**通っていないものを勧めない**ことが要。
 * どちらも緩めた瞬間に「だいたい動く」が積み上がって、回帰に気づけなくなる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	cheapestPassing,
	compareModels,
	describeStability,
	judge,
	measureStability,
	type EvalCase,
	type JudgedRun,
	type RunResult
} from '../core/evaluation';

const CASE: EvalCase = { name: 'レビュー', prompt: 'x', expect: ['根拠', '行'], reject: ['勝手に変更'] };
const run = (text: string, over: Partial<RunResult> = {}): RunResult => ({
	attempt: 1,
	text,
	durationMs: 1000,
	...over
});

test('含まれていてほしい語が全部揃ったときだけ合格（部分点を付けない）', () => {
	assert.strictEqual(judge(CASE, run('根拠となる行を示します')).verdict, 'passed');
	const partial = judge(CASE, run('根拠を示します'));
	assert.strictEqual(partial.verdict, 'failed');
	assert.ok(partial.reason?.includes('行'));
});

test('入ってはいけない語があれば落とす', () => {
	const judged = judge(CASE, run('根拠となる行を示し、勝手に変更しました'));
	assert.strictEqual(judged.verdict, 'failed');
	assert.ok(judged.reason?.includes('入ってはいけない語'));
});

test('大文字小文字は無視する', () => {
	const caseInsensitive: EvalCase = { name: 'x', prompt: 'x', expect: ['PASS'] };
	assert.strictEqual(judge(caseInsensitive, run('result: pass')).verdict, 'passed');
});

const judged = (verdict: 'passed' | 'failed', text: string, over: Partial<JudgedRun> = {}): JudgedRun => ({
	attempt: 1,
	text,
	durationMs: 1000,
	verdict,
	...over
});

test('ブレ幅は合格率と、応答の長さの振れを両方見る', () => {
	const stable = measureStability([judged('passed', 'x'.repeat(100)), judged('passed', 'x'.repeat(100))]);
	assert.deepStrictEqual([stable.passRate, stable.lengthVariation], [100, 0]);
	assert.strictEqual(describeStability(stable), '2/2 合格 · 振れ 0%');
});

test('毎回通っていても、長さが大きく振れていれば言う', () => {
	const wobbly = measureStability([judged('passed', 'x'.repeat(20)), judged('passed', 'x'.repeat(200))]);
	assert.ok(wobbly.lengthVariation > 40, String(wobbly.lengthVariation));
	assert.ok(describeStability(wobbly).includes('振れています'));
});

test('同じ指示で結果が変わることを、はっきり言う', () => {
	const flaky = measureStability([judged('passed', 'a'), judged('failed', 'b')]);
	assert.strictEqual(flaky.passRate, 50);
	assert.ok(describeStability(flaky).includes('結果が変わっています'));
});

test('走らせていなければ 0% と言わない', () => {
	assert.strictEqual(describeStability(measureStability([])), 'まだ走らせていません');
});

test('空の応答ばかりでも 0 除算しない', () => {
	assert.strictEqual(measureStability([judged('failed', ''), judged('failed', '')]).lengthVariation, 0);
});

test('モデル比較は合格率が先、同じなら安い順', () => {
	const runs: JudgedRun[] = [
		judged('passed', 'ok', { model: 'haiku', costUsd: 0.001 }),
		judged('passed', 'ok', { model: 'opus', costUsd: 0.05 }),
		judged('failed', 'ng', { model: 'tiny', costUsd: 0.0001 })
	];
	assert.deepStrictEqual(compareModels(runs).map((c) => c.model), ['haiku', 'opus', 'tiny']);
});

test('「軽いモデルで足りる」は、通っているものからしか選ばない', () => {
	const runs: JudgedRun[] = [
		judged('failed', 'ng', { model: 'tiny', costUsd: 0.0001 }),
		judged('passed', 'ok', { model: 'haiku', costUsd: 0.002 })
	];
	assert.strictEqual(cheapestPassing(compareModels(runs))?.model, 'haiku');
	// 全部落ちていれば勧めない
	assert.strictEqual(cheapestPassing(compareModels([judged('failed', 'ng', { model: 'x' })])), undefined);
});
