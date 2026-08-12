/**
 * 解説モード（T-045）の単体テスト。
 *
 * **理由を作らない**（書かれていなければ空欄）を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildExplanation, reasonSentence, renderExplanation, shortPath } from '../core/explain';
import type { TranscriptEntry } from '../core/transcripts';

const entry = (role: 'user' | 'assistant', text: string, files: string[] = [], tools: string[] = []): TranscriptEntry => ({
	role,
	text,
	timestamp: '2026-08-13T10:00:00.000Z',
	files,
	tools
});

test('理由らしい文を 1 つ取り出す', () => {
	assert.strictEqual(
		reasonSentence('まず承認の流れを読みます。そのあと直します。'),
		'まず承認の流れを読みます。'
	);
});

test('理由が書かれていなければ、作らない', () => {
	assert.strictEqual(reasonSentence('直しました。'), undefined);
});

test('パスは末尾 2 つに縮める', () => {
	assert.deepStrictEqual([shortPath('/a/b/c/d.ts'), shortPath('a.ts')], ['c/d.ts', 'a.ts']);
});

test('指示・理由・触ったファイルの順に並べ直す', () => {
	const steps = buildExplanation([
		entry('user', '承認まわりを直して'),
		entry('assistant', 'まず承認の流れを読みます。', ['/repo/src/permissions.ts'], ['Read'])
	]);
	assert.deepStrictEqual(steps.map((s) => s.kind), ['instruction', 'reason', 'touch']);
});

test('同じファイルを続けて触ったものは 1 つにまとめる', () => {
	const steps = buildExplanation([
		entry('assistant', '', ['/repo/a.ts'], ['Read']),
		entry('assistant', '', ['/repo/a.ts'], ['Edit'])
	]);
	assert.deepStrictEqual(
		steps.map((s) => `${s.kind}:${s.text}:${s.tools?.join(',')}`),
		['touch:repo/a.ts:Read,Edit']
	);
});

test('ファイルを触っていないターンは並べない', () => {
	assert.deepStrictEqual(buildExplanation([entry('assistant', 'できました。')]), []);
});

test('推測では補わないと明記する', () => {
	const text = renderExplanation(buildExplanation([entry('user', 'やって')]));
	assert.ok(text.includes('推測では補いません'));
});

test('記録が無ければ、その旨だけを書く', () => {
	assert.ok(renderExplanation([]).includes('並べ直せる記録がありません'));
});
