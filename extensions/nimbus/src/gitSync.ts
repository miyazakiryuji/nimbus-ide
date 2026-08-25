/**
 * 取り込みと押し上げ（tasks.md T-306）。Nimbus の作法は `git pull --rebase` → `git push`。
 *
 * **標準の口を先に使う** — fetch / 同期ボタンそのものは VS Code の Git 拡張が持っている
 * （既定は `configurationDefaults` で規約に合わせた）。ここに足すのは
 * **並行セッションの安全**だけ:
 *
 * - **autostash を勝手に使わない。** 作業ツリーに残っている未コミット変更は
 *   他のセッションのものかもしれない。触らず、止まって理由を言う
 * - 衝突したときも黙って続けない。rebase は止まったまま残し、次の一手を人に返す
 *
 * VS Code に依存しない（git を叩いて構造で返す）ので、画面のボタン（extension.ts）と
 * エージェントの口（`gitTools.ts` の `git_sync`・T-307）の両方から同じ安全装置を通る。
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await run('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
	return stdout;
}

export type SyncOutcome =
	/** 作業ツリーに（追跡中の）未コミット変更が残っている。何もしていない */
	| { kind: 'dirty'; files: string[] }
	/** 追跡先が無い。何もしていない（公開するかは人が決める） */
	| { kind: 'no-upstream'; branch: string }
	/** 取り込みで競合した。**rebase は止まったまま**（勝手に abort しない） */
	| { kind: 'conflict'; files: string[] }
	/** 取り込みが別の理由で失敗した。作業ツリーは触っていない */
	| { kind: 'pull-failed'; message: string }
	/** 取り込めたが、押し上げで失敗した（保護ブランチなど） */
	| { kind: 'push-failed'; message: string }
	| { kind: 'ok'; pushed: number };

/** いまのブランチ名 */
export async function currentBranch(cwd: string): Promise<string> {
	return (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
}

/** 追跡中のファイルに未コミットの変更があるか（untracked は rebase を止めないので除く） */
export async function dirtyTrackedFiles(cwd: string): Promise<string[]> {
	const status = await git(cwd, ['status', '--porcelain']);
	return status
		.split('\n')
		.filter((line) => line.length > 3 && !line.startsWith('??'))
		.map((line) => line.slice(3).trim());
}

/** `git pull --rebase` → `git push`。止まる条件はすべて構造で返す */
export async function performSync(cwd: string): Promise<SyncOutcome> {
	const dirty = await dirtyTrackedFiles(cwd);
	if (dirty.length > 0) {
		return { kind: 'dirty', files: dirty };
	}

	const branch = await currentBranch(cwd);
	try {
		await git(cwd, ['rev-parse', '--abbrev-ref', '@{upstream}']);
	} catch {
		return { kind: 'no-upstream', branch };
	}

	try {
		await git(cwd, ['pull', '--rebase']);
	} catch (error) {
		// 競合で止まったのか、別の理由かを分ける
		const conflicted = (await git(cwd, ['diff', '--name-only', '--diff-filter=U']).catch(() => ''))
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);
		if (conflicted.length > 0) {
			return { kind: 'conflict', files: conflicted };
		}
		return { kind: 'pull-failed', message: error instanceof Error ? error.message : String(error) };
	}

	const ahead = Number((await git(cwd, ['rev-list', '--count', '@{upstream}..HEAD'])).trim()) || 0;
	if (ahead > 0) {
		try {
			await git(cwd, ['push']);
		} catch (error) {
			return { kind: 'push-failed', message: error instanceof Error ? error.message : String(error) };
		}
	}
	return { kind: 'ok', pushed: ahead };
}

/** 取り込みを取り消す（競合で止まったあと、人が選んだときだけ呼ぶ） */
export async function abortRebase(cwd: string): Promise<void> {
	await git(cwd, ['rebase', '--abort']);
}

/** 追跡先を作って公開する（人が選んだときだけ呼ぶ） */
export async function publishBranch(cwd: string, branch: string): Promise<void> {
	await git(cwd, ['push', '-u', 'origin', branch]);
}

/**
 * 結果の言いかた。画面（通知）とエージェントの口（`git_sync`）で同じ文にする —
 * 場所によって言うことが違うと、どちらかが古くなる。
 */
export function describeSyncOutcome(outcome: SyncOutcome): string {
	switch (outcome.kind) {
		case 'dirty': {
			const shown = outcome.files.slice(0, 5).join(' / ');
			const rest = outcome.files.length > 5 ? ` ほか ${outcome.files.length - 5} 件` : '';
			return (
				`作業ツリーに未コミットの変更が残っています（${shown}${rest}）。` +
				'他のセッションのものかもしれないので、autostash はしません。先にコミットするか、持ち主に確かめてください。'
			);
		}
		case 'no-upstream':
			return `ブランチ ${outcome.branch} に追跡先がありません。公開するかは人が決めることなので、何もしていません。`;
		case 'conflict':
			return (
				`取り込みで競合しました（${outcome.files.join(' / ')}）。rebase は止めたままにしてあります。` +
				'解決して続けるか、取り消してください。'
			);
		case 'pull-failed':
			return `取り込みに失敗しました: ${outcome.message}`;
		case 'push-failed':
			return `取り込みは済みましたが、押し上げに失敗しました: ${outcome.message}`;
		case 'ok':
			return outcome.pushed > 0 ? `取り込み、${outcome.pushed} 件を押し上げました。` : '取り込みました。押し上げるものはありません。';
	}
}
