/**
 * テストが本当に守っているかを確かめる（tasks.md T-182）。
 *
 * カバレッジは「実行されたか」しか言わない。実行されているのに何も確かめていない
 * テストは、100% でも通ってしまう。**わざと壊して落ちるか**を見るのが唯一の確かめ方。
 *
 * 候補出しと文面は `core/mutations.ts`。壊して走らせるのはセッション側の仕事。
 */
import * as vscode from 'vscode';
import { displayPath } from './core/lsp';
import { buildMutationPrompt, describeMutations, findMutations } from './core/mutations';

export interface MutationsDeps {
	send: (text: string) => void;
	log: (message: string) => void;
}

/** 開いているファイルから壊し方の候補を出し、確かめる手順ごと渡す */
export async function checkMutations(deps: MutationsDeps): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		void vscode.window.showInformationMessage('Nimbus: 確かめたいファイルを開いてから実行してください。');
		return;
	}
	const roots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
	const file = displayPath(roots, editor.document.uri.fsPath);
	const mutations = findMutations(editor.document.getText());
	const summary = describeMutations(file, mutations);
	deps.log(`[mutation] ${summary.split('\n')[0]}`);

	if (mutations.length === 0) {
		void vscode.window.showInformationMessage(`Nimbus: ${summary}`);
		return;
	}

	const SEND = '確かめさせる';
	const choice = await vscode.window.showInformationMessage(
		`Nimbus: ${summary.split('\n')[0]}`,
		{ detail: `${summary}\n\n1 つずつ入れてテストを走らせ、落ちなかったものを報告させます。`, modal: false },
		SEND
	);
	if (choice === SEND) {
		deps.send(buildMutationPrompt(file, mutations));
	}
}
