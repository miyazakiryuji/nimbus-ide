/**
 * 全画面の右半分に出すもの（T-270）の単体テスト。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import type { NimbusEvent } from '../events';
import { sessionCommands, sessionWrittenFiles, terminalLines } from '../core/sessionSide';

const use = (toolUseId: string, toolName: string, input: Record<string, unknown>, timestamp = 1): NimbusEvent => ({
	kind: 'tool-use',
	sessionId: 's',
	timestamp,
	toolUseId,
	toolName,
	input
});

const result = (toolUseId: string, preview: string, isError = false): NimbusEvent => ({
	kind: 'tool-result',
	sessionId: 's',
	timestamp: 2,
	toolUseId,
	isError,
	preview
});

test('コマンドと結果を組にし、返ってきていないものは実行中のまま残す', () => {
	const commands = sessionCommands([
		use('a', 'Bash', { command: 'npm test' }, 10),
		result('a', 'ok\n'),
		use('b', 'Read', { file_path: '/w/x.ts' }, 11),
		use('c', 'Bash', { command: 'npm run build' }, 12)
	]);
	assert.deepStrictEqual(
		commands.map((entry) => [entry.command, entry.output, entry.failed]),
		[['npm test', 'ok\n', false], ['npm run build', undefined, undefined]]
	);
});

test('端末の行は、打ったコマンドと出力が続けて読める形になる', () => {
	const lines = terminalLines(
		sessionCommands([use('a', 'Bash', { command: 'ls' }), result('a', 'x\ny\n'), use('b', 'Bash', { command: 'boom' }), result('b', 'no', true)])
	);
	assert.deepStrictEqual(lines, ['$ ls', 'x', 'y', '', '$ boom', 'no', '（失敗しました）', '']);
});

test('差分に出すのは書いたファイルだけで、新しい順', () => {
	assert.deepStrictEqual(
		sessionWrittenFiles([
			use('a', 'Edit', { file_path: '/w/a.ts' }, 1),
			use('b', 'Read', { file_path: '/w/read-only.ts' }, 2),
			use('c', 'Write', { file_path: '/w/b.ts' }, 3),
			use('d', 'Edit', { file_path: '/w/a.ts' }, 4)
		]),
		['/w/a.ts', '/w/b.ts']
	);
});
