/**
 * 板の状態を見る道具（`nimbus/scripts/board.mjs`）の読み取り。
 *
 * **T-283 の守り。** 実際に起きたのは「進行中に 1 件あるのに、道具は 0 件と言う」。
 * 板は複数の AI の唯一の調整面なので、**見えない = 無い**と同じで、
 * そのまま二重着手につながる。読み落としの形をここで固定する。
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { collect } from '../../scripts/board.mjs';

/** 進行中の 1 タスクぶんを取り出す */
function inProgress(text) {
	return collect(text).sections.get('進行中') ?? [];
}

test('ID の直後に注釈が続いても、進行中として数える（T-283）', () => {
	const board = [
		'## 進行中',
		'',
		'- [ ] T-282（旧 T-276 / T-281・ID が重複したので採番し直し）**枠の残りを出す** — @session-d 2026-08-19',
		''
	].join('\n');

	assert.deepEqual(inProgress(board), [
		{ id: 'T-282', done: false, claims: ['session-d'], title: '**枠の残りを出す**' }
	]);
});

test('札は続きの行に書かれていても拾う（T-283）', () => {
	const board = [
		'## 進行中',
		'',
		'- [ ] T-283 **板の状態を見る道具を直す**',
		'      読み落としがあると、板に書いたのに他のセッションから見えない',
		'      @session-e 2026-08-20 [P1]',
		''
	].join('\n');

	assert.deepEqual(inProgress(board), [
		{ id: 'T-283', done: false, claims: ['session-e'], title: '**板の状態を見る道具を直す**' }
	]);
});

test('空行で区切られた次のタスクへ、前のタスクの札が混ざらない（T-283）', () => {
	const board = [
		'## 進行中',
		'',
		'- [ ] T-001 さきに始めたもの',
		'      @session-a 2026-08-13',
		'',
		'- [ ] T-002 あとから始めたもの',
		''
	].join('\n');

	assert.deepEqual(inProgress(board), [
		{ id: 'T-001', done: false, claims: ['session-a'], title: 'さきに始めたもの' },
		{ id: 'T-002', done: false, claims: [], title: 'あとから始めたもの' }
	]);
});

test('ID から始まらないタスク行は、黙って捨てずに報告する（T-283）', () => {
	const board = ['## 進行中', '', '- [ ] 番号を振り忘れた思いつき', ''].join('\n');

	const { sections, unreadable } = collect(board);
	assert.equal(sections.get('進行中'), undefined);
	assert.deepEqual(unreadable, [{ section: '進行中', line: '- [ ] 番号を振り忘れた思いつき' }]);
});

test('最初の節目（F0〜F6）も ID として読む（T-283）', () => {
	const board = ['## 完了', '', '- [x] F1 フォークが Nimbus として起動する — 2026-08-12', ''].join('\n');

	assert.deepEqual(collect(board).sections.get('完了'), [
		{ id: 'F1', done: true, claims: [], title: 'フォークが Nimbus として起動する' }
	]);
});
