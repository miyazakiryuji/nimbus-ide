/**
 * 移行前後の等価性確認（tasks.md T-179）。
 *
 * 作り替える**前**に、いまの振る舞いを写したテストを書かせる。
 * 作業ツリーが既に書き換わっているときは `HEAD` の内容を渡す — 「前」を取り違えない。
 *
 * 文面は `core/equivalence.ts`。ここは VS Code と git の口だけ。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { displayPath } from './core/lsp';
import { resolveWorkspaceRoot } from './workspaceRoots';
import { isNotebookCell } from './core/notebooks';
import {
	buildCharacterizationPrompt,
	buildEquivalencePrompt,
	type BehaviorTarget
} from './core/equivalence';

export interface EquivalenceDeps {
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

/**
 * いま開いているファイル（選択範囲があればそこ）を対象にする。
 * 作業ツリーが `HEAD` と違えば、**`HEAD` の内容**を「移行前」として使う。
 */
async function currentTarget(): Promise<BehaviorTarget | undefined> {
	const editor = vscode.window.activeTextEditor;
	const folder = editor ? resolveWorkspaceRoot(editor.document.uri) : undefined;
	if (!editor || !folder) {
		return undefined;
	}
	const root = folder.uri.fsPath;
	const file = displayPath([root], editor.document.uri.fsPath);
	const selection = editor.selection;

	if (!selection.isEmpty) {
		return { file, code: editor.document.getText(selection), fromHead: false };
	}

	// 選択が無ければファイル全体。書き換わっていれば HEAD 側を取る
	let code = editor.document.getText();
	let fromHead = false;
	// セルは git の管理単位ではないので、HEAD との比較はしない（T-174）
	if (isNotebookCell(editor.document.uri.scheme)) {
		return { file, code, fromHead };
	}
	try {
		const head = await git(root, ['show', `HEAD:${file}`]);
		if (head.length > 0 && head !== code) {
			code = head;
			fromHead = true;
		}
	} catch {
		// git 管理外・新規ファイルは作業ツリーのまま扱う
	}
	return { file, code, fromHead };
}

/** 移行前: いまの振る舞いを固定するテストを書かせる */
export async function captureBehavior(deps: EquivalenceDeps): Promise<void> {
	const target = await currentTarget();
	if (!target) {
		void vscode.window.showInformationMessage('Nimbus: エディタでファイルを開いてから実行してください。');
		return;
	}
	deps.log(`[equivalence] 振る舞いを固定: ${target.file}${target.fromHead ? '（HEAD）' : ''}`);
	deps.send(buildCharacterizationPrompt(target));
}

/** 移行後: 落ちたテストを「変わった証拠」として仕分けさせる */
export async function verifyEquivalence(deps: EquivalenceDeps): Promise<void> {
	const target = await currentTarget();
	if (!target) {
		void vscode.window.showInformationMessage('Nimbus: エディタでファイルを開いてから実行してください。');
		return;
	}
	deps.log(`[equivalence] 等価性の確認: ${target.file}`);
	deps.send(buildEquivalencePrompt(target));
}
