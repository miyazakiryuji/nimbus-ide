/**
 * コンフリクトの解決を助ける（tasks.md T-115）。
 *
 * 競合しているファイルを集め、1 件ずつ「こちら / むこう / 両方」を選ばせて書き戻す。
 * 判断がつかないものは Claude に相談文を投げる（両側をそのまま見せて、意図を残すマージを頼む）。
 *
 * 読み解きの本体は `core/conflicts.ts`（VS Code 非依存・単体テスト済み）。
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { pickWorkspaceRoot } from './workspaceRoots';
import {
	conflictPrompt,
	describeConflict,
	looksAdditive,
	parseConflicts,
	resolveConflicts,
	type Resolution
} from './core/conflicts';

const run = promisify(execFile);

/** `git diff --diff-filter=U` で競合中のファイルを集める */
async function conflictedFiles(cwd: string): Promise<string[]> {
	const { stdout } = await run('git', ['diff', '--name-only', '--diff-filter=U'], { cwd, maxBuffer: 4 * 1024 * 1024 });
	return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

/**
 * 場所が分かっているときの入口（T-308）。CodeLens・SCM の「マージの変更」・
 * マージエディタから来るので、ファイル選びを飛ばして**その場から**相談文を送る。
 *
 * 約束は本流と同じ — **返ってきた案を勝手に書き戻さない**。送るだけ。
 */
export async function assistConflictAt(
	send: (text: string) => void,
	uri: vscode.Uri,
	startLine?: number
): Promise<void> {
	const document = await vscode.workspace.openTextDocument(uri);
	const blocks = parseConflicts(document.getText());
	if (blocks.length === 0) {
		void vscode.window.showInformationMessage(
			`Nimbus: ${vscode.workspace.asRelativePath(uri, false)} に読み取れる競合がありません。`
		);
		return;
	}
	// 行で名指しされたらその 1 件だけ。見つからなければ（編集で行がずれた等）全部
	const target = startLine === undefined ? undefined : blocks.find((block) => block.start === startLine);
	send(conflictPrompt(vscode.workspace.asRelativePath(uri, false), target ? [target] : blocks));
}

export async function assistConflicts(send: (text: string) => void): Promise<void> {
	// マルチルート対応（T-173）。競合はフォルダごとに違うので、対象を決めてから探す。
	// フォルダが 1 つなら何も聞かない
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const cwd = folder.uri.fsPath;

	let files: string[];
	try {
		files = await conflictedFiles(cwd);
	} catch (error) {
		void vscode.window.showErrorMessage(
			`Nimbus: git の状態を読めませんでした: ${error instanceof Error ? error.message : String(error)}`
		);
		return;
	}
	if (files.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 競合しているファイルはありません。');
		return;
	}

	const file = files.length === 1
		? files[0]
		: await vscode.window.showQuickPick(files, { title: `Nimbus: 競合しているファイル（${files.length} 件）` });
	if (!file) {
		return;
	}

	const uri = vscode.Uri.joinPath(folder.uri, file);
	const document = await vscode.workspace.openTextDocument(uri);
	await vscode.window.showTextDocument(document, { preview: false });
	const blocks = parseConflicts(document.getText());
	if (blocks.length === 0) {
		void vscode.window.showInformationMessage(
			`Nimbus: ${file} に読み取れる競合がありません（マーカーが閉じていない可能性）。`
		);
		return;
	}

	const ASK = 'Claude に相談する';
	const RESOLVE = '1 件ずつ選んで解決する';
	const how = await vscode.window.showQuickPick([RESOLVE, ASK], {
		title: `Nimbus: ${file} に ${blocks.length} 件の競合`
	});
	if (!how) {
		return;
	}
	if (how === ASK) {
		send(conflictPrompt(file, blocks));
		return;
	}

	const OURS = 'こちらを採る';
	const THEIRS = 'むこうを採る';
	const BOTH = '両方残す';
	const SKIP = 'そのままにする';
	const choices = new Map<number, Resolution>();
	for (const [index, block] of blocks.entries()) {
		// 追記どうしに見えるものは「両方残す」を先頭に置く。
		// 並行開発で起きる競合の大半はこの形で、片方を捨てる理由が無い
		const additive = looksAdditive(block);
		const items = additive ? [BOTH, OURS, THEIRS, SKIP] : [OURS, THEIRS, BOTH, SKIP];
		const picked = await vscode.window.showQuickPick(items, {
			title: describeConflict(block, index),
			placeHolder: additive ? '両側に共通の行が無く、追記どうしのぶつかりに見えます' : undefined
		});
		if (!picked) {
			return; // 途中でやめたら何も書き換えない
		}
		if (picked === OURS) {
			choices.set(index, 'ours');
		} else if (picked === THEIRS) {
			choices.set(index, 'theirs');
		} else if (picked === BOTH) {
			choices.set(index, 'both');
		}
	}
	if (choices.size === 0) {
		void vscode.window.showInformationMessage('Nimbus: 何も変更しませんでした。');
		return;
	}

	const resolved = resolveConflicts(document.getText(), choices);
	const edit = new vscode.WorkspaceEdit();
	const whole = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
	edit.replace(uri, whole, resolved);
	await vscode.workspace.applyEdit(edit);

	const left = blocks.length - choices.size;
	void vscode.window.showInformationMessage(
		left > 0
			? `Nimbus: ${choices.size} 件を解決しました（${left} 件はそのまま残しています）。保存すると反映されます。`
			: `Nimbus: ${choices.size} 件すべてを解決しました。保存して git add してください。`
	);
}
