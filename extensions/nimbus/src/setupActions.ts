/**
 * 「準備」の各項目を、押したら直るところまで持っていく（tasks.md T-285）。
 *
 * これまでは「設定 `nimbus.claudeCodeExecutable` にパスを指定してください」と
 * **設定名を告げるだけ**だった。名前を知らされても、設定画面を開いて、
 * 項目を探して、パスを調べて、貼る ── そこまで全部が利用者の仕事になる。
 * ここはその手数を引き受ける（人間工学 E1）。
 */
import * as vscode from 'vscode';
import { resolveClaudeExecutable } from './claudeExecutable';

/** 入れかたの公式手順 */
const INSTALL_DOCS = 'https://docs.claude.com/en/docs/claude-code/setup';
/** 入れるためのコマンド。**送るだけで実行はしない**（走る前に読めるように・人間工学 E3） */
const INSTALL_COMMAND = 'npm install -g @anthropic-ai/claude-code';

/**
 * Claude Code の場所を選んでもらい、設定に書く。
 *
 * 書き先は**ユーザー設定**。実行ファイルの場所はマシンの話で、
 * リポジトリごとに変わるものではない（ワークスペースに書くと、
 * 別のフォルダを開いたときにまた迷う）。
 */
export async function locateClaude(): Promise<boolean> {
	const picked = await vscode.window.showOpenDialog({
		title: 'Claude Code の実行ファイルを選ぶ',
		openLabel: 'これを使う',
		canSelectMany: false,
		canSelectFiles: true,
		canSelectFolders: false
	});
	const target = picked?.[0];
	if (!target) {
		return false;
	}
	await vscode.workspace
		.getConfiguration('nimbus')
		.update('claudeCodeExecutable', target.fsPath, vscode.ConfigurationTarget.Global);

	// 選んだものが本当に使えるかを、その場で確かめて返す
	const resolved = resolveClaudeExecutable();
	if (resolved) {
		void vscode.window.showInformationMessage(`Nimbus: Claude Code を ${resolved} に設定しました。`);
		return true;
	}
	void vscode.window.showWarningMessage(
		'Nimbus: 選ばれたファイルを実行できませんでした。実行権のあるファイルを選んでください。'
	);
	return false;
}

/**
 * 入れかたを案内する。
 *
 * 手順を開くか、入れるコマンドをターミナルへ出すかを選べるようにする。
 * **コマンドは送るだけで走らせない** — 何が走るかを読んでから Enter を押せるほうがよい。
 */
export async function openClaudeInstall(): Promise<void> {
	const DOCS = '公式の手順を開く';
	const TERMINAL = 'ターミナルに入れるコマンドを出す（実行はしない）';
	const choice = await vscode.window.showQuickPick([DOCS, TERMINAL], {
		title: 'Claude Code の入れかた'
	});
	if (choice === DOCS) {
		await vscode.env.openExternal(vscode.Uri.parse(INSTALL_DOCS));
		return;
	}
	if (choice === TERMINAL) {
		const terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal('Nimbus');
		terminal.show(true);
		terminal.sendText(INSTALL_COMMAND, false);
	}
}
