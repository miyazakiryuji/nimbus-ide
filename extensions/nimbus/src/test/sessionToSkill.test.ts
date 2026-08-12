/**
 * セッション → スキル化（T-168）・預かり箱（T-151）・ピン留めとタグ（T-147）の単体テスト。
 *
 * スキル化は「**確かめていないことを確かめたと書かない**」のが要。
 * テストを走らせていないセッションから「確かめかた」を捏造すると、型として害になる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import type { NimbusEvent } from '../events';
import { draftSkill, renderSkillFile, toSkillName } from '../core/sessionToSkill';
import { describeOutbox, isTransientFailure, MAX_QUEUED, Outbox } from '../core/outbox';
import { collectTags, filterByTags, sortForBoard, type KanbanTask } from '../core/tasks';

type EventBody<T> = T extends NimbusEvent ? Omit<T, 'sessionId' | 'timestamp'> : never;
const at = (timestamp: number, event: EventBody<NimbusEvent>): NimbusEvent =>
	({ ...event, sessionId: 's1', timestamp }) as NimbusEvent;

const SESSION: NimbusEvent[] = [
	at(1, { kind: 'user-text', text: 'バリデーションを直して' }),
	at(2, { kind: 'tool-use', toolUseId: 'u1', toolName: 'Edit', input: { file_path: '/w/login.ts' } }),
	at(3, { kind: 'user-text', text: 'テストも足して' }),
	at(4, { kind: 'tool-use', toolUseId: 'u2', toolName: 'Write', input: { file_path: '/w/login.test.ts' } }),
	at(5, { kind: 'tool-use', toolUseId: 'u3', toolName: 'Bash', input: { command: 'npm test' } }),
	at(6, { kind: 'tool-result', toolUseId: 'u3', isError: false, preview: '# fail 0' })
];

test('スキル名はディレクトリに使える形に寄せる', () => {
	assert.strictEqual(toSkillName('ログイン画面の バリデーション!!'), 'ログイン画面の-バリデーション');
	assert.strictEqual(toSkillName('Fix Login  Validation'), 'fix-login-validation');
	assert.strictEqual(toSkillName('!!!'), 'nimbus-skill');
});

test('手順は指示を出した順に並び、触ったファイルは参考として添える', () => {
	const draft = draftSkill(SESSION, 'ログイン修正', 'ログイン画面を直すとき');
	const steps = draft.body.slice(draft.body.indexOf('## 手順'));
	assert.ok(steps.indexOf('バリデーションを直して') < steps.indexOf('テストも足して'), '順が逆');
	assert.ok(steps.includes('このとき触ったもの（参考）'), '触ったファイルが無い');
	assert.ok(steps.includes('/w/login.ts'));
});

test('走らせたテストを「確かめかた」に載せる', () => {
	const draft = draftSkill(SESSION, 'x', 'y');
	assert.ok(draft.body.includes('`npm test`'));
	assert.ok(draft.body.includes('成功'));
});

test('テストを走らせていなければ、確かめたことにしない', () => {
	const draft = draftSkill([at(1, { kind: 'user-text', text: '直して' })], 'x', 'y');
	assert.ok(draft.body.includes('テストを実行していません'), draft.body);
});

test('SKILL.md は frontmatter つきで、description は 1 行に畳む', () => {
	const file = renderSkillFile({ name: 'a', description: '複数\n行の\n説明', body: '本文' });
	assert.ok(file.startsWith('---\nname: a\ndescription: 複数 行の 説明\n---\n'));
	assert.ok(file.endsWith('本文'));
});

// --- 預かり箱（T-151） ---

test('繋がらない類の失敗だけを預かる', () => {
	for (const message of ['getaddrinfo ENOTFOUND api', 'socket hang up', 'fetch failed', 'network error', 'ETIMEDOUT']) {
		assert.ok(isTransientFailure(message), message);
	}
	for (const message of ['Session x is not accepting input', 'Invalid API key', 'permission denied']) {
		assert.ok(!isTransientFailure(message), message);
	}
});

test('預かるのは上限まで。古いものから落とす（新しい指示のほうが今に合う）', () => {
	const outbox = new Outbox();
	for (let i = 0; i < MAX_QUEUED + 5; i++) {
		outbox.add(`文 ${i}`, '理由', i);
	}
	assert.strictEqual(outbox.size, MAX_QUEUED);
	assert.strictEqual(outbox.list()[0].text, '文 5');
});

test('空文字は預からない。取り出すと空になる', () => {
	const outbox = new Outbox();
	outbox.add('   ', '理由', 1);
	assert.strictEqual(outbox.size, 0);
	outbox.add('本文', '理由', 1);
	assert.deepStrictEqual(outbox.drain().map((item) => item.text), ['本文']);
	assert.strictEqual(outbox.size, 0);
	assert.strictEqual(describeOutbox(outbox), '');
});

// --- ピン留めとタグ（T-147） ---

const task = (taskId: string, createdAt: number, over: Partial<KanbanTask> = {}): KanbanTask => ({
	taskId,
	title: taskId,
	repoCwd: '/w',
	worktreePath: `/w/${taskId}`,
	branch: taskId,
	prompt: '',
	state: 'pending',
	createdAt,
	updatedAt: createdAt,
	...over
});

test('板の並びはピン留めが先、次に作った順', () => {
	const list = [task('a', 1), task('b', 2, { pinned: true }), task('c', 3)];
	assert.deepStrictEqual(sortForBoard(list).map((t) => t.taskId), ['b', 'a', 'c']);
});

test('タグは全部含むものだけを通す。指定が空なら全部', () => {
	const list = [task('a', 1, { tags: ['UI', '調査'] }), task('b', 2, { tags: ['UI'] }), task('c', 3)];
	assert.deepStrictEqual(filterByTags(list, ['UI']).map((t) => t.taskId), ['a', 'b']);
	assert.deepStrictEqual(filterByTags(list, ['UI', '調査']).map((t) => t.taskId), ['a']);
	assert.strictEqual(filterByTags(list, []).length, 3);
});

test('使われているタグを多い順に集める', () => {
	const list = [task('a', 1, { tags: ['UI', '調査'] }), task('b', 2, { tags: ['UI'] })];
	assert.deepStrictEqual(collectTags(list), [{ tag: 'UI', count: 2 }, { tag: '調査', count: 1 }]);
});
