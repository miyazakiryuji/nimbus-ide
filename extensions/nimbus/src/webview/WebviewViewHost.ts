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

/**
 * サイドバーのビューと、エディタタブのパネルに共通する部分（T-258）。
 * どちらも `webview` を持つだけなので、面の種類を意識せずに扱える。
 */
export interface WebviewSurface {
	readonly webview: vscode.Webview;
}

export abstract class WebviewViewHost implements vscode.WebviewViewProvider {
	protected view?: vscode.WebviewView;
	/** エディタタブとして開いた面（T-258）。開いていなければ undefined */
	private panel?: vscode.WebviewPanel;

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

	/**
	 * エディタタブで開く（T-258）。既に開いていれば前面に出すだけ。
	 *
	 * サイドバーの幅では狭い面（コックピット・タスク板）を、タブとして広く使えるようにする。
	 * **状態は二重に持たない** — 増えるのは `postMessage` の宛先だけで、
	 * 中身の持ち主は今までどおり拡張ホスト側。だから両方開いても片方だけ古くならない。
	 */
	openInEditor(viewType: string, title: string): void {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.Active);
			return;
		}
		const panel = vscode.window.createWebviewPanel(viewType, title, vscode.ViewColumn.Active, {
			enableScripts: true,
			// タブを切り替えるたびに作り直すと、打ちかけの文や表示位置が消える
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
		});
		panel.webview.html = this.render(panel.webview);
		this.panel = panel;
		this.onResolved(panel);
		panel.onDidDispose(() => {
			if (this.panel === panel) {
				this.panel = undefined;
			}
		});
	}

	/**
	 * 面が生きているか（サイドバーかタブのどちらかが作られている）。
	 * 承認をこの面で受け取ってよいかの判断に使う（T-266）— 面が無いのにカードを出すと、
	 * 誰も見られないところで待ち続けることになる。
	 */
	isLive(): boolean {
		return this.view !== undefined || this.panel !== undefined;
	}

	/** ビューの HTML。CSP の nonce は `createNonce()` を使う */
	protected abstract render(webview: vscode.Webview): string;

	/** メッセージの購読など、面ごとの準備。サイドバーからもタブからも呼ばれる */
	protected abstract onResolved(surface: WebviewSurface): void;

	/** 閉じているときは捨ててよい（再表示時に状態を送り直す作りにしてある） */
	protected postMessage(message: unknown): void {
		void this.view?.webview.postMessage(message);
		void this.panel?.webview.postMessage(message);
	}

	/** 同梱アセットの URI */
	protected mediaUri(webview: vscode.Webview, name: string): vscode.Uri {
		return webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name));
	}
}
