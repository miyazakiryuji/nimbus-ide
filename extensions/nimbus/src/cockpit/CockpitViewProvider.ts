/**
 * コックピット（Webview）。
 *
 * セッションのイベント列をそのまま流し込むだけの薄い表示層にしてある。
 * 状態を持つのは拡張ホスト側（SessionManager）で、Webview は再生成されうる前提。
 */
import * as vscode from 'vscode';
import type { NimbusEvent, SessionSummary } from '../events';
import type { ApprovalDecision, PendingApproval } from '../permissions';
import { renderWebviewPage } from '../webview/page';
import { extractAssumptions } from '../core/assumptions';
import { WebviewViewHost, type WebviewSurface } from '../webview/WebviewViewHost';

/** Webview → 拡張 */
export type InboundMessage =
	| { type: 'ready' }
	// images は貼り付け・ドロップで添えた画像のデータ URL（T-040）
	| { type: 'send'; text: string; images?: { name: string; dataUrl: string }[] }
	| { type: 'interrupt' }
	| { type: 'newSession' }
	/** 会話の中で承認に答える（T-266） */
	| { type: 'approve'; id: string; decision: ApprovalDecision };

/** 拡張 → Webview */
export type OutboundMessage =
	/** `assumptions` は本文から抜き出した「置かれた仮定」。本文とは別に目立たせて出す */
	| { type: 'event'; event: NimbusEvent; assumptions?: string[] }
	| { type: 'history'; events: NimbusEvent[]; session?: SessionSummary }
	| { type: 'session'; session?: SessionSummary }
	/** いま答えを待っている承認（T-266）。空配列で「もう無い」を表す */
	| { type: 'approvals'; pending: readonly PendingApproval[] };

export interface CockpitHandlers {
	/** @param images 貼り付け・ドロップで添えた画像（T-040）。省略時の振る舞いは従来どおり */
	onSend(text: string, images?: { name: string; dataUrl: string }[]): void | Promise<void>;
	onInterrupt(): void | Promise<void>;
	onNewSession(): void | Promise<void>;
	/** 会話の中で承認に答えたとき（T-266） */
	onApprove?(id: string, decision: ApprovalDecision): void;
	/** Webview が（再）生成されたときに現在の状態を復元するための材料 */
	snapshot(): { events: NimbusEvent[]; session?: SessionSummary };
	/** 診断用。Webview の生存を外から確認できるようにしておく */
	log(message: string): void;
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

export class CockpitViewProvider extends WebviewViewHost {
	public static readonly viewType = 'nimbus.cockpit';

	constructor(
		extensionUri: vscode.Uri,
		private readonly handlers: CockpitHandlers,
		private readonly options: CockpitOptions = DEFAULT_OPTIONS
	) {
		super(extensionUri);
	}

	protected onResolved(surface: WebviewSurface): void {
		this.handlers.log('[cockpit] Webview を生成しました');

		surface.webview.onDidReceiveMessage(async (message: InboundMessage) => {
			switch (message.type) {
				case 'ready': {
					const { events, session } = this.handlers.snapshot();
					this.handlers.log(`[cockpit] Webview から ready（復元イベント ${events.length} 件）`);
					this.post({ type: 'history', events, session });
					break;
				}
				case 'send':
					await this.handlers.onSend(message.text, message.images);
					break;
				case 'interrupt':
					await this.handlers.onInterrupt();
					break;
				case 'newSession':
					await this.handlers.onNewSession();
					break;
				case 'approve':
					this.handlers.onApprove?.(message.id, message.decision);
					break;
			}
		});
	}

	post(message: OutboundMessage): void {
		// エージェントが置いた仮定は、本文に紛れると読み飛ばされる。抜き出して別に渡す（T-186）
		if (message.type === 'event' && message.event.kind === 'assistant-text') {
			const assumptions = extractAssumptions(message.event.text);
			if (assumptions.length > 0) {
				this.postMessage({ ...message, assumptions });
				return;
			}
		}
		this.postMessage(message);
	}

	reveal(): void {
		void this.view?.show?.(true);
	}

	protected render(webview: vscode.Webview): string {
		return renderWebviewPage({
			webview,
			title: 'Nimbus',
			stylesheet: this.mediaUri(webview, 'cockpit.css'),
			script: this.mediaUri(webview, 'cockpit.js'),
			bodyAttributes: `data-assistant="${this.options.assistantLabel}"`,
			body: `	<header id="status" class="status">
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
	</footer>`
		});
	}
}
