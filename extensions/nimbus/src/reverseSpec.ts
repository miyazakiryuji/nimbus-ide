/**
 * コードから仕様書を起こす（tasks.md T-080）。
 *
 * ドキュメントが無いコードは、読むたびに読み直すことになる。
 * かといって丸投げすると**それらしい嘘**が出るので、頼み方を固定する。
 *
 * 構造は言語サーバーのアウトラインを添える（[lsp-tools](../../../nimbus/docs/specs/lsp-tools.md)）。
 * 文面は `core/reverseSpec.ts`。
 */
import * as vscode from 'vscode';
import { displayPath, renderOutline, type OutlineSymbol } from './core/lsp';
import { buildReverseSpecPrompt, specPathFor } from './core/reverseSpec';
import { resolveWorkspaceRoot } from './workspaceRoots';

export interface ReverseSpecDeps {
	send: (text: string) => void;
	log: (message: string) => void;
}

function toOutline(symbol: vscode.DocumentSymbol | vscode.SymbolInformation): OutlineSymbol {
	if ('selectionRange' in symbol) {
		return {
			name: symbol.name,
			kind: symbol.kind,
			range: {
				start: { line: symbol.range.start.line, character: symbol.range.start.character },
				end: { line: symbol.range.end.line, character: symbol.range.end.character }
			},
			children: symbol.children?.map(toOutline)
		};
	}
	const range = symbol.location.range;
	return {
		name: symbol.name,
		kind: symbol.kind,
		range: {
			start: { line: range.start.line, character: range.start.character },
			end: { line: range.end.line, character: range.end.character }
		}
	};
}

/** 開いているファイルから仕様書を起こす（既にあれば直させる） */
export async function reverseSpec(deps: ReverseSpecDeps): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	const folder = editor ? resolveWorkspaceRoot(editor.document.uri) : undefined;
	if (!editor || !folder) {
		void vscode.window.showInformationMessage('Nimbus: 仕様を起こしたいファイルを開いてから実行してください。');
		return;
	}
	const root = folder.uri.fsPath;
	const file = displayPath([root], editor.document.uri.fsPath);
	const specPath = specPathFor(file);

	let exists = false;
	try {
		await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, ...specPath.split('/')));
		exists = true;
	} catch {
		// 無ければ新規
	}

	const symbols =
		(await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
			'vscode.executeDocumentSymbolProvider',
			editor.document.uri
		)) ?? [];
	const outline = renderOutline(symbols.map(toOutline));

	deps.log(`[spec] ${file} → ${specPath}${exists ? '（既存を更新）' : ''}`);
	const SEND = exists ? '仕様書を直させる' : '仕様書を起こさせる';
	const choice = await vscode.window.showInformationMessage(
		`Nimbus: ${file} の仕様を ${specPath} に${exists ? '反映' : '起こ'}します。`,
		SEND
	);
	if (choice === SEND) {
		deps.send(buildReverseSpecPrompt({ file, outline, specPath, exists }));
	}
}
