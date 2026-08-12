/**
 * スナップショットの更新をレビューする（tasks.md T-181）。
 *
 * 落ちたから撮り直した、が通ってしまうとテストは何も守らなくなる。
 * **何が更新されたのかを名指しで出す**ところまでを機械がやる。
 *
 * 読み取りと文面は `core/snapshotReview.ts`。ここは git と VS Code の口。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { displayPath } from './core/lsp';
import {
	buildSnapshotPrompt,
	changedSnapshotKeys,
	describeSnapshotChanges,
	isBinarySnapshot,
	isSnapshotPath,
	parseNameStatus,
	type SnapshotChange
} from './core/snapshotReview';

export interface SnapshotReviewDeps {
	send: (text: string) => void;
	log: (message: string) => void;
}

function git(cwd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
			if (error) {
				reject(error);
				return;
			}
			resolve(stdout);
		});
	});
}

/** 変わったスナップショットを集めて見せ、そのままレビューを頼めるようにする */
export async function reviewSnapshots(deps: SnapshotReviewDeps): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showErrorMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}
	const root = folder.uri.fsPath;

	let changes: SnapshotChange[];
	try {
		const nameStatus = await git(root, ['diff', '--name-status', 'HEAD']);
		const candidates = parseNameStatus(nameStatus).filter((entry) => isSnapshotPath(entry.path));
		changes = [];
		for (const candidate of candidates) {
			const binary = isBinarySnapshot(candidate.path);
			let keys: string[] = [];
			if (!binary && candidate.status !== 'deleted') {
				const diff = await git(root, ['diff', '-U0', 'HEAD', '--', candidate.path]).catch(() => '');
				keys = changedSnapshotKeys(diff);
			}
			changes.push({ path: candidate.path, status: candidate.status, binary, keys });
		}
	} catch (error) {
		deps.log(`[snapshot] 差分を取れませんでした: ${error instanceof Error ? error.message : String(error)}`);
		void vscode.window.showErrorMessage('Nimbus: git の差分を取得できませんでした。');
		return;
	}

	const show = (path: string): string => displayPath([root], vscode.Uri.joinPath(folder.uri, path).fsPath);
	const summary = describeSnapshotChanges(changes, show);
	deps.log(`[snapshot] ${summary.split('\n')[0]}`);
	if (changes.length === 0) {
		void vscode.window.showInformationMessage(`Nimbus: ${summary}`);
		return;
	}

	const OPEN = '差分を開く';
	const ASK = '説明させる';
	const choice = await vscode.window.showWarningMessage(
		`Nimbus: ${summary.split('\n')[0]}`,
		{ detail: summary, modal: false },
		OPEN,
		ASK
	);
	if (choice === ASK) {
		deps.send(buildSnapshotPrompt(changes, show));
		return;
	}
	if (choice !== OPEN) {
		return;
	}

	const picked = await vscode.window.showQuickPick(
		changes.map((change) => ({ label: show(change.path), description: change.keys.join(', '), change })),
		{ title: 'Nimbus: 更新されたスナップショット', placeHolder: '開くものを選ぶ' }
	);
	if (!picked) {
		return;
	}
	// 画像はエディタで開く（差分では読めない）。テキストは SCM の差分に載せる
	const uri = vscode.Uri.joinPath(folder.uri, picked.change.path);
	if (picked.change.binary) {
		await vscode.commands.executeCommand('vscode.open', uri);
	} else {
		await vscode.commands.executeCommand('vscode.diff', uri.with({ scheme: 'git', query: 'HEAD' }), uri, `${show(picked.change.path)}（HEAD ↔ いま）`);
	}
}
