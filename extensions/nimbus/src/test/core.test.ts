/**
 * VS Code を起動せずに走る単体テスト（node --test）。
 *
 * 拡張ホストが要るものはここには置かない。逆に、判断を誤ると実害が出るロジック
 * （承認前の差分・課金モードの表示・文脈の収集）は必ずここで押さえる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { test } from 'node:test';
import { buildPreview } from '../core/editPreview';
import { describeTool } from '../core/describe';
import { findClaudeMdFiles } from '../core/claudeMd';
import { billingModeLabel } from '../billing';

const noFiles = (): undefined => undefined;
const fileWith = (content: string) => (): string => content;

test('Write は既存ファイルの内容を「変更前」として差分にする', () => {
	const preview = buildPreview('Write', { file_path: '/tmp/a.txt', content: 'new' }, fileWith('old'));
	assert.deepStrictEqual(preview, { filePath: '/tmp/a.txt', original: 'old', proposed: 'new' });
});

test('Write は新規ファイルなら変更前を持たない', () => {
	const preview = buildPreview('Write', { file_path: '/tmp/new.txt', content: 'hello' }, noFiles);
	assert.strictEqual(preview?.original, undefined);
	assert.strictEqual(preview?.proposed, 'hello');
});

test('Edit は 1 箇所だけ置換する（replace_all なし）', () => {
	const preview = buildPreview(
		'Edit',
		{ file_path: '/tmp/a.txt', old_string: 'x', new_string: 'y' },
		fileWith('x-x')
	);
	assert.strictEqual(preview?.proposed, 'y-x');
});

test('Edit は replace_all で全置換する', () => {
	const preview = buildPreview(
		'Edit',
		{ file_path: '/tmp/a.txt', old_string: 'x', new_string: 'y', replace_all: true },
		fileWith('x-x')
	);
	assert.strictEqual(preview?.proposed, 'y-y');
});

test('Edit は対象文字列が無ければ差分を作らない（勝手な推測をしない）', () => {
	const preview = buildPreview(
		'Edit',
		{ file_path: '/tmp/a.txt', old_string: 'missing', new_string: 'y' },
		fileWith('abc')
	);
	assert.strictEqual(preview, undefined);
});

test('Edit は読めないファイルでは差分を作らない', () => {
	const preview = buildPreview('Edit', { file_path: '/tmp/a.txt', old_string: 'a', new_string: 'b' }, noFiles);
	assert.strictEqual(preview, undefined);
});

test('MultiEdit は順に適用する', () => {
	const preview = buildPreview(
		'MultiEdit',
		{
			file_path: '/tmp/a.txt',
			edits: [
				{ old_string: 'a', new_string: 'b' },
				{ old_string: 'b', new_string: 'c' }
			]
		},
		fileWith('a')
	);
	assert.strictEqual(preview?.proposed, 'c');
});

test('MultiEdit は途中で適用できない指示があれば全体を諦める', () => {
	const preview = buildPreview(
		'MultiEdit',
		{
			file_path: '/tmp/a.txt',
			edits: [
				{ old_string: 'a', new_string: 'b' },
				{ old_string: 'zzz', new_string: 'c' }
			]
		},
		fileWith('a')
	);
	assert.strictEqual(preview, undefined);
});

test('差分対象でないツールは undefined', () => {
	assert.strictEqual(buildPreview('Bash', { command: 'ls' }, fileWith('x')), undefined);
	assert.strictEqual(buildPreview('Write', { content: 'no path' }, noFiles), undefined);
});

test('サマリは代表的な引数を 1 行にまとめる', () => {
	assert.strictEqual(describeTool('Bash', { command: 'ls  -la\n' }), 'Bash: ls -la');
	assert.strictEqual(describeTool('Read', { file_path: '/tmp/a.txt' }), 'Read: /tmp/a.txt');
	assert.strictEqual(describeTool('Task', {}), 'Task');
	assert.strictEqual(describeTool('Task', null), 'Task');
});

test('サマリは長すぎる入力を畳む', () => {
	const summary = describeTool('Bash', { command: 'x'.repeat(500) });
	assert.ok(summary.length < 220, summary.length.toString());
	assert.ok(summary.endsWith('…'));
});

test('課金モード: OAuth ログイン（apiKeySource=none）はサブスク扱い', () => {
	// 旧版でここを従量課金と誤表示していた。実測で 'none' が届く
	assert.strictEqual(billingModeLabel('none'), 'サブスク利用（利用上限を消費）');
	assert.strictEqual(billingModeLabel('oauth'), 'サブスク利用（利用上限を消費）');
});

test('課金モード: API キー由来は従量課金、未接続は未確認', () => {
	assert.strictEqual(billingModeLabel('user'), 'API キー利用（従量課金）');
	assert.strictEqual(billingModeLabel('project'), 'API キー利用（従量課金）');
	assert.strictEqual(billingModeLabel(undefined), '接続未確認');
});

test('CLAUDE.md は作業ディレクトリから上へ辿って集める', () => {
	const root = mkdtempSync(join(tmpdir(), 'nimbus-md-'));
	const nested = join(root, 'a', 'b');
	mkdirSync(nested, { recursive: true });
	writeFileSync(join(root, 'CLAUDE.md'), 'root');
	writeFileSync(join(root, 'a', 'CLAUDE.md'), 'mid');

	const found = findClaudeMdFiles(nested, join(root, 'no-home'));
	assert.deepStrictEqual(found, [join(root, 'a', 'CLAUDE.md'), join(root, 'CLAUDE.md')]);
});

test('CLAUDE.md はユーザー設定（~/.claude/CLAUDE.md）も拾う', () => {
	const root = mkdtempSync(join(tmpdir(), 'nimbus-md-'));
	const home = join(root, 'home');
	mkdirSync(join(home, '.claude'), { recursive: true });
	writeFileSync(join(home, '.claude', 'CLAUDE.md'), 'user');

	const found = findClaudeMdFiles(join(root, 'work'), home);
	assert.deepStrictEqual(found, [join(home, '.claude', 'CLAUDE.md')]);
});
