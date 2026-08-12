/**
 * 段階的リファクタの進捗を追う（tasks.md T-111）。
 *
 * 大きな置き換えが途中で止まるのは、**どこまでやったか分からなくなる**から。
 * 残りの件数さえ見えていれば、翌日でも別のセッションでも再開できる。
 *
 * 数え方は `git grep -c` に任せる（`.gitignore` を尊重するし、速い）。
 * 進捗の計算と見せ方は `core/refactorProgress.ts`。
 */
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import {
	buildRefactorPrompt,
	parseGrepCounts,
	progressOf,
	rankRemaining,
	renderProgress,
	totalOf,
	type RefactorTrack
} from './core/refactorProgress';

const STORAGE_KEY = 'nimbus.refactorTracks';

export interface RefactorProgressDeps {
	storage: vscode.Memento;
	send: (text: string) => void;
	log: (message: string) => void;
}

function gitGrepCounts(cwd: string, pattern: string): Promise<Map<string, number>> {
	return new Promise((resolve, reject) => {
		// -c でファイルごとの件数、-E で拡張正規表現、-I でバイナリを除く
		execFile('git', ['grep', '-c', '-I', '-E', '--', pattern], { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
			// 一致が無いと exit 1。エラー扱いにしない
			if (error && stdout.length === 0 && (error as { code?: number }).code !== 1) {
				reject(error);
				return;
			}
			resolve(parseGrepCounts(stdout));
		});
	});
}

function tracks(storage: vscode.Memento): RefactorTrack[] {
	return storage.get<RefactorTrack[]>(STORAGE_KEY, []);
}

/**
 * 置き換えを追いかけ始める。
 * いまの件数を分母として控える — 途中から数え始めても「残り」は正しく出る。
 */
export async function startRefactorTrack(deps: RefactorProgressDeps): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showErrorMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}
	const pattern = await vscode.window.showInputBox({
		title: 'Nimbus: 置き換えを追いかける',
		prompt: '残りを数えるパターン（拡張正規表現・git grep に渡します）',
		placeHolder: '例: getUserById\\(|OldWidget'
	});
	if (!pattern) {
		return;
	}
	const label = await vscode.window.showInputBox({
		title: 'Nimbus: 置き換えを追いかける',
		prompt: 'この置き換えの名前',
		value: pattern
	});
	if (!label) {
		return;
	}

	let counts: Map<string, number>;
	try {
		counts = await gitGrepCounts(folder.uri.fsPath, pattern);
	} catch (error) {
		deps.log(`[refactor] 数えられませんでした: ${error instanceof Error ? error.message : String(error)}`);
		void vscode.window.showErrorMessage('Nimbus: git grep で数えられませんでした（パターンを確かめてください）。');
		return;
	}
	const initial = totalOf(counts);
	if (initial === 0) {
		void vscode.window.showInformationMessage('Nimbus: そのパターンに当たる箇所がありません。');
		return;
	}

	const track: RefactorTrack = { id: randomUUID(), label, pattern, initial, createdAt: Date.now() };
	await deps.storage.update(STORAGE_KEY, [...tracks(deps.storage), track]);
	deps.log(`[refactor] 追跡開始 ${label}（${initial} 箇所）`);
	void vscode.window.showInformationMessage(`Nimbus: 「${label}」を追いかけます（いま ${initial} 箇所）。`);
}

/** 追いかけている置き換えの進捗を出し、続きを頼む・やめるを選べる */
export async function showRefactorProgress(deps: RefactorProgressDeps): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showErrorMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}
	const all = tracks(deps.storage);
	if (all.length === 0) {
		void vscode.window.showInformationMessage(
			'Nimbus: 追いかけている置き換えはありません（「置き換えを追いかける」で始めます）。'
		);
		return;
	}

	const rows: { label: string; track: RefactorTrack; counts: Map<string, number> }[] = [];
	for (const track of all) {
		const counts = await gitGrepCounts(folder.uri.fsPath, track.pattern).catch(() => new Map<string, number>());
		rows.push({ label: renderProgress(progressOf(track, totalOf(counts))), track, counts });
	}

	const picked = await vscode.window.showQuickPick(rows, {
		title: 'Nimbus: 置き換えの進捗',
		placeHolder: '続きを頼むものを選ぶ'
	});
	if (!picked) {
		return;
	}

	const remaining = totalOf(picked.counts);
	if (remaining === 0) {
		const DONE = '追跡をやめる';
		const choice = await vscode.window.showInformationMessage(
			`Nimbus: 「${picked.track.label}」は残り 0 箇所です。`,
			DONE
		);
		if (choice === DONE) {
			await deps.storage.update(
				STORAGE_KEY,
				tracks(deps.storage).filter((track) => track.id !== picked.track.id)
			);
		}
		return;
	}

	const SEND = '続きを頼む';
	const STOP = '追跡をやめる';
	const choice = await vscode.window.showInformationMessage(
		`Nimbus: 「${picked.track.label}」は残り ${remaining} 箇所です。`,
		SEND,
		STOP
	);
	if (choice === SEND) {
		deps.send(buildRefactorPrompt(progressOf(picked.track, remaining), rankRemaining(picked.counts)));
	} else if (choice === STOP) {
		await deps.storage.update(
			STORAGE_KEY,
			tracks(deps.storage).filter((track) => track.id !== picked.track.id)
		);
	}
}
