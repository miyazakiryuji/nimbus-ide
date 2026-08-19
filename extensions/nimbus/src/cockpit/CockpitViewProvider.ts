/**
 * コックピット（Webview）。
 *
 * セッションのイベント列をそのまま流し込むだけの薄い表示層にしてある。
 * 状態を持つのは拡張ホスト側（SessionManager）で、Webview は再生成されうる前提。
 */
import * as vscode from 'vscode';
import type { NimbusEvent, SessionSummary } from '../events';
import type { ApprovalDecision, PendingApproval } from '../permissions';
import type { SessionTab } from '../core/sessionTabs';
import { renderWebviewPage } from '../webview/page';
import { extractAssumptions } from '../core/assumptions';
import { parseMarkdown, type Block } from '../core/chatMarkdown';
import { runCodeAction } from './codeActions';
import { isAllowedAction, type ReadyCheck } from '../core/readiness';
import { WebviewViewHost, type WebviewSurface } from '../webview/WebviewViewHost';

/** Webview → 拡張 */
export type InboundMessage =
	| { type: 'ready' }
	// images は貼り付け・ドロップで添えた画像のデータ URL（T-040）
	| { type: 'send'; text: string; images?: { name: string; dataUrl: string }[] }
	| { type: 'interrupt' }
	| { type: 'newSession' }
	/** 会話の中で承認に答える（T-266） */
	| { type: 'approve'; id: string; decision: ApprovalDecision }
	/** コードブロックの操作（T-271）。VS Code のチャットと同じ 4 つ */
	| { type: 'code'; action: 'copy' | 'insert' | 'newFile' | 'terminal'; text: string; language: string }
	/** 応答をそのまま写す（T-271） */
	| { type: 'copyText'; text: string }
	/** 画像を添える（T-271）。webview からはダイアログを開けないので拡張側に頼む */
	| { type: 'attach' }
	/** タブを押してセッションを切り替える（T-269） */
	| { type: 'switchSession'; sessionId: string }
	/**
	 * 「準備」のボタン（T-285）。**許したコマンドしか走らせない** —
	 * 画面のボタンが任意のコマンドを呼べる状態にはしない。
	 */
	| { type: 'run'; command: string };

/** 拡張 → Webview */
export type OutboundMessage =
	/**
	 * `assumptions` は本文から抜き出した「置かれた仮定」。本文とは別に目立たせて出す。
	 * `blocks` は応答を描くための塊（T-271）。**webview では解析しない** —
	 * 文字列を組み立てて `innerHTML` に入れる余地を最初から作らないため。
	 */
	| { type: 'event'; event: NimbusEvent; assumptions?: string[]; blocks?: Block[] }
	| { type: 'history'; events: NimbusEvent[]; session?: SessionSummary }
	| { type: 'session'; session?: SessionSummary }
	/**
	 * いま答えを待っている承認（T-266）。空配列で「もう無い」を表す。
	 * `activeSessionId` は「どのセッションの話か」をカードに出すため —
	 * 並列で走らせていると、どれについて聞かれているのかが分からないと決められない。
	 */
	| { type: 'approvals'; pending: readonly PendingApproval[]; activeSessionId?: string }
	/**
	 * セッションのタブ（T-269）。**並びは始めた順で固定**し、状態は色と記号の両方で出す。
	 * 色だけだと、色覚の違いとモノクロのスクリーンショットで潰れる。
	 */
	| { type: 'sessions'; tabs: readonly SessionTab[] }
	/**
	 * 枠の残り（T-282）。入力欄の下に 1 行だけ出す。
	 * `text` が無いときは「出すものが無い」— 行ごと消す（空欄を置かない）。
	 * `tooltip` は 1 行に入りきらない中身（いつ戻るか）。
	 */
	| { type: 'quota'; text?: string; tooltip?: string }
	/**
	 * `/` で引ける定型（T-271）。VS Code のチャットのスラッシュコマンドと同じ位置づけで、
	 * 中身は Nimbus が既に持っている「指示のテンプレート」を出す。
	 */
	| { type: 'commands'; items: readonly SlashCommand[] }
	/** 選ばれた画像。webview 側の添付欄へ足す（T-271） */
	| { type: 'attachments'; items: readonly { name: string; dataUrl: string }[] }
	/**
	 * 使い始めの「準備」（T-285）。足りないものを、詰まる場所に出すための材料。
	 * 揃っていても送るので、`checks` は常に渡す（画面側が出し分ける）。
	 */
	| { type: 'readiness'; checks: readonly ReadyCheck[] };

