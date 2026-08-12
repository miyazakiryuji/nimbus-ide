/**
 * 着手前の確認（T-185）。
 *
 * ここは**うるさすぎると無視される**ので、通すべきものを通すことのほうが大事。
 * 「引っかかるべきもの」と同じ数だけ「通すべきもの」を固定する。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { assessClarity, formatClarification } from '../core/clarify';

const vague = (text: string, hasHistory = false): boolean => assessClarity(text, hasHistory).level === 'vague';

test('ファイル名があれば通す（言い回しが雑でも対象が分かる）', () => {
	assert.strictEqual(vague('src/core/tasks.ts をいい感じに整理して'), false);
	assert.strictEqual(vague('package.json のバージョンを上げて'), false);
});

test('コード引用・関数名・タスク ID も具体性として数える', () => {
	assert.strictEqual(vague('`createNonce` の戻り値を長くして'), false);
	assert.strictEqual(vague('T-185 の続きをやって'), false);
	assert.strictEqual(vague('parseSkillFrontmatter() が空を返すのを直して'), false);
});

test('対象が無いまま「全部直して」は止める', () => {
	const result = assessClarity('全部まとめて修正して');
	assert.strictEqual(result.level, 'vague');
	assert.ok(result.issues.some((i) => i.reason.includes('範囲')), JSON.stringify(result.issues));
});

test('「いい感じに」だけは止める', () => {
	assert.strictEqual(vague('いい感じにしておいて'), true);
});

test('バグ報告は再現手順を聞く', () => {
	const result = assessClarity('バグがあるので直して');
	assert.strictEqual(result.level, 'vague');
	assert.ok(result.issues.some((i) => i.question.includes('再現手順')));
});

test('バグ報告は対象が分かっていても再現手順を聞く（対象では解決しない）', () => {
	const result = assessClarity('src/core/tasks.ts でエラーが出るので直して');
	assert.strictEqual(result.level, 'vague');
	assert.ok(result.issues.some((i) => i.question.includes('再現手順')));
	assert.ok(!result.issues.some((i) => i.reason.includes('どのファイル')), '対象は分かっているので聞かない');
});

test('短すぎる指示は止める', () => {
	assert.strictEqual(vague('直して'), true);
	assert.strictEqual(vague('やって'), true);
});

test('質問・相談は止めない（実行させる指示ではない）', () => {
	assert.strictEqual(vague('この設計どう思う？'), false);
	assert.strictEqual(vague('これで合っていますか'), false);
	assert.strictEqual(vague('使い方を教えて'), false);
});

test('会話の続きは止めない（前のやり取りに文脈がある）', () => {
	assert.strictEqual(vague('続けて', true), false);
	assert.strictEqual(vague('お願い'), false, '返事として自然な短文は通す');
});

test('十分に具体的な指示は当然通す', () => {
	assert.strictEqual(
		vague('extensions/nimbus/src/core/skills.ts の searchSkills が空文字で全件返すのを、0 件返すように変えて'),
		false
	);
});

test('空文字は何もしない', () => {
	assert.strictEqual(assessClarity('').level, 'ok');
	assert.strictEqual(assessClarity('   ').level, 'ok');
});

test('確認文は「理由 → 何を書けばよいか」の形で並ぶ', () => {
	const text = formatClarification(assessClarity('全部きれいにして'));
	assert.ok(text.includes('→'), text);
	assert.ok(text.split('\n').length >= 2, text);
});
