/**
 * エディタの選択範囲・関数から直接 Claude に頼む（tasks.md T-171 / T-172）。
 *
 * 右クリックで「Nimbus に頼む」、関数の上のコードレンズからも同じ入口。
 * ファイル名も行番号も打ち直さない — IDE がすでに知っていることを人に入力させない。
 *
 * 文面は `core/editorActions.ts` に置き、ここは VS Code の口だけを持つ。
 */
import * as vscode from 'vscode';
import { displayPath } from './core/lsp';
import {
	buildSelectionPrompt,
	intentChoices,
	shouldShowLens,
	type EditorIntent,
	type SelectionContext
} from './core/editorActions';

export interface EditorActionsDeps {
	send: (text: string) => void;
}

/** コードレンズから渡ってくる引数 */
interface LensArgs {
	uri: string;
	startLine: number;
	endLine: number;
	symbol?: string;
}

function roots(): string[] {
	return (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
}

/**
 * 「Nimbus に頼む」。選択範囲があればそれ、無ければコードレンズが指す範囲を使う。
 * どちらも無ければカーソル行だけを渡す（何も選ばずに押されても黙って落ちない）。
 */
export async function askAboutSelection(deps: EditorActionsDeps, args?: LensArgs): Promise<void> {
	const context = args ? await contextFromLens(args) : contextFromEditor();
	if (!context) {
		void vscode.window.showInformationMessage('Nimbus: エディタでコードを開いてから実行してください。');
		return;
	}

	const picked = await vscode.window.showQuickPick(
		intentChoices().map((choice) => ({ label: choice.label, detail: choice.detail, intent: choice.intent })),
		{ title: `Nimbus に頼む — ${context.symbol ?? context.file}`, placeHolder: '何を頼みますか' }
	);
	if (!picked) {
		return;
	}

	let freeText: string | undefined;
	if (picked.intent === 'ask') {
		freeText = await vscode.window.showInputBox({
			title: 'Nimbus に頼む',
			prompt: 'この場所について何を頼みますか',
			placeHolder: '例: ここだけ非同期にして'
		});
		if (!freeText) {
			return;
		}
	}
	deps.send(buildSelectionPrompt(context, picked.intent as EditorIntent, freeText));
}

function contextFromEditor(): SelectionContext | undefined {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return undefined;
	}
	const selection = editor.selection;
	const range = selection.isEmpty
		? editor.document.lineAt(selection.active.line).range
		: new vscode.Range(selection.start, selection.end);
	return {
		file: displayPath(roots(), editor.document.uri.fsPath),
		startLine: range.start.line + 1,
		endLine: range.end.line + 1,
		code: editor.document.getText(range)
	};
}

async function contextFromLens(args: LensArgs): Promise<SelectionContext | undefined> {
	try {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(args.uri));
		const range = new vscode.Range(args.startLine, 0, args.endLine, Number.MAX_SAFE_INTEGER);
		return {
			file: displayPath(roots(), document.uri.fsPath),
			startLine: args.startLine + 1,
			endLine: args.endLine + 1,
			code: document.getText(range),
			symbol: args.symbol
		};
	} catch {
		return undefined;
	}
}

/**
 * 関数・クラスの上に「Nimbus に頼む」を出す（T-172）。
 * 種類を絞って、変数や import の上には出さない（レンズが多すぎると誰も読まなくなる）。
 */
export class NimbusCodeLensProvider implements vscode.CodeLensProvider {
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this.emitter.event;

	/** 設定が変わったら出し直す */
	refresh(): void {
		this.emitter.fire();
	}

	async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
		if (vscode.workspace.getConfiguration('nimbus').get<boolean>('editor.codeLens') === false) {
			return [];
		}
		const symbols = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
			'vscode.executeDocumentSymbolProvider',
			document.uri
		);
		const lenses: vscode.CodeLens[] = [];
		const walk = (nodes: readonly (vscode.DocumentSymbol | vscode.SymbolInformation)[]): void => {
			for (const node of nodes) {
				const range = 'selectionRange' in node ? node.range : node.location.range;
				if (shouldShowLens(node.kind)) {
					lenses.push(
						new vscode.CodeLens(new vscode.Range(range.start, range.start), {
							title: '$(cloud) Nimbus に頼む',
							command: 'nimbus.askAboutSelection',
							arguments: [
								{
									uri: document.uri.toString(),
									startLine: range.start.line,
									endLine: range.end.line,
									symbol: node.name
								} satisfies LensArgs
							]
						})
					);
				}
				if ('children' in node && node.children?.length) {
					walk(node.children);
				}
			}
		};
		walk(symbols ?? []);
		return lenses;
	}
}
