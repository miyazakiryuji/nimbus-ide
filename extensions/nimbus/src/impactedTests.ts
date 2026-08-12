/**
 * 変更に関係するテストだけを走らせる（tasks.md T-180）。
 *
 * 全部回すのは遅いというより、**確認が習慣にならない**のが問題。関係するぶんだけなら
 * 数秒で終わるので、直すたびに回せる。関係の判定は言語サーバーの参照検索に任せる
 * （[lsp-tools](../../../nimbus/docs/specs/lsp-tools.md) の `file_graph` と同じ考え方）。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { displayPath } from './core/lsp';
import { describeImpacted, selectImpactedTests } from './core/impactedTests';

export interface ImpactedTestsDeps {
	log: (message: string) => void;
}

/** 1 ファイルあたりに参照を引くシンボルの数。深追いしても当たりは増えない */
const SYMBOL_PROBE_LIMIT = 15;

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

/** そのファイルを参照しているファイル（テストに限らず全部） */
async function dependentsOf(file: string): Promise<string[]> {
	const uri = vscode.Uri.file(file);
	let document: vscode.TextDocument;
	try {
		document = await vscode.workspace.openTextDocument(uri);
	} catch {
		return [];
	}
	const symbols =
		(await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
			'vscode.executeDocumentSymbolProvider',
			uri
		)) ?? [];
	const found = new Set<string>();
	for (const symbol of symbols.slice(0, SYMBOL_PROBE_LIMIT)) {
		const at = 'selectionRange' in symbol ? symbol.selectionRange.start : symbol.location.range.start;
		const references =
			(await vscode.commands.executeCommand<vscode.Location[]>(
				'vscode.executeReferenceProvider',
				document.uri,
				at
			)) ?? [];
		for (const reference of references) {
			if (reference.uri.fsPath !== file) {
				found.add(reference.uri.fsPath);
			}
		}
	}
	return [...found];
}

/**
 * 変更に関係するテストを選び、選んだものだけを走らせる。
 * 走らせる前に必ず一覧を見せる — 何が走るのか分からないまま実行させない。
 */
export async function runImpactedTests(deps: ImpactedTestsDeps): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showErrorMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}
	const root = folder.uri.fsPath;

	let changed: string[];
	try {
		const output = await git(root, ['diff', '--name-only', 'HEAD']);
		changed = output
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
			.map((relative) => vscode.Uri.joinPath(folder.uri, relative).fsPath);
	} catch (error) {
		deps.log(`[tests] 変更を取れませんでした: ${error instanceof Error ? error.message : String(error)}`);
		void vscode.window.showErrorMessage('Nimbus: git の変更一覧を取得できませんでした。');
		return;
	}
	if (changed.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: HEAD からの変更がありません。');
		return;
	}

	const cache = new Map<string, readonly string[]>();
	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: 'Nimbus: 関係するテストを探しています' },
		async () => {
			for (const file of changed) {
				cache.set(file, await dependentsOf(file));
			}
		}
	);

	const impacted = selectImpactedTests(changed, (file) => cache.get(file) ?? []);
	const summary = describeImpacted(impacted, (file) => displayPath([root], file));
	deps.log(`[tests] ${summary.split('\n')[0]}`);
	if (impacted.files.length === 0) {
		void vscode.window.showInformationMessage(`Nimbus: ${summary}`);
		return;
	}

	// 何が走るのかを見せてから走らせる。既定は全部にチェックが入った状態
	const picked = await vscode.window.showQuickPick(
		impacted.files.map((file) => ({ label: displayPath([root], file), file, picked: true })),
		{
			title: `Nimbus: 変更に関係するテスト ${impacted.files.length} 件`,
			placeHolder: '走らせるものを選ぶ',
			canPickMany: true
		}
	);
	if (!picked || picked.length === 0) {
		return;
	}

	for (const entry of picked) {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(entry.file));
		await vscode.window.showTextDocument(document, { preview: false });
		// ファイル単位で走らせる。テスト拡張が何であっても同じ入口で効く
		await vscode.commands.executeCommand('testing.runCurrentFile');
	}
	deps.log(`[tests] ${picked.length} 件のテストファイルを走らせました`);
}
