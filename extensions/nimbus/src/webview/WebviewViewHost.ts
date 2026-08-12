/**
 * Webview ビューの土台。
 *
 * コックピットとタスク板で、生成まわり（options の設定・HTML の流し込み・
 * 破棄時の後始末）がそっくり同じだった。同じ手順が 2 か所にあると、片方だけ直して
 * もう片方が腐る（ドクターの duplication 検査で実際に検出された）。
 *
 * ここに置くのは**どのビューでも同じ手順**だけ。表示内容とメッセージの扱いは各ビューが持つ。
 */
import * as vscode from 'vscode';

export abstract class WebviewViewHost implements vscode.WebviewViewProvider {
	protected view?: vscode.WebviewView;

	constructor(protected readonly extensionUri: vscode.Uri) { }

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			// 読み込ませるのは同梱した media/ だけ。任意のファイルを開かせない
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
		};
		webviewView.webview.html = this.render(webviewView.webview);
		this.onResolved(webviewView);

		webviewView.onDidDispose(() => {
			if (this.view === webviewView) {
				this.view = undefined;
			}
		});
	}

	/** ビューの HTML。CSP の nonce は `createNonce()` を使う */
	protected abstract render(webview: vscode.Webview): string;

	/** メッセージの購読など、ビュー固有の準備 */
	protected abstract onResolved(webviewView: vscode.WebviewView): void;

	/** 閉じているときは捨ててよい（再表示時に状態を送り直す作りにしてある） */
	protected postMessage(message: unknown): void {
		void this.view?.webview.postMessage(message);
	}

	/** 同梱アセットの URI */
	protected mediaUri(webview: vscode.Webview, name: string): vscode.Uri {
		return webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name));
	}
}
