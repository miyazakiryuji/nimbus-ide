/**
 * 承認ルールの画面編集（T-028）の単体テスト。
 *
 * この機能の値打ちは「**許可の範囲を読み違えたまま溜めさせない**」ところにある。
 * 言い換えの文言と、広いルールに飲み込まれている狭いルールの検出を重点的に押さえる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { parseRule } from '../core/approvalRules';
import { checkNewRule, explainRule, tidyRules, viewRules } from '../core/permissionRules';

test('ルールが何を許すのかを日本語で言う', () => {
	assert.deepStrictEqual(
		['Read', 'Write(*.md)', 'Bash(npm test)'].map((t) => explainRule(parseRule(t)!)),
		[
			'Read を、内容にかかわらず確認せず許可',
			'拡張子が .md のファイルへの Write を確認せず許可',
			'Bash のうち「npm test」で始まるものを確認せず許可'
		]
	);
});

test('読めないルールは無効として出す（黙って捨てない）', () => {
	const [view] = viewRules(['Bash(']);
	assert.deepStrictEqual([view.text, view.valid, view.explanation], ['Bash(', false, undefined]);
});

test('絞り込みの無いルールは、同じツールの狭いルールを飲み込む', () => {
	const views = viewRules(['Read', 'Read(*.md)', 'Write(*.ts)']);
	assert.deepStrictEqual(
		views.map((v) => [v.text, v.coveredBy]),
		[['Read', undefined], ['Read(*.md)', 'Read'], ['Write(*.ts)', undefined]]
	);
});

test('コマンドの前方一致は、短いほうが長いほうを飲み込む', () => {
	const views = viewRules(['Bash(git)', 'Bash(git status)', 'Bash(github)']);
	assert.deepStrictEqual(
		views.map((v) => [v.text, v.coveredBy]),
		// `git` は `git status` を含むが、`github` は語が違うので含まない
		[['Bash(git)', undefined], ['Bash(git status)', 'Bash(git)'], ['Bash(github)', undefined]]
	);
});

test('拡張子どうしには包含関係を認めない', () => {
	assert.deepStrictEqual(
		viewRules(['Write(*.md)', 'Write(*.ts)']).map((v) => v.coveredBy),
		[undefined, undefined]
	);
});

test('ツールが違えば飲み込まない', () => {
	assert.deepStrictEqual(viewRules(['Read', 'Write(*.md)']).map((v) => v.coveredBy), [undefined, undefined]);
});

test('足す前の点検 — 書式が読めないものは足せない', () => {
	const check = checkNewRule('Bash(', []);
	assert.strictEqual(check.valid, false);
	assert.ok(check.warnings[0].includes('書式が読めません'), check.warnings.join('/'));
});

test('足す前の点検 — 範囲が広いこと・重複・無効化を伝えるが、止めはしない', () => {
	const broad = checkNewRule('Write', []);
	assert.strictEqual(broad.valid, true);
	assert.ok(broad.warnings.some((w) => w.includes('内容にかかわらず')), broad.warnings.join('/'));

	const duplicate = checkNewRule('Read', ['Read']);
	assert.ok(duplicate.warnings.some((w) => w.includes('同じルールが既にあります')), duplicate.warnings.join('/'));

	const useless = checkNewRule('Bash(git status)', ['Bash(git)']);
	assert.ok(useless.warnings.some((w) => w.includes('効果がありません')), useless.warnings.join('/'));
});

test('取り返しがつかない操作は毎回確認する、を必ず伝える', () => {
	// ルールを足す人が「これで全部素通りになる」と誤解するのを防ぐ
	const check = checkNewRule('Bash(npm test)', []);
	assert.ok(check.warnings.some((w) => w.includes('毎回確認します')), check.warnings.join('/'));
});

test('片付けると、読めないものと飲み込まれたものが落ちる', () => {
	assert.deepStrictEqual(
		tidyRules(['Read', 'Read(*.md)', 'Bash(', 'Bash(npm test)']),
		['Read', 'Bash(npm test)']
	);
});
