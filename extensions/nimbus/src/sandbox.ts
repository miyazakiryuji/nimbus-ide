/**
 * 練習用サンドボックスを作る（tasks.md T-046 / T-213）。
 *
 * 置き場は利用者に選ばせる。**勝手にホームへ置かない** — 作った本人が
 * どこにあるか分からないフォルダは、消せないまま残る。
 */
import * as vscode from 'vscode';
import { buildSandboxFiles, sandboxFolderName } from './core/sandbox';

export async function createSandbox(): Promise<void> {
	const picked = await vscode.window.showOpenDialog({
		title: 'Nimbus: どこに練習用のフォルダを作りますか',
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		openLabel: 'ここに作る'
	});
	if (!picked?.[0]) {
		return;
	}

	const name = sandboxFolderName(new Date());
	const root = vscode.Uri.joinPath(picked[0], name);

	try {
		await vscode.workspace.fs.stat(root);
		void vscode.window.showWarningMessage(`Nimbus: ${name} は既にあります。中身を消してからもう一度実行してください。`);
		return;
	} catch {
		// 無いのが正しい
	}

	for (const file of buildSandboxFiles(name)) {
		const uri = vscode.Uri.joinPath(root, ...file.path.split('/'));
		await vscode.workspace.fs.writeFile(uri, Buffer.from(file.content, 'utf8'));
	}

	const open = '開く';
	const answer = await vscode.window.showInformationMessage(
		`Nimbus: ${name} を作りました。壊しても困らない場所なので、承認と差分をひととおり試せます。`,
		open
	);
	if (answer === open) {
		// 別ウィンドウで開く。いまの作業を閉じさせない
		await vscode.commands.executeCommand('vscode.openFolder', root, { forceNewWindow: true });
	}
}
