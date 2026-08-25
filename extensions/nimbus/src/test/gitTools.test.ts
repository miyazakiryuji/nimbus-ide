/**
 * `nimbus_git` の読み解きと安全装置（T-307）。
 *
 * この口の存在理由は「並行セッションの作法を型にする」こと。
 * **自分の束と他人かもしれない変更を分けること**と、**名指し以外を通さないこと**が崩れたら、
 * ツールがあるほうが危なくなる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { parsePorcelainStatus, renderStatus, validateStagePaths } from '../core/gitTools';

test('porcelain を、束（staged）と作業ツリーに分けて読む（T-307）', () => {
	const text = [
		'## nimbus...origin/nimbus [ahead 2, behind 1]',
		'M  staged-only.ts',
		' M worktree-only.ts',
		'MM both.ts',
		'A  added.ts',
		'?? new-file.ts',
		'UU conflicted.ts',
		'R  old.ts -> renamed.ts',
		''
	].join('\n');
	assert.deepStrictEqual(parsePorcelainStatus(text), {
		branch: 'nimbus',
		upstream: 'origin/nimbus',
		ahead: 2,
		behind: 1,
		staged: ['staged-only.ts', 'both.ts', 'added.ts', 'renamed.ts'],
		unstaged: ['worktree-only.ts', 'both.ts'],
		untracked: ['new-file.ts'],
		conflicted: ['conflicted.ts']
	});
});

test('追跡先が無いブランチも読める（T-307）', () => {
	assert.deepStrictEqual(parsePorcelainStatus('## feature/x\n'), {
		branch: 'feature/x',
		upstream: undefined,
		ahead: 0,
		behind: 0,
		staged: [],
		unstaged: [],
		untracked: [],
		conflicted: []
	});
});

test('返す文は、他人かもしれない変更に触らせない言い分けをする（T-307）', () => {
	const rendered = renderStatus(
		parsePorcelainStatus(['## nimbus...origin/nimbus', 'M  mine.ts', ' M theirs.ts', ''].join('\n'))
	);
	assert.deepStrictEqual(
		[
			rendered.includes('自分が組んだ束'),
			rendered.includes('他のセッションのものかもしれない'),
			rendered.includes('mine.ts'),
			rendered.includes('theirs.ts')
		],
		[true, true, true, true]
	);
});

test('stage はパス名指しのみ。まとめ指定・範囲外・フラグは断る（T-307）', () => {
	assert.deepStrictEqual(validateStagePaths(['a.ts', 'dir/b.ts']), { ok: ['a.ts', 'dir/b.ts'] });
	// 断りかたは「なぜ駄目か」が言葉で入っていること（黙って無視しない）
	const refused = (['.', '-A', '--force', '/etc/passwd', '../outside.ts'] as const).map(
		(path) => validateStagePaths([path])
	);
	assert.deepStrictEqual(
		refused.map((result) => ('error' in result ? result.error.includes(path0(result.error)) : 'ok')),
		[true, true, true, true, true]
	);
	assert.ok('error' in validateStagePaths([]));

	/** 断りの文には、断った当のパスが入っている */
	function path0(message: string): string {
		return /「([^」]+)」/.exec(message)?.[1] ?? message;
	}
});
