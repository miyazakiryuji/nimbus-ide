/**
 * タブ（セッションの束）と Home（T-314）の単体テスト。
 *
 * ここが間違えると、**セッションが Home から消える**（所属が壊れて出てこない）か、
 * タブを消したときにセッションごと見えなくなる。行き場を失わないことを特に押さえる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	DEFAULT_GROUP_ID,
	addGroup,
	listByGroup,
	assignSession,
	buildHome,
	emptyGroups,
	groupOf,
	normalizeGroups,
	normalizeGroupName,
	liveMembership,
	pruneMembers,
	removeGroup,
	renameGroup
} from '../core/sessionGroups';

test('タブを足して、入れて、Home に束で出る', () => {
	let file = emptyGroups();
	file = addGroup(file, 'g1', 'ログイン改修', 100);
	file = assignSession(file, 's1', 'g1');

	const home = buildHome(file, [{ sessionId: 's1' }, { sessionId: 's2' }]);

	assert.deepStrictEqual(
		home.map((group) => [group.id, group.name, group.isDefault, group.sessions.map((s) => s.sessionId)]),
		[
			['default', '作業', true, ['s2']],
			['g1', 'ログイン改修', false, ['s1']]
		]
	);
});

test('どの束にも入っていないセッションは、既定タブに入る（行き場を失わない）', () => {
	const home = buildHome(emptyGroups(), [{ sessionId: 's1' }]);

	assert.deepStrictEqual(home.map((g) => [g.id, g.sessions.length]), [[DEFAULT_GROUP_ID, 1]]);
});

test('空のタブも Home に出る（作った直後に見えないと、作れたのか分からない）', () => {
	const file = addGroup(emptyGroups(), 'g1', '新しい束', 100);

	const home = buildHome(file, []);

	assert.deepStrictEqual(home.map((g) => [g.id, g.sessions.length]), [['default', 0], ['g1', 0]]);
});

test('タブを消しても、中のセッションは既定タブへ戻る（消えない）', () => {
	let file = addGroup(emptyGroups(), 'g1', '束', 100);
	file = assignSession(file, 's1', 'g1');
	file = removeGroup(file, 'g1');

	assert.strictEqual(groupOf(file, 's1'), DEFAULT_GROUP_ID);
	const home = buildHome(file, [{ sessionId: 's1' }]);
	assert.deepStrictEqual(home.map((g) => [g.id, g.sessions.length]), [['default', 1]]);
});

test('既定タブは消せない・改名できない', () => {
	const file = addGroup(emptyGroups(), 'g1', '束', 100);

	assert.strictEqual(removeGroup(file, DEFAULT_GROUP_ID), file);
	assert.strictEqual(renameGroup(file, DEFAULT_GROUP_ID, '別名'), file);
});

test('改名は空白を畳み、空と長すぎは断る（黙って切らない）', () => {
	assert.strictEqual(normalizeGroupName('  ログイン  改修  '), 'ログイン 改修');
	assert.strictEqual(normalizeGroupName('   '), undefined);
	assert.strictEqual(normalizeGroupName('あ'.repeat(31)), undefined);

	let file = addGroup(emptyGroups(), 'g1', '束', 100);
	file = renameGroup(file, 'g1', '  直す  ');
	assert.strictEqual(file.groups[0].name, '直す');
});

test('既定タブへ戻すと、所属の記録ごと消える（余計な記録を残さない）', () => {
	let file = addGroup(emptyGroups(), 'g1', '束', 100);
	file = assignSession(file, 's1', 'g1');
	file = assignSession(file, 's1', DEFAULT_GROUP_ID);

	assert.deepStrictEqual(file.members, {});
});

test('定義の消えたタブに所属していても、既定タブとして扱う（groups.json が半端でも開く）', () => {
	const file = normalizeGroups({ groups: [], members: { s1: 'gone' } });

	assert.strictEqual(groupOf(file, 's1'), DEFAULT_GROUP_ID);
});

test('壊れた groups.json は、形として通る分だけ拾う', () => {
	const file = normalizeGroups({
		groups: [
			{ id: 'g1', name: '束', createdAt: 1, order: 0 },
			{ id: 'default', name: '乗っ取り' },
			{ id: '', name: 'x' },
			'ごみ',
			{ id: 'g2' }
		],
		members: { s1: 'g1', s2: 42 }
	});

	assert.deepStrictEqual(file.groups.map((g) => g.id), ['g1']);
	assert.deepStrictEqual(file.members, { s1: 'g1' });
});

test('消えたセッションの所属は掃除される', () => {
	let file = addGroup(emptyGroups(), 'g1', '束', 100);
	file = assignSession(file, 's1', 'g1');
	file = assignSession(file, 's2', 'g1');

	const pruned = pruneMembers(file, new Set(['s2']));

	assert.deepStrictEqual(pruned.members, { s2: 'g1' });
	// 変わらないときは同じものを返す（無駄な書き出しを起こさない）
	assert.strictEqual(pruneMembers(pruned, new Set(['s2'])), pruned);
});

/**
 * T-370 — **開き直すたびに束が空になっていた。**
 *
 * `pruneMembers` は渡された集合の外を消して**ディスクへ書き戻す**。呼び出し側が
 * 「いまこの窓で動いているセッション」だけを渡していたので、`activate()` の時点
 * （動いているものは必ず 0 件）で本物のセッションの所属がまるごと消えていた。
 * 生死の正本は台帳であることを、ここで固定する。
 */
