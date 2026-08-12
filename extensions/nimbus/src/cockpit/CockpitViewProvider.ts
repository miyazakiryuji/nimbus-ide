/**
 * コックピット（Webview）。
 *
 * セッションのイベント列をそのまま流し込むだけの薄い表示層にしてある。
 * 状態を持つのは拡張ホスト側（SessionManager）で、Webview は再生成されうる前提。
 */
import * as vscode from 'vscode';
import type { NimbusEvent, SessionSummary } from '../events';

/** Webview → 拡張 */
export type InboundMessage =
	| { type: 'ready' }
	| { type: 'send'; text: string }
	| { type: 'interrupt' }
	| { type: 'newSession' };

/** 拡張 → Webview */
export type OutboundMessage =
	| { type: 'event'; event: NimbusEvent }
	| { type: 'history'; events: NimbusEvent[]; session?: SessionSummary }
	| { type: 'session'; session?: SessionSummary };

export interface CockpitHandlers {
	onSend(text: string): void | Promise<void>;
	onInterrupt(): void | Promise<void>;
	onNewSession(): void | Promise<void>;
	/** Webview が（再）生成されたときに現在の状態を復元するための材料 */
	snapshot(): { events: NimbusEvent[]; session?: SessionSummary };
	/** 診断用。Webview の生存を外から確認できるようにしておく */
	log(message: string): void;
}

function nonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}

/** 会話ビューの見た目まわり。コックピットとヘルプ（ゆあ）で同じ実装を使い回す */
export interface CockpitOptions {
	/** 発言者のラベル */
	assistantLabel: string;
	placeholder: string;
}

const DEFAULT_OPTIONS: CockpitOptions = {
	assistantLabel: 'Claude',
	placeholder: 'Claude に指示を書く（Enter で送信 / Shift+Enter で改行）'
};

export class CockpitViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'nimbus.cockpit';

	private view?: vscode.WebviewView;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly handlers: CockpitHandlers,
		private readonly options: CockpitOptions = DEFAULT_OPTIONS
	) { }

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
		};
		webviewView.webview.html = this.render(webviewView.webview);
		this.handlers.log('[cockpit] Webview を生成しました');

		webviewView.webview.onDidReceiveMessage(async (message: InboundMessage) => {
			switch (message.type) {
				case 'ready': {
					const { events, session } = this.handlers.snapshot();
					this.handlers.log(`[cockpit] Webview から ready（復元イベント ${events.length} 件）`);
					this.post({ type: 'history', events, session });
					break;
				}
				case 'send':
					await this.handlers.onSend(message.text);
					break;
				case 'interrupt':
					await this.handlers.onInterrupt();
					break;
				case 'newSession':
					await this.handlers.onNewSession();
					break;
			}
		});

		webviewView.onDidDispose(() => {
			if (this.view === webviewView) {
				this.view = undefined;
			}
		});
	}

	post(message: OutboundMessage): void {
		// Webview が閉じているときは捨ててよい（再表示時に history で復元する）
		void this.view?.webview.postMessage(message);
	}

	reveal(): void {
		void this.view?.show?.(true);
	}

	private render(webview: vscode.Webview): string {
		const media = (name: string): vscode.Uri =>
			webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name));
		const n = nonce();
		return /* html */ `<!DOCTYPE html>
<html lang="ja">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${n}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href="${media('cockpit.css')}" rel="stylesheet">
	<title>Nimbus</title>
</head>
<body data-assistant="${this.options.assistantLabel}">
	<header id="status" class="status">
		<span id="statusText">セッション未開始</span>
		<span id="statusMeta" class="meta"></span>
	</header>
	<main id="log" class="log" aria-live="polite"></main>
	<footer class="composer">
		<textarea id="input" rows="3" placeholder="${this.options.placeholder}"></textarea>
		<div class="actions">
			<button id="interrupt" class="secondary" disabled>中断</button>
			<button id="send">送信</button>
		</div>
	</footer>
	<script nonce="${n}" src="${media('cockpit.js')}"></script>
</body>
</html>`;
	}
}
