/**
 * 貼られたスタックトレースから該当箇所を開く（tasks.md T-105）。
 *
 * 選択範囲があればそれを、無ければクリップボードを見る。
 * 「ログをコピーして Nimbus に戻ってコマンドを打つ」だけで、直す場所に着地できるようにする。
 */
import { existsSync } from 'fs';
import { join } from 'path';
import * as vscode from 'vscode';
import { describeFrame, firstOwnFrame, parseStackTrace, resolvePackageUri, type StackFrame } from './core/stackTrace';

/** `package:` 表記を実ファイルに寄せる。開けるものだけ返す */
function locate(frame: StackFrame, root: string, packageName: string | undefined): string | undefined {
	const relative = resolvePackageUri(frame.file, packageName);
	if (relative) {
		const path = join(root, relative);
		return existsSync(path) ? path : undefined;
	}
	if (frame.file.startsWith('/')) {
		return existsSync(frame.file) ? frame.file : undefined;
	}
	const path = join(root, frame.file);
	return existsSync(path) ? path : undefined;
}

/** `pubspec.yaml` の name。Dart の `package:` を自分のものか判断するために読む */
async function pubspecName(root: string): Promise<string | undefined> {
	try {
		const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(join(root, 'pubspec.yaml')));
		return /^name:\s*(\S+)/m.exec(Buffer.from(bytes).toString('utf8'))?.[1];
	} catch {
		return undefined;
	}
}

async function open(path: string, frame: StackFrame): Promise<void> {
	const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
	const editor = await vscode.window.showTextDocument(document);
	const position = new vscode.Position(Math.max(0, frame.line - 1), Math.max(0, (frame.column ?? 1) - 1));
	editor.selection = new vscode.Selection(position, position);
	editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

export async function openFromStackTrace(): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}

	const editor = vscode.window.activeTextEditor;
	const selected = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '';
	const text = selected || (await vscode.env.clipboard.readText());
	const frames = parseStackTrace(text);
	if (frames.length === 0) {
		void vscode.window.showInformationMessage(
			'Nimbus: スタックトレースが見つかりません（選択するか、コピーしてから実行してください）。'
		);
		return;
	}

	const packageName = await pubspecName(root);
	const openable = frames.filter((frame) => locate(frame, root, packageName));
	if (openable.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 開けるファイルがトレースに含まれていません。');
		return;
	}

	// 直せるのはたいてい自分のコードの一番上。まずそこへ飛ぶ
	const first = firstOwnFrame(openable);
	if (first) {
		const path = locate(first, root, packageName);
		if (path) {
			await open(path, first);
		}
	}

	// 残りは選べるようにしておく（原因が 1 つ下にいることも多い）
	if (openable.length > 1) {
		const picked = await vscode.window.showQuickPick(
			openable.map((frame) => ({
				label: describeFrame(frame),
				description: frame.own ? '自分のコード' : 'ライブラリ',
				frame
			})),
			{ title: 'Nimbus: ほかの場所も見る', placeHolder: `${openable.length} 件のうちから選びます` }
		);
		const path = picked && locate(picked.frame, root, packageName);
		if (picked && path) {
			await open(path, picked.frame);
		}
	}
}
