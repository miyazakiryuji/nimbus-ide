/**
 * 「どこまで見たか」を覚えておくビュー（tasks.md T-160）。
 *
 * 変更が数十ファイルに及ぶと、人は途中で中断する。中断したときに
 * 「どこまで見たか」が残っていないと最初から見直すことになり、それが嫌でレビューが雑になる。
 *
 * 印は**内容の指紋**に対して付ける。見たあとに書き換わったものは自動で未レビューに戻り、
 * 「見たあとに変わった」と理由が出る。判断の本体は `core/reviewState.ts`（単体テスト済み）。
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import type { Memento } from 'vscode';
import {
	buildEntries,
	formatProgress,
	progressOf,
	pruneMarks,
	withMark,
	type ReviewEntry,
	type ReviewMarks
} from './core/reviewState';

const run = promisify(execFile);
const STORAGE_KEY = 'nimbus.review.marks';

export class ReviewViewProvider implements vscode.TreeDataProvider<ReviewEntry>, vscode.Disposable {
	private entries: ReviewEntry[] = [];
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.emitter.event;

	constructor(
		private readonly storage: Memento,
		private readonly cwd: () => string | undefined,
		private readonly log: (message: string) => void
	) { }

	private marks(): ReviewMarks {
		return this.storage.get<ReviewMarks>(STORAGE_KEY, {});
	}

	/** `git diff HEAD` を 1 回読んでファイルごとに割る（未追跡は差分に出ないので名前だけ拾う） */
	private async changedFiles(cwd: string): Promise<Map<string, string>> {
		const files = new Map<string, string>();
		const { stdout } = await run('git', ['diff', 'HEAD', '--unified=0'], { cwd, maxBuffer: 32 * 1024 * 1024 });
		let path: string | undefined;
		let buffer: string[] = [];
		const flush = (): void => {
			if (path) {
				files.set(path, buffer.join('\n'));
			}
			buffer = [];
		};
		for (const line of stdout.split('\n')) {
			const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
			if (header) {
				flush();
				path = header[2];
				continue;
			}
			if (path) {
				buffer.push(line);
			}
		}
		flush();

		const { stdout: untracked } = await run('git', ['ls-files', '--others', '--exclude-standard'], { cwd });
		for (const name of untracked.split('\n').map((l) => l.trim()).filter(Boolean)) {
			// 未追跡は中身が丸ごと新規。差分の代わりにパスを指紋の材料にする
			// （中身まで読むと巨大ファイルで詰まるため。新規は「見たかどうか」だけで足りる）
			files.set(name, `新規ファイル: ${name}`);
		}
		return files;
	}

	async refresh(): Promise<void> {
		const cwd = this.cwd();
		if (!cwd) {
			this.entries = [];
			this.emitter.fire();
			return;
		}
		try {
			const files = await this.changedFiles(cwd);
			// コミット済みのものの印は捨てる（溜め込まない）
			await this.storage.update(STORAGE_KEY, pruneMarks(this.marks(), files.keys()));
			this.entries = buildEntries(files, this.marks());
		} catch (error) {
			this.log(`[review] 変更の取得に失敗: ${error instanceof Error ? error.message : String(error)}`);
			this.entries = [];
		}
		this.emitter.fire();
	}

	async setReviewed(entry: ReviewEntry, reviewed: boolean): Promise<void> {
		await this.storage.update(STORAGE_KEY, withMark(this.marks(), entry, reviewed));
		await this.refresh();
	}

	/** すべての印を外す（見直しを最初からやるとき） */
	async clearAll(): Promise<void> {
		await this.storage.update(STORAGE_KEY, {});
		await this.refresh();
	}

	progressLabel(): string {
		return formatProgress(progressOf(this.entries));
	}

	list(): readonly ReviewEntry[] {
		return this.entries;
	}

	getTreeItem(entry: ReviewEntry): vscode.TreeItem {
		const item = new vscode.TreeItem(entry.path, vscode.TreeItemCollapsibleState.None);
		item.resourceUri = vscode.Uri.file(entry.path);
		item.description = entry.changedSinceReview ? '見たあとに変わった' : entry.reviewed ? '済み' : undefined;
		item.iconPath = new vscode.ThemeIcon(
			entry.changedSinceReview ? 'warning' : entry.reviewed ? 'check' : 'circle-large-outline',
			entry.changedSinceReview ? new vscode.ThemeColor('list.warningForeground') : undefined
		);
		item.contextValue = entry.reviewed ? 'nimbusReviewed' : 'nimbusUnreviewed';
		item.tooltip = entry.changedSinceReview
			? `${entry.path}\n\n一度見たあとに書き換わっています。見直してください。`
			: entry.path;
		// クリックで差分を開く（見るための導線が無いと、印だけの画面になる）
		item.command = {
			command: 'nimbus.openReviewDiff',
			title: '差分を開く',
			arguments: [entry]
		};
		return item;
	}

	getChildren(entry?: ReviewEntry): ReviewEntry[] {
		if (entry) {
			return [];
		}
		return this.entries.length > 0 ? [...this.entries] : [];
	}

	dispose(): void {
		this.emitter.dispose();
	}
}
