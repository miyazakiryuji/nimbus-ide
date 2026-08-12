/**
 * 「Claude がこれから何を書き換えるのか」を、承認する前に差分で見せる。
 *
 * 承認ダイアログにファイル名だけ出しても、実際に何が変わるかは分からない。
 * canUseTool は Promise が解決するまでツール実行を止められるので、その間に
 * VS Code 標準の差分エディタで中身を提示できる。これがフォークにした一番の見返り。
 *
 * 差分の右側は仮想ドキュメント（`nimbus-proposed:` スキーム）として提供する。
 * 実ファイルには一切書き込まない。
 */
import * as vscode from 'vscode';
import type { EditPreview } from './core/editPreview';

export { buildPreview } from './core/editPreview';
export type { EditPreview } from './core/editPreview';

export const PROPOSED_SCHEME = 'nimbus-proposed';

/** 差分の右側に出す内容を URI ごとに保持する。承認が終わったら捨てる */
class ProposedContentProvider implements vscode.TextDocumentContentProvider {
	private readonly contents = new Map<string, string>();
	private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange = this.emitter.event;

	set(uri: vscode.Uri, content: string): void {
		this.contents.set(uri.toString(), content);
		this.emitter.fire(uri);
	}

	delete(uri: vscode.Uri): void {
		this.contents.delete(uri.toString());
	}

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.contents.get(uri.toString()) ?? '';
	}

	dispose(): void {
		this.emitter.dispose();
		this.contents.clear();
	}
}

export class ProposedEditPreviewer {
	private readonly provider = new ProposedContentProvider();
	private readonly registration: vscode.Disposable;
	private counter = 0;

	constructor() {
		this.registration = vscode.workspace.registerTextDocumentContentProvider(PROPOSED_SCHEME, this.provider);
	}

	/**
	 * 差分エディタを開く。閉じるのは呼び出し側の責務（戻り値の dispose を呼ぶ）。
	 * プレビューは常に横に開き、利用者が今見ているエディタを置き換えない。
	 */
	async show(preview: EditPreview): Promise<vscode.Disposable> {
		const id = ++this.counter;
		const fileName = preview.filePath.split('/').pop() ?? preview.filePath;
		const rightUri = vscode.Uri.parse(`${PROPOSED_SCHEME}:/${id}/${fileName}`);
		this.provider.set(rightUri, preview.proposed);

		// 変更前が無い＝新規作成。左側も仮想の空ドキュメントにして「全部追加」に見せる
		const leftUri =
			preview.original === undefined
				? (() => {
					const empty = vscode.Uri.parse(`${PROPOSED_SCHEME}:/${id}/empty/${fileName}`);
					this.provider.set(empty, '');
					return empty;
				})()
				: vscode.Uri.file(preview.filePath);

		const title = preview.original === undefined
			? `Nimbus: ${fileName}（新規作成の提案）`
			: `Nimbus: ${fileName}（変更の提案）`;

		await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, {
			preview: true,
			preserveFocus: true,
			viewColumn: vscode.ViewColumn.Active
		});

		return new vscode.Disposable(() => {
			this.provider.delete(rightUri);
			this.provider.delete(vscode.Uri.parse(`${PROPOSED_SCHEME}:/${id}/empty/${fileName}`));
		});
	}

	dispose(): void {
		this.registration.dispose();
		this.provider.dispose();
	}
}
