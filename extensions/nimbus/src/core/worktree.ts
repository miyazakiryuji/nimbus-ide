/**
 * git worktree の生成・破棄。
 *
 * タスクごとに worktree を切ることで、複数の Claude セッションが同じリポジトリを
 * 同時に触っても互いの作業を壊さない。worktree の実体は利用者のリポジトリの外
 * （既定で `~/.nimbus/worktrees/<repo>/<slug>`）に置き、リポジトリを汚さない。
 *
 * git の呼び出しは注入できるようにしてある（テストで実 git を使うため）。
 * simple-git のような依存を足さないのは、同梱物を増やしたくないから。
 */
import { execFile } from 'child_process';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { basename, join, resolve, sep } from 'path';
import { randomBytes } from 'crypto';

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

export const runGit: GitRunner = (args, cwd) =>
	new Promise((resolvePromise, reject) => {
		execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(`git ${args.join(' ')} が失敗しました: ${stderr.trim() || error.message}`));
				return;
			}
			resolvePromise(stdout);
		});
	});

export interface WorktreeInfo {
	path: string;
	branch: string;
}

/** タスク名からブランチ／ディレクトリに使える slug を作る（日本語はそのまま残す） */
export function slugify(title: string): string {
	const base = title
		.toLowerCase()
		.replace(/[^a-z0-9぀-ヿ一-龯]+/gi, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	return base || 'task';
}

export class WorktreeManager {
	constructor(
		private readonly baseDir: string = join(homedir(), '.nimbus', 'worktrees'),
		private readonly git: GitRunner = runGit,
		private readonly randomSuffix: () => string = () => randomBytes(3).toString('hex')
	) { }

	/** Nimbus が作った worktree かどうか（管理外を消さないための門番） */
	isManaged(worktreePath: string): boolean {
		const base = resolve(this.baseDir);
		const target = resolve(worktreePath);
		return target !== base && target.startsWith(base + sep);
	}

	async create(repoCwd: string, title: string): Promise<WorktreeInfo> {
		try {
			await this.git(['rev-parse', '--is-inside-work-tree'], repoCwd);
		} catch {
			throw new Error('このフォルダは Git リポジトリではないため、worktree を作成できません');
		}
		const slug = `${slugify(title)}-${this.randomSuffix()}`;
		const branch = `nimbus/${slug}`;
		const parent = join(this.baseDir, basename(resolve(repoCwd)));
		mkdirSync(parent, { recursive: true });
		const dir = join(parent, slug);
		await this.git(['worktree', 'add', '-b', branch, dir], repoCwd);
		return { path: dir, branch };
	}

	/**
	 * worktree を破棄する。ブランチは残す（マージは利用者の通常フローで行う）。
	 *
	 * `git worktree remove --force` は未コミットの変更を黙って捨てるため、
	 * **削除前に必ずタスクのブランチへ WIP コミットして成果を残す**。
	 * 「ブランチは残るから安心」という約束を実体化させるための処理で、
	 * 旧 Electron 版では敵対的レビューでここのデータ消失を指摘されて入れた。
	 */
	async remove(repoCwd: string, worktreePath: string): Promise<{ wipCommit?: string }> {
		if (!this.isManaged(worktreePath)) {
			throw new Error('Nimbus が作成した worktree ではないため破棄できません');
		}
		let wipCommit: string | undefined;
		try {
			const status = await this.git(['status', '--porcelain'], worktreePath);
			if (status.trim().length > 0) {
				await this.git(['add', '-A'], worktreePath);
				await this.git(['commit', '-m', 'nimbus: WIP（タスク完了時の自動保存）'], worktreePath);
				wipCommit = (await this.git(['rev-parse', 'HEAD'], worktreePath)).trim();
			}
		} catch {
			// 保存に失敗しても破棄自体は続ける（worktree が壊れている場合など）
		}
		await this.git(['worktree', 'remove', '--force', worktreePath], repoCwd);
		return { wipCommit };
	}

	async list(repoCwd: string): Promise<string[]> {
		const output = await this.git(['worktree', 'list', '--porcelain'], repoCwd);
		return output
			.split('\n')
			.filter((line) => line.startsWith('worktree '))
			.map((line) => line.slice('worktree '.length).trim());
	}
}
