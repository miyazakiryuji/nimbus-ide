/**
 * セッション横断の「誰が何を触っているか」（T-011 / T-012）の単体テスト。
 *
 * 複数エージェントで同じプロジェクトを触るのが Nimbus の狙いなので、
 * **自分自身を衝突相手として数えない**ことと、**読みと書きを区別する**ことが要。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import type { NimbusEvent } from '../events';
import { describeSessionConflict, SessionFilesTracker } from '../core/sessionFiles';

const use = (sessionId: string, timestamp: number, toolName: string, file_path: string): NimbusEvent => ({
	kind: 'tool-use',
	sessionId,
	timestamp,
	toolUseId: `${sessionId}-${timestamp}`,
	toolName,
	input: { file_path }
});

function tracker(...events: NimbusEvent[]): SessionFilesTracker {
	const instance = new SessionFilesTracker();
	for (const event of events) {
		instance.record(event);
	}
	return instance;
}

test('自分だけが触っているファイルは衝突にしない', () => {
	const files = tracker(use('a', 1, 'Edit', '/w/x.ts'), use('a', 2, 'Read', '/w/x.ts'));
	assert.strictEqual(files.conflictFor('a', '/w/x.ts'), undefined);
});

test('他のセッションが編集していれば、競合として知らせる', () => {
	const files = tracker(use('b', 1, 'Edit', '/w/x.ts'));
	assert.deepStrictEqual(files.conflictFor('a', '/w/x.ts'), {
		path: '/w/x.ts',
		sessionId: 'a',
		otherSessionIds: ['b'],
		otherWrote: true
	});
});

test('他のセッションが読んだだけなら、言い方を変える', () => {
	const files = tracker(use('b', 1, 'Read', '/w/x.ts'));
	const conflict = files.conflictFor('a', '/w/x.ts');
	assert.strictEqual(conflict?.otherWrote, false);
	assert.strictEqual(
		describeSessionConflict(conflict!, (id) => id.toUpperCase()),
		'x.ts は B も読んでいます。書き換えると相手の前提が古くなります'
	);
});

test('一度でも書いていれば「書いた」を保つ（あとの読みで上書きしない）', () => {
	const files = tracker(use('b', 1, 'Write', '/w/x.ts'), use('b', 2, 'Read', '/w/x.ts'));
	assert.strictEqual(files.conflictFor('a', '/w/x.ts')?.otherWrote, true);
});

test('ファイルを触らないツールは覚えない', () => {
	const files = new SessionFilesTracker();
	files.record({ kind: 'tool-use', sessionId: 'b', timestamp: 1, toolUseId: 'u', toolName: 'Bash', input: { command: 'ls' } });
	assert.deepStrictEqual(files.snapshots(), []);
});

test('終わったセッションは忘れる（終わった相手と衝突しても意味がない）', () => {
	const files = tracker(use('b', 1, 'Edit', '/w/x.ts'));
	files.forget('b');
	assert.strictEqual(files.conflictFor('a', '/w/x.ts'), undefined);
});

test('俯瞰は最後に動いたのが新しい順、ファイルも新しい順', () => {
	const files = tracker(
		use('a', 1, 'Read', '/w/old.ts'),
		use('a', 5, 'Edit', '/w/new.ts'),
		use('b', 9, 'Edit', '/w/z.ts')
	);
	const snapshots = files.snapshots();
	assert.deepStrictEqual(snapshots.map((s) => s.sessionId), ['b', 'a']);
	assert.deepStrictEqual(snapshots[1].files.map((f) => f.path), ['/w/new.ts', '/w/old.ts']);
	assert.deepStrictEqual(snapshots[1].files[0].kind, 'write');
});

test('複数のセッションが同じファイルを触っていれば全部挙げる', () => {
	const files = tracker(use('b', 1, 'Edit', '/w/x.ts'), use('c', 2, 'Read', '/w/x.ts'));
	const conflict = files.conflictFor('a', '/w/x.ts');
	assert.deepStrictEqual(conflict?.otherSessionIds.sort(), ['b', 'c']);
	assert.strictEqual(conflict?.otherWrote, true);
});
