/**
 * 曖昧さの検知・設定の世代・週のふりかえり（T-090 / T-095 / T-097）の単体テスト。
 *
 * 曖昧さの検知は**誤検知を出さない**ことが要。毎回出ると読み飛ばされ、
 * 本当に曖昧なときにも効かなくなる。
 *
 *   node --test extensions/nimbus/out/test
 *
 * 守っている修正（T-274）: T-018 / T-027
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { clarificationMessage, findVagueness } from '../core/ambiguity';
import { addSnapshot, describeSnapshot, historyFor, MAX_PER_FILE, trackedFiles, type Snapshot } from '../core/settingsHistory';
import { buildWeeklyReview, describeWeeklyReview } from '../core/weeklyReview';
import type { NimbusEvent } from '../events';

test('対象が書いてあれば、指示語があっても拾わない', () => {
	assert.deepStrictEqual(findVagueness('`src/a.ts` のこれを直して'), []);
	assert.deepStrictEqual(findVagueness('login.dart のそれを消して'), []);
	assert.deepStrictEqual(findVagueness('「ログイン画面」のこれを直して'), []);
});

test('対象が無い指示語は拾う', () => {
	const found = findVagueness('それを直しておいて');
	assert.strictEqual(found.length, 1);
	assert.deepStrictEqual([found[0].kind, found[0].matched], ['demonstrative', 'それ']);
});

test('基準の無い言い方を拾う', () => {
	const found = findVagueness('`a.ts` をいい感じにして');
	assert.deepStrictEqual(found.map((f) => f.kind), ['vague-quality']);
	assert.ok(found[0].question.includes('良しとしますか'));
});

test('対象も動詞も無い一言を拾う', () => {
	assert.deepStrictEqual(findVagueness('直して').map((f) => f.kind), ['no-target']);
	assert.deepStrictEqual(findVagueness('お願い').map((f) => f.kind), ['no-target']);
});

test('範囲が決まっていない言い方を拾う', () => {
	assert.deepStrictEqual(findVagueness('`src/` を全部きれいにして').map((f) => f.kind), ['vague-quality', 'ambiguous-scope']);
});

test('短い返事や、はっきりした指示は拾わない（誤検知を出さない）', () => {
	for (const text of ['はい', 'ありがとう', '`src/a.ts` の 42 行目のヌル安全を直して', 'テストを走らせて結果を見せて']) {
		assert.deepStrictEqual(findVagueness(text), [], text);
	}
});

test('聞き返す文は、候補を決めつけず何が決まっていないかを言う', () => {
	const message = clarificationMessage(findVagueness('それをいい感じにして'));
	assert.ok(message.includes('どのファイル'));
	assert.ok(message.includes('良しとしますか'));
});

// --- 設定の世代（T-095） ---

const snap = (path: string, content: string, at: string, reason = '保存'): Snapshot => ({ path, content, at, reason });

test('中身が同じなら世代を足さない', () => {
	const once = addSnapshot([], snap('skills/a/SKILL.md', 'x', '2026-08-13T10:00:00Z'));
	assert.strictEqual(addSnapshot(once, snap('skills/a/SKILL.md', 'x', '2026-08-13T11:00:00Z')).length, 1);
});

test('世代は上限まで。古いものから落とす', () => {
	let history: Snapshot[] = [];
	for (let i = 0; i < MAX_PER_FILE + 3; i++) {
		history = addSnapshot(history, snap('a.md', `v${i}`, `2026-08-13T${String(i).padStart(2, '0')}:00:00Z`));
	}
	assert.strictEqual(history.length, MAX_PER_FILE);
	assert.strictEqual(history[0].content, 'v3');
});

test('ファイルごとに分けて数える', () => {
	let history: Snapshot[] = [];
	history = addSnapshot(history, snap('a.md', '1', '2026-08-13T10:00:00Z'));
	history = addSnapshot(history, snap('b.md', '1', '2026-08-13T11:00:00Z'));
	history = addSnapshot(history, snap('a.md', '2', '2026-08-13T12:00:00Z'));
	assert.deepStrictEqual(historyFor(history, 'a.md').map((s) => s.content), ['2', '1']);
	assert.deepStrictEqual(trackedFiles(history).map((f) => [f.path, f.count]), [['a.md', 2], ['b.md', 1]]);
});

test('世代の説明には、何行変わったかを出す', () => {
	const before = snap('a.md', '1\n2\n3', '2026-08-13T10:00:00Z');
	const after = snap('a.md', '1\n2', '2026-08-13T11:00:00Z', '編集');
	assert.ok(describeSnapshot(after, before).includes('-1 行'));
	assert.ok(describeSnapshot(before, undefined).includes('最初の控え'));
});

// --- 週のふりかえり（T-097） ---

type EventBody<T> = T extends NimbusEvent ? Omit<T, 'sessionId' | 'timestamp'> : never;
const at = (t: number, e: EventBody<NimbusEvent>): NimbusEvent => ({ ...e, sessionId: 's', timestamp: t }) as NimbusEvent;

test('材料が無ければ、無いと言う（盛らない）', () => {
	assert.strictEqual(describeWeeklyReview(buildWeeklyReview([])), 'まだ材料がありません');
});

test('実際に起きたことだけを数える', () => {
	const review = buildWeeklyReview([
		[
			at(1, { kind: 'subagent', phase: 'started', taskId: 't1', description: '調査', subagentType: 'Explore' }),
			at(2, { kind: 'tool-use', toolUseId: 'u1', toolName: 'Edit', input: { file_path: '/w/a.ts' } }),
			at(3, { kind: 'tool-use', toolUseId: 'u2', toolName: 'Bash', input: { command: 'npm test' } }),
			at(4, { kind: 'tool-result', toolUseId: 'u2', isError: false, preview: '# fail 0' })
		]
	]);
	assert.deepStrictEqual(
		[review.sessions, review.filesTouched, review.testsPassed, review.topAgent?.name, review.topFile?.path],
		[1, 1, 1, 'Explore', '/w/a.ts']
	);
	const text = describeWeeklyReview(review);
	assert.ok(text.includes('Explore'));
	assert.ok(text.includes('テストが 1 回通りました'));
});

test('無かったものは書かない', () => {
	const review = buildWeeklyReview([[at(1, { kind: 'user-text', text: '何もしていない' })]]);
	const text = describeWeeklyReview(review);
	assert.ok(!text.includes('テスト'), text);
	assert.ok(!text.includes('いちばん'), text);
});