/** `/` で引ける定型 1 つ */
export interface SlashCommand {
	name: string;
	detail: string;
	/** 選んだときに入力欄へ入る本文 */
	text: string;
}

export interface CockpitHandlers {
	/** @param images 貼り付け・ドロップで添えた画像（T-040）。省略時の振る舞いは従来どおり */
	onSend(text: string, images?: { name: string; dataUrl: string }[]): void | Promise<void>;
	onInterrupt(): void | Promise<void>;
	onNewSession(): void | Promise<void>;
	/** 会話の中で承認に答えたとき（T-266） */
	onApprove?(id: string, decision: ApprovalDecision): void;
	/** タブでセッションを切り替えたとき（T-269） */
	onSwitchSession?(sessionId: string): void;
	/**
	 * Webview が（再）生成されたときに現在の状態を復元するための材料。
	 * **答え待ちの承認も含める**（T-266）— 面を畳んで開き直したときにカードが消えると、
	 * セッションは待ったままなのに答える場所が無くなる
	 */
	snapshot(): {
		events: NimbusEvent[];
		session?: SessionSummary;
		approvals?: readonly PendingApproval[];
		/** セッションのタブ（T-269）。面を作り直したときに列ごと戻す */
		tabs?: readonly SessionTab[];
		/** 枠の残りの 1 行（T-282）。`tooltip` は指を置いたときに出す中身 */
		quota?: { text: string; tooltip?: string };
	};
	/** `/` で引ける定型（T-271）。無ければ候補を出さない */
	slashCommands?(): readonly SlashCommand[];
	/** 使い始めの「準備」（T-285）。足りないものを画面に出すために引く */
	readiness?(): readonly ReadyCheck[];
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

/** 拡張子から MIME を引く。データ URL に載せる形にするために要る */
const IMAGE_MIME: Readonly<Record<string, string>> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp'
};

/**
 * 画像を選んでもらい、データ URL にして返す（T-271）。
 *
 * webview からはファイルダイアログを開けないので、ここで開く。
 * 貼り付け・ドロップだけだと、**手元にファイルがある場合に経路が無い**。
 */
