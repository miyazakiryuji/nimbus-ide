/**
 * 取り込みと押し上げ（T-306）。**実際の git リポジトリで確かめる** —
 * ここの判定を間違えると、他のセッションの変更に触るか、黙って壊れたまま進む。
 *
 * 形は 2 つのクローン（自分と「別の人」）＋ bare の origin。
 */
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { test } from 'node:test';
import { describeSyncOutcome, dirtyTrackedFiles, performSync } from '../gitSync';

function sh(cwd: string, args: string[]): string {
	return execFileSync(
		'git',
		['-c', 'user.name=nimbus-test', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args],
		{ cwd, encoding: 'utf8' }
	);
}

/** bare の origin と、それを追跡するクローンを 2 つ作る */
function makeRemoteAndClones(): { origin: string; mine: string; theirs: string } {
	const base = mkdtempSync(join(tmpdir(), 'nimbus-sync-'));
	const origin = join(base, 'origin.git');
	execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
	const seed = join(base, 'seed');
	execFileSync('git', ['clone', '-q', origin, seed]);
	writeFileSync(join(seed, 'a.txt'), '1\n');
	sh(seed, ['add', 'a.txt']);
	sh(seed, ['commit', '-q', '-m', 'init']);
	sh(seed, ['push', '-q', '-u', 'origin', 'main']);
	const mine = join(base, 'mine');
	const theirs = join(base, 'theirs');
	execFileSync('git', ['clone', '-q', origin, mine]);
	execFileSync('git', ['clone', '-q', origin, theirs]);
	return { origin, mine, theirs };
}

test('取り込んで押し上げる（相手の変更と自分のコミットが両方通る）（T-306）', async () => {
	const { mine, theirs } = makeRemoteAndClones();
	// 相手が origin へ 1 つ積む
	writeFileSync(join(theirs, 'b.txt'), 'theirs\n');
	sh(theirs, ['add', 'b.txt']);
	sh(theirs, ['commit', '-q', '-m', 'theirs']);
	sh(theirs, ['push', '-q']);
	// 自分も 1 つコミットしてから同期
	writeFileSync(join(mine, 'c.txt'), 'mine\n');
	sh(mine, ['add', 'c.txt']);
	sh(mine, ['commit', '-q', '-m', 'mine']);

	const outcome = await performSync(mine);
	assert.deepStrictEqual(outcome, { kind: 'ok', pushed: 1 });
	// rebase で取り込めている（相手のファイルが居る・origin と一致）
	assert.strictEqual(sh(mine, ['rev-list', '--count', '@{upstream}..HEAD']).trim(), '0');
});

test('未コミットの変更が残っていたら、何もせず止まる（autostash しない）（T-306）', async () => {
	const { mine } = makeRemoteAndClones();
	writeFileSync(join(mine, 'a.txt'), '他のセッションが書き換え中かもしれない\n');

	const outcome = await performSync(mine);
	assert.deepStrictEqual(outcome, { kind: 'dirty', files: ['a.txt'] });
	// 触っていないこと（変更がそのまま残る）
	assert.deepStrictEqual(await dirtyTrackedFiles(mine), ['a.txt']);
	assert.ok(describeSyncOutcome(outcome).includes('autostash はしません'));
});

test('競合したら rebase を止めたまま返す（黙って続けない）（T-306）', async () => {
	const { mine, theirs } = makeRemoteAndClones();
	writeFileSync(join(theirs, 'a.txt'), 'theirs\n');
	sh(theirs, ['add', 'a.txt']);
	sh(theirs, ['commit', '-q', '-m', 'theirs']);
	sh(theirs, ['push', '-q']);
	writeFileSync(join(mine, 'a.txt'), 'mine\n');
	sh(mine, ['add', 'a.txt']);
	sh(mine, ['commit', '-q', '-m', 'mine']);

	const outcome = await performSync(mine);
	assert.deepStrictEqual(outcome, { kind: 'conflict', files: ['a.txt'] });
	// rebase は止まったまま（取り消しは人が選ぶ）。後片付けして終わる
	sh(mine, ['rebase', '--abort']);
});

test('追跡先が無ければ、公開せずにそう言う（T-306）', async () => {
	const { mine } = makeRemoteAndClones();
	sh(mine, ['checkout', '-q', '-b', 'feature/x']);

	const outcome = await performSync(mine);
	assert.deepStrictEqual(outcome, { kind: 'no-upstream', branch: 'feature/x' });
});

test('何も無いときに押しても壊れない（T-306）', async () => {
	const { mine } = makeRemoteAndClones();
	assert.deepStrictEqual(await performSync(mine), { kind: 'ok', pushed: 0 });
});
