/**
 * コピーしたエラー文に気づいて「調べますか？」と聞く（tasks.md T-170）。
 *
 * **既定は無効。** クリップボードはパスワードも個人情報も通る場所なので、
 * 覗くこと自体を利用者が選べないといけない。
 *
 * 有効にしても、見るのは**ウィンドウに戻ってきた瞬間だけ**（常時監視はしない）。
 * 中身を画面に出すこともしない。
 */
import * as vscode from 'vscode';
import { buildClipboardPrompt, hintHeadline, looksLikeError } from './core/clipboardHints';

export interface ClipboardHintsDeps {
	send: (text: string) => void;
	log: (message: string) => void;
}

export class ClipboardHints implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	/** 同じ内容で二度聞かない */
	private lastSeen = '';
	private asking = false;

	constructor(private readonly deps: ClipboardHintsDeps) {
		this.disposables.push(
			vscode.window.onDidChangeWindowState((state) => {
				if (state.focused) {
					void this.check();
				}
			})
		);
	}

	dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables.length = 0;
	}

	private async check(): Promise<void> {
		if (this.asking || vscode.workspace.getConfiguration('nimbus').get<boolean>('clipboard.suggestOnError') !== true) {
			return;
		}
		let text: string;
		try {
			text = await vscode.env.clipboard.readText();
		} catch {
			return;
		}
		if (text === this.lastSeen || !looksLikeError(text)) {
			this.lastSeen = text;
			return;
		}
		this.lastSeen = text;

		this.asking = true;
		try {
			const ASK = '調べる';
			const NEVER = '今後は聞かない';
			// 中身は出さない。行数だけを見せる
			const choice = await vscode.window.showInformationMessage(`Nimbus: ${hintHeadline(text)}`, ASK, NEVER);
			if (choice === ASK) {
				this.deps.log('[clipboard] エラーらしい内容を投入しました');
				this.deps.send(buildClipboardPrompt(text));
			} else if (choice === NEVER) {
				await vscode.workspace
					.getConfiguration('nimbus')
					.update('clipboard.suggestOnError', false, vscode.ConfigurationTarget.Global);
				void vscode.window.showInformationMessage(
					'Nimbus: クリップボードを見ません（設定 nimbus.clipboard.suggestOnError で戻せます）。'
				);
			}
		} finally {
			this.asking = false;
		}
	}
}
