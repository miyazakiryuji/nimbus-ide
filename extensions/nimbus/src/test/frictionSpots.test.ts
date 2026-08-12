/**
 * 詰まりやすい場所（T-066）の単体テスト。
 *
 * **たまたま 1 回失敗した場所を上位に出さない**ことを押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { findFrictionSpots, renderFrictionSpots, subjectsIn } from '../core/frictionSpots';
import type { PromptSample } from '../core/promptStats';

const sample = (text: string, redone: boolean): PromptSample => ({
	text,
	at: 0,
	redone,
	specific: true,
	length: text.length
});

test('指示の中のファイル名を拾う（パスは末尾だけ）', () => {
	assert.deepStrictEqual(subjectsIn('src/core/a.ts と b.dart を直して。a.ts はとくに'), ['a.ts', 'b.dart']);
});

test('言い直しが集まっている場所を、件数の多い順に返す', () => {
	const samples = [
		sample('a.ts を直して', true),
		sample('a.ts をもう一度', true),
		sample('a.ts の続き', false),
		sample('b.ts を直して', true),
		sample('b.ts をもう一度', false),
		sample('b.ts の続き', false)
	];
	assert.deepStrictEqual(
		findFrictionSpots(samples).map((s) => `${s.subject}:${s.redone}/${s.total}`),
		['a.ts:2/3', 'b.ts:1/3']
	);
});

test('数が少ない場所は出さない（たまたまを法則にしない）', () => {
	assert.deepStrictEqual(findFrictionSpots([sample('rare.ts を直して', true)]), []);
});

test('言い直しがゼロの場所は出さない', () => {
	const samples = [sample('ok.ts を', false), sample('ok.ts を', false), sample('ok.ts を', false)];
	assert.deepStrictEqual(findFrictionSpots(samples), []);
});

test('何も無ければ、そう書く', () => {
	assert.ok(renderFrictionSpots([]).includes('集まってはいません'));
});

test('理由は分からないと明記し、次に試すことを書く', () => {
	const text = renderFrictionSpots([{ subject: 'a.ts', redone: 2, total: 3 }]);
	assert.deepStrictEqual(
		['理由までは分かりません', '前提を先に書く', '`a.ts` — 3 回のうち 2 回'].map((s) => text.includes(s)),
		[true, true, true]
	);
});
