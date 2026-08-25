/**
 * 板の状態を見る道具（`nimbus/scripts/board.mjs`・T-264 で作った道具）の読み取り。
 *
 * **T-283 の守り。** 実際に起きたのは「進行中に 1 件あるのに、道具は 0 件と言う」。
 * 板は複数の AI の唯一の調整面なので、**見えない = 無い**と同じで、
 * そのまま二重着手につながる。読み落としの形をここで固定する。
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { assess, collect } from '../../scripts/board.mjs';

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

test('作業予約（🔒 行）は locks として読み、タスクには数えない（T-321）', () => {
	const board = [
		'## 作業予約（いま触っているファイル）',
		'',
		'書式: `- 🔒 @session-x | T-123 | 2026-08-25 20:00 | 触るファイル（カンマ区切り）`',
		'',
		'- 🔒 @session-g | T-321 | 2026-08-25 20:32 | CLAUDE.md, nimbus/scripts/board.mjs',
		'',
		'## 進行中',
		'',
		'- [ ] T-321 **予約の運用を入れる** — @session-g 2026-08-25',
		''
	].join('\n');

	const { sections, unreadable, locks } = collect(board);
	// 予約は locks へ、タスクは今までどおり sections へ。書式の説明行と 🔒 行が
	// 「読めなかったタスク」として報告されないこと（板が汚れて見えると誰も信用しなくなる）
	assert.deepEqual(
		{ locks, unreadable, inProgress: sections.get('進行中') },
		{
			locks: [{ session: 'session-g', id: 'T-321', since: '2026-08-25 20:32', files: ['CLAUDE.md', 'nimbus/scripts/board.mjs'] }],
			unreadable: [],
			inProgress: [{ id: 'T-321', done: false, claims: ['session-g'], title: '**予約の運用を入れる**' }]
		}
	);
});

test('落ちた予約を、心拍とファイルの静けさで見分ける（T-328）', () => {
	const now = Date.parse('2026-08-26T12:00');
	const lock = { session: 'session-g', id: 'T-328', since: '2026-08-26 11:30', files: ['a.ts'] };
	const at = (text) => Date.parse(text);

	// 心拍かファイルのどちらかが動いていれば「生きている」。両方止まって初めて「落ちた」。
	// ファイルの時刻が取れないとき（全部これから作る新規）は心拍だけで判定する
	assert.deepEqual(
		{
			fresh: assess(lock, now, [at('2026-08-26T11:55')]).stalled,
			oldBeatButFilesMoving: assess({ ...lock, since: '2026-08-26 09:00' }, now, [at('2026-08-26T11:50')]).stalled,
			stalled: assess({ ...lock, since: '2026-08-26 09:00' }, now, [at('2026-08-26T09:05')]),
			noFiles: assess({ ...lock, since: '2026-08-26 09:00' }, now, []).stalled,
			brokenTime: assess({ ...lock, since: 'いつか' }, now, []).stalled
		},
		{
			fresh: false,
			oldBeatButFilesMoving: false,
			stalled: { heartbeatMinutes: 180, quietMinutes: 175, stalled: true },
			noFiles: true,
			brokenTime: false
		}
	);
});
