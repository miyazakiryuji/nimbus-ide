/**
 * worktree の生成・破棄を **実際の git** で検証する。
 *
 * ここで守りたいのは「完了しても成果は消えない」という約束。
 * `git worktree remove --force` は未コミットの変更を黙って捨てるので、
 * 破棄前に WIP コミットが作られていることを実物で確かめる。
 */
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { test } from 'node:test';
import { slugify, WorktreeManager, type GitRunner } from '../core/worktree';

/** テスト用 git。コミットできるよう identity を明示する（利用者の設定に依存させない） */
const git: GitRunner = async (args, cwd) =>
	execFileSync(
		'git',
		['-c', 'user.name=nimbus-test', '-c', 'user.email=nimbus-test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
		{ cwd, encoding: 'utf8' }
	);

function makeRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), 'nimbus-repo-'));
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
	writeFileSync(join(dir, 'README.md'), '# test\n');
	execFileSync('git', ['add', '-A'], { cwd: dir });
	execFileSync(
		'git',
		['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'init'],
		{ cwd: dir }
	);
	return dir;
}

test('slugify はブランチに使える形にする', () => {
	assert.strictEqual(slugify('Fix Login Bug!'), 'fix-login-bug');
	assert.strictEqual(slugify('  '), 'task');
	assert.strictEqual(slugify('ログイン修正'), 'ログイン修正');
	assert.ok(slugify('x'.repeat(100)).length <= 40);
});

test('worktree を作るとブランチとディレクトリができる', async () => {
	const repo = makeRepo();
	const base = mkdtempSync(join(tmpdir(), 'nimbus-wt-'));
	const manager = new WorktreeManager(base, git, () => 'abc123');

	const info = await manager.create(repo, 'Fix login');
	assert.strictEqual(info.branch, 'nimbus/fix-login-abc123');
	assert.ok(existsSync(info.path), 'worktree ディレクトリが存在すること');
	assert.ok(manager.isManaged(info.path), 'Nimbus 管理下と判定されること');

	const branches = await git(['branch', '--list', 'nimbus/*'], repo);
	assert.ok(branches.includes('nimbus/fix-login-abc123'));
});

test('git リポジトリでない場所では作成を断る', async () => {
	const notRepo = mkdtempSync(join(tmpdir(), 'nimbus-plain-'));
	const manager = new WorktreeManager(mkdtempSync(join(tmpdir(), 'nimbus-wt-')), git);
	await assert.rejects(() => manager.create(notRepo, 'x'), /Git リポジトリではない/);
});

test('破棄しても未コミットの成果は WIP コミットとしてブランチに残る', async () => {
	const repo = makeRepo();
	const base = mkdtempSync(join(tmpdir(), 'nimbus-wt-'));
	const manager = new WorktreeManager(base, git, () => 'dead01');

	const info = await manager.create(repo, 'keep my work');
	// Claude が書いた（まだコミットしていない）成果を模す
	writeFileSync(join(info.path, 'generated.txt'), 'とても大事な成果\n');

	const { wipCommit } = await manager.remove(repo, info.path);

	assert.ok(wipCommit, 'WIP コミットが作られること');
	assert.ok(!existsSync(info.path), 'worktree ディレクトリは削除されること');

	// ブランチは残り、その先端に成果が入っている
	const files = await git(['show', '--name-only', '--format=', info.branch], repo);
	assert.ok(files.includes('generated.txt'), `ブランチに成果が残っていること: ${files}`);
	const message = await git(['log', '-1', '--format=%s', info.branch], repo);
	assert.ok(message.includes('WIP'), message);
});

test('変更が無ければ WIP コミットは作らない', async () => {
	const repo = makeRepo();
	const base = mkdtempSync(join(tmpdir(), 'nimbus-wt-'));
	const manager = new WorktreeManager(base, git, () => 'clean1');

	const info = await manager.create(repo, 'nothing to do');
	const { wipCommit } = await manager.remove(repo, info.path);
	assert.strictEqual(wipCommit, undefined);
});

test('Nimbus 管理外のディレクトリは破棄しない', async () => {
	const repo = makeRepo();
	const base = mkdtempSync(join(tmpdir(), 'nimbus-wt-'));
	const manager = new WorktreeManager(base, git);
	await assert.rejects(() => manager.remove(repo, repo), /Nimbus が作成した worktree ではない/);
	assert.ok(existsSync(join(repo, 'README.md')), 'リポジトリ本体が消されていないこと');
});
