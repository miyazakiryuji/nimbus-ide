/**
 * 証跡つき完了報告（T-081）の単体テスト。
 *
 * ここで一番大事なのは「**判定できないものを『通った』に倒さない**」こと。
 * 倒した瞬間、報告そのものが嘘になり、証跡を添える意味が消える。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import type { NimbusEvent } from '../events';
import { assessTestOutcome, collectEvidence, describeEvidence, isBackedByTests, isTestCommand } from '../core/evidence';

type EventBody<T> = T extends NimbusEvent ? Omit<T, 'sessionId' | 'timestamp'> : never;
const at = (timestamp: number, event: EventBody<NimbusEvent>): NimbusEvent =>
	({ ...event, sessionId: 's1', timestamp }) as NimbusEvent;

test('主要なランナーのテストコマンドを拾う', () => {
	for (const command of [
		'npm test',
		'npm run test -- --grep x',
		'pnpm test',
		'node --test out/test',
		'pytest -q',
		'go test ./...',
		'cargo test',
		'flutter test',
		'./gradlew testDebugUnitTest',
		'bash nimbus/scripts/test.sh',
		'cd /w && npm test'
	]) {
		assert.ok(isTestCommand(command), command);
	}
});

test('テストでないコマンドを拾わない', () => {
	for (const command of ['npm run compile', 'ls -la', 'git status', 'node build.js', 'echo test']) {
		assert.ok(!isTestCommand(command), command);
	}
});

test('判定できない出力は「通った」に倒さない', () => {
	assert.strictEqual(assessTestOutcome(false, 'なんだかよく分からない出力'), 'unknown');
	assert.strictEqual(assessTestOutcome(false, ''), 'unknown');
});

test('失敗を成功より先に見る（失敗の出力にも成功件数が並ぶため）', () => {
	// node --test の出力に近い形。pass 224 が先に出ていても失敗と判定する
	assert.strictEqual(assessTestOutcome(false, '# tests 226\n# pass 225\n# fail 1'), 'failed');
	assert.strictEqual(assessTestOutcome(false, '# tests 226\n# pass 226\n# fail 0'), 'passed');
});

test('ツール自体が失敗していれば失敗', () => {
	assert.strictEqual(assessTestOutcome(true, '# fail 0'), 'failed');
});

test('証跡はテスト実行だけを集め、結果と対応づける', () => {
	const evidence = collectEvidence([
		at(1, { kind: 'user-text', text: 'テストを直して' }),
		at(2, { kind: 'tool-use', toolUseId: 'u1', toolName: 'Edit', input: { file_path: '/w/a.ts' } }),
		at(3, { kind: 'tool-use', toolUseId: 'u2', toolName: 'Bash', input: { command: 'npm run compile' } }),
		at(4, { kind: 'tool-result', toolUseId: 'u2', isError: false, preview: 'done' }),
		at(5, { kind: 'tool-use', toolUseId: 'u3', toolName: 'Bash', input: { command: 'node  --test  out/test' } }),
		at(6, { kind: 'tool-result', toolUseId: 'u3', isError: false, preview: '# pass 10\n# fail 0' })
	]);
	assert.deepStrictEqual(evidence.runs, [
		{ command: 'node --test out/test', at: 5, outcome: 'passed', output: '# pass 10\n# fail 0' }
	]);
	assert.deepStrictEqual(evidence.changedFiles, ['/w/a.ts']);
	assert.strictEqual(evidence.attributions.length, 1);
});

test('結果がまだ返っていない実行も、走らせた事実として残す', () => {
	const evidence = collectEvidence([
		at(1, { kind: 'tool-use', toolUseId: 'u1', toolName: 'Bash', input: { command: 'npm test' } })
	]);
	assert.deepStrictEqual(evidence.runs, [{ command: 'npm test', at: 1, outcome: 'unknown', output: '（実行中）' }]);
});

test('テストを走らせていなければ「完了」と言わせない', () => {
	const evidence = collectEvidence([at(1, { kind: 'tool-use', toolUseId: 'u1', toolName: 'Edit', input: { file_path: '/w/a.ts' } })]);
	assert.strictEqual(isBackedByTests(evidence), false);
	assert.strictEqual(describeEvidence(evidence), 'テストを実行していません');
});

test('最後の実行が通っていなければ「完了」と言わせない', () => {
	const failing = collectEvidence([
		at(1, { kind: 'tool-use', toolUseId: 'u1', toolName: 'Bash', input: { command: 'npm test' } }),
		at(2, { kind: 'tool-result', toolUseId: 'u1', isError: false, preview: '# pass 9\n# fail 1' })
	]);
	assert.strictEqual(isBackedByTests(failing), false);
	assert.strictEqual(describeEvidence(failing), 'テスト 1 回実行・最後は失敗（npm test）');
});

test('直して通し直した場合は、最後の実行で判断する', () => {
	const fixed = collectEvidence([
		at(1, { kind: 'tool-use', toolUseId: 'u1', toolName: 'Bash', input: { command: 'npm test' } }),
		at(2, { kind: 'tool-result', toolUseId: 'u1', isError: false, preview: '# fail 1' }),
		at(3, { kind: 'tool-use', toolUseId: 'u2', toolName: 'Bash', input: { command: 'npm test' } }),
		at(4, { kind: 'tool-result', toolUseId: 'u2', isError: false, preview: '# fail 0' })
	]);
	assert.strictEqual(isBackedByTests(fixed), true);
	assert.strictEqual(describeEvidence(fixed), 'テスト 2 回実行・最後は成功（npm test）');
});