test('台帳にだけ在るセッションは、束から刈られない（T-370）', () => {
	let file = addGroup(emptyGroups(), 'g1', '束', 100);
	file = assignSession(file, 'ledger-only', 'g1');
	file = assignSession(file, 'draft-1', 'g1');
	file = assignSession(file, 'gone', 'g1');

	const alive = liveMembership({
		// 開き直した直後 — 動いているセッションは 1 つも無い
		ledger: ['ledger-only'],
		running: [],
		drafts: ['draft-1']
	});

	assert.deepStrictEqual(pruneMembers(file, alive).members, {
		'ledger-only': 'g1',
		'draft-1': 'g1'
	});
});

/**
 * T-372 — **復元候補のピン・名前・番号が、起動のたびに消されていた。**
 *
 * `updateSessionTabs()` の掃除も「生きている」を `sessions.list()` だけで作っていた。
 * 復元候補は台帳に居るだけで `SessionManager` にはまだ無いので、`restoreResumables()` が
 * 呼ぶ掃除でピン・名前・番号が消え、そのあと番号が振り直される。
 * 仕様書 `session-registry.md` の「同じ番号・同じ名前で出る」と正面から矛盾していた。
 *
 * ここで固定するのは `liveMembership()` の契約 —
 * **開き直した直後（走っているものが 0 件）でも、台帳に在るものは生きている。**
 */
test('開き直した直後でも、台帳に在るセッションは「生きている」に数える（T-372）', () => {
	assert.deepStrictEqual(
		[
			...liveMembership({
				// 復元候補（台帳から拾ったもの）。この窓ではまだ 1 つも動いていない
				ledger: ['resumable-1', 'resumable-2'],
				running: [],
				drafts: ['draft-1']
			})
		].sort(),
		['draft-1', 'resumable-1', 'resumable-2']
	);
	// 走っているものだけで数えると空になる ＝ ピン・名前・番号が全部刈られていた
	assert.strictEqual(liveMembership({ ledger: [], running: [], drafts: [] }).size, 0);
});

test('横断の一覧は束で畳み、止まっているもの（許可待ち）が先頭（T-316）', () => {
	let file = emptyGroups();
	file = addGroup(file, 'g-login', 'ログイン改修', 1);
	file = assignSession(file, 'b', 'g-login');
	file = assignSession(file, 'c', 'g-login');
	const records = [
		{ sessionId: 'a', updatedAt: 30 },
		{ sessionId: 'b', updatedAt: 20 },
		{ sessionId: 'c', updatedAt: 10 }
	];
	assert.deepStrictEqual(
		listByGroup(records, file, new Set(['c'])).map((group) => ({
			name: group.name,
			stuck: group.stuck,
			members: group.members.map((record) => record.sessionId)
		})),
		[
			// 既定タブが先。所属の無い a はここに入る（行き場を失わない）
			{ name: '作業', stuck: 0, members: ['a'] },
			// 束の中は許可待ちの c が、より新しい b より先
			{ name: 'ログイン改修', stuck: 1, members: ['c', 'b'] }
		]
	);
	// 中身の無い束は出さない
	assert.deepStrictEqual(
		listByGroup([{ sessionId: 'a', updatedAt: 1 }], addGroup(emptyGroups(), 'g-x', '空', 1), new Set()).map(
			(group) => group.name
		),
		['作業']
	);
});