async function pickImages(): Promise<{ name: string; dataUrl: string }[]> {
	const picked = await vscode.window.showOpenDialog({
		canSelectMany: true,
		openLabel: '添える',
		filters: { 画像: Object.keys(IMAGE_MIME) }
	});
	if (!picked) {
		return [];
	}
	const items: { name: string; dataUrl: string }[] = [];
	for (const uri of picked) {
		const name = uri.path.split('/').pop() ?? 'image';
		const mime = IMAGE_MIME[name.split('.').pop()?.toLowerCase() ?? ''];
		if (!mime) {
			continue;
		}
		const bytes = await vscode.workspace.fs.readFile(uri);
		items.push({ name, dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` });
	}
	return items;
}

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
					const { events, session, approvals, tabs, quota } = this.handlers.snapshot();
					this.handlers.log(`[cockpit] Webview から ready（復元イベント ${events.length} 件）`);
					this.post({ type: 'history', events, session });
					if (approvals && approvals.length > 0) {
						this.post({ type: 'approvals', pending: approvals });
					}
					if (tabs && tabs.length > 0) {
						this.post({ type: 'sessions', tabs });
					}
					if (quota) {
						this.post({ type: 'quota', text: quota.text, tooltip: quota.tooltip });
					}
					const items = this.handlers.slashCommands?.() ?? [];
					if (items.length > 0) {
						this.post({ type: 'commands', items });
					}
					// 使い始めで迷わせないよう、開いた時点で足りないものを出す（T-285）
					const checks = this.handlers.readiness?.();
					if (checks) {
						this.post({ type: 'readiness', checks });
					}
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
				case 'switchSession':
					this.handlers.onSwitchSession?.(message.sessionId);
					break;
				case 'code':
					await runCodeAction(message.action, message.text, message.language, (text) =>
						this.handlers.log(`[cockpit] ${text}`)
					);
					break;
				case 'copyText':
					await vscode.env.clipboard.writeText(message.text);
					break;
				case 'run':
					// 許していないコマンドは黙って捨てる（画面から任意のコマンドを呼ばせない）
					if (isAllowedAction(message.command)) {
						await vscode.commands.executeCommand(message.command);
					} else {
						this.handlers.log(`[cockpit] 許可していないコマンドを弾きました: ${message.command}`);
					}
					break;
				case 'attach': {
					const items = await pickImages();
					if (items.length > 0) {
						this.post({ type: 'attachments', items });
					}
					break;
				}
			}
		});
	}

	post(message: OutboundMessage): void {
		if (message.type === 'event' && message.event.kind === 'assistant-text') {
			// 応答は Markdown で返ってくる。描くための塊にしてから渡す（T-271）
			const blocks = parseMarkdown(message.event.text);
			// エージェントが置いた仮定は、本文に紛れると読み飛ばされる。抜き出して別に渡す（T-186）
			const assumptions = extractAssumptions(message.event.text);
			this.postMessage({
				...message,
				blocks,
				...(assumptions.length > 0 ? { assumptions } : {})
			});
			return;
		}
		this.postMessage(message);
	}

	/**
	 * コックピットを前に出す。**面がまだ無ければ、作らせるところからやる**（T-286）。
	 *
	 * `view.show()` は**既に生成された面**しか動かせない。別のアクティビティバー
	 * （タスク／設定／デバッグ）を見ているとコックピットの面は生成されていないので、
	 * ここが黙って何もしないまま `isLive()` も false になり、
	 * 承認が会話のカードではなくモーダルへ落ちていた（＝「いちいち POP が出る」の正体）。
	 *
	 * `focus` コマンドはコンテナごと開いて面を作るので、そこまで面倒を見る。
	 * 呼び終わったときに面が立っていることを、呼び手が待てるように Promise を返す。
	 */
	async reveal(): Promise<void> {
		if (this.isLive()) {
			this.view?.show?.(true);
			return;
		}
		await vscode.commands.executeCommand('nimbus.cockpit.focus');
	}

	protected render(webview: vscode.Webview): string {
		return renderWebviewPage({
			webview,
			title: 'Nimbus',
			stylesheet: this.mediaUri(webview, 'cockpit.css'),
			script: this.mediaUri(webview, 'cockpit.js'),
			bodyAttributes: `data-assistant="${this.options.assistantLabel}"`,
			// VS Code のチャットと同じ作り（T-271）— 会話の列と、丸めた 1 枚の入力欄。
			// 状態は上の帯ではなく**入力欄の中**に置く。送るときに目が要る情報なので、
			// 送信ボタンと同じ視野に入っているほうがよい（人間工学 E2 / E3）
			body: `	<nav id="sessionTabs" class="session-tabs" hidden></nav>
	<main id="log" class="chat-list" aria-live="polite"></main>
	<div class="chat-input-area">
		<div id="approvals" class="approvals" hidden></div>
		<div id="quota" class="chat-quota" hidden></div>
		<div id="composer" class="chat-input-container">
			<div id="attachments" class="chat-attachments" hidden></div>
			<textarea id="input" rows="1" placeholder="${this.options.placeholder}"></textarea>
			<div class="chat-input-toolbars">
				<div class="chat-input-status">
					<span id="statusText">セッション未開始</span>
					<span id="statusMeta" class="meta"></span>
				</div>
				<div class="chat-input-actions">
					<button id="attach" class="icon-button" type="button" title="画像を添える"></button>
					<button id="interrupt" class="icon-button stop" type="button" title="中断" hidden></button>
					<button id="send" class="icon-button send" type="button" title="送信（Enter）"></button>
				</div>
			</div>
		</div>
	</div>`
		});
	}
}
