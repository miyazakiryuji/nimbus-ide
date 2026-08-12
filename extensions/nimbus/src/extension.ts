/**
 * Nimbus 拡張のエントリポイント。
 *
 * 役割は「Claude セッションの実行」と「その状態を IDE に見せること」の 2 つだけ。
 * エディタ・ファイルツリー・SCM・検索は Code - OSS のものをそのまま使う。
 */
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { NimbusEvent, SessionSummary } from './events';
import { SessionManager } from './session/SessionManager';
import { createPermissionBroker } from './permissions';
import { CockpitViewProvider } from './cockpit/CockpitViewProvider';
import { createSanitizer } from './sanitizer';
import { reportMissingExecutable, resolveClaudeExecutable } from './claudeExecutable';
import { ContextViewProvider } from './contextView';
import { ProposedEditPreviewer } from './proposedEdit';
import { billingModeLabel } from './billing';

/** 表示復元用に保持するイベント数の上限（長い会話でメモリを食い潰さないため） */
const MAX_RETAINED_EVENTS = 2000;

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('Nimbus', { log: true });
	const sanitizer = createSanitizer();
	// ログに API キーやホームパス（＝OS ユーザー名）を残さない
	const log = (message: string): void => output.appendLine(sanitizer.sanitizeString(message));

	const sessionAllowAll = new Set<string>();
	const previewer = new ProposedEditPreviewer();
	const contextView = new ContextViewProvider();
	let pendingApprovals = 0;

	const broker = createPermissionBroker({
		sessionAllowAll,
		log,
		previewer,
		onPendingChanged: (pending) => {
			pendingApprovals = pending.length;
			updateStatus(activeSessionId ? sessions.get(activeSessionId) : undefined);
		}
	});

	const sessions = new SessionManager(
		undefined,
		async () => buildOptions(),
		(sessionId) => broker.canUseToolFor(sessionId)
	);

	/** 現在前面で操作しているセッション。並列セッションは F4 で本格対応する */
	let activeSessionId: string | undefined;
	let lastApiKeySource: string | undefined;
	const retained: NimbusEvent[] = [];

	const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	status.command = 'nimbus.showLog';
	status.text = '$(cloud) Nimbus';
	status.tooltip = 'Nimbus — セッション未開始';
	status.show();

	const cockpit = new CockpitViewProvider(context.extensionUri, {
		onSend: (text) => void send(text),
		onInterrupt: () => void interrupt(),
		onNewSession: () => void newSession(),
		snapshot: () => ({
			events: retained,
			session: activeSessionId ? sessions.get(activeSessionId) : undefined
		}),
		log
	});

	sessions.on('event', (event: NimbusEvent) => {
		if (event.sessionId !== activeSessionId) {
			return;
		}
		retained.push(event);
		if (retained.length > MAX_RETAINED_EVENTS) {
			retained.splice(0, retained.length - MAX_RETAINED_EVENTS);
		}
		if (event.kind === 'session-init') {
			contextView.update(event);
			lastApiKeySource = event.apiKeySource;
		}
		cockpit.post({ type: 'event', event });
		updateStatus(sessions.get(event.sessionId));
		logEvent(event);
	});

	function logEvent(event: NimbusEvent): void {
		switch (event.kind) {
			case 'session-init':
				log(`[session] 開始 ${event.claudeSessionId} model=${event.model} cwd=${event.cwd} apiKeySource=${event.apiKeySource}`);
				break;
			case 'status':
				log(`[session] 状態=${event.status}`);
				break;
			case 'session-error':
				log(`[session] エラー: ${event.message}`);
				break;
			case 'turn-result':
				log(`[session] ターン終了 subtype=${event.subtype} turns=${event.numTurns} cost=${event.totalCostUsd ?? '-'}`);
				break;
		}
	}

	function updateStatus(summary: SessionSummary | undefined): void {
		// 承認待ちは最優先で見せる。ここで止まっていることに気づけないのが一番困る
		const waiting = pendingApprovals > 0 ? `$(shield) 承認待ち ${pendingApprovals} · ` : '';
		if (!summary) {
			status.text = `${waiting}$(cloud) Nimbus`;
			status.tooltip = 'Nimbus — セッション未開始';
			void vscode.commands.executeCommand('setContext', 'nimbus.hasRunningSession', false);
			return;
		}
		const busy = summary.status === 'running' || summary.status === 'starting';
		const cost = summary.totalCostUsd !== undefined ? ` · $${summary.totalCostUsd.toFixed(4)}` : '';
		status.text = `${waiting}${busy ? '$(sync~spin)' : '$(cloud)'} Nimbus${cost}`;
		status.tooltip = [
			`Nimbus — ${summary.status}`,
			billingModeLabel(lastApiKeySource),
			summary.model ?? '',
			summary.cwd
		].filter(Boolean).join('\n');
		void vscode.commands.executeCommand('setContext', 'nimbus.hasRunningSession', busy);
	}

	async function send(text: string): Promise<void> {
		try {
			if (activeSessionId && sessions.isActive(activeSessionId)) {
				sessions.sendMessage(activeSessionId, text);
				return;
			}
			const cwd = workspaceCwd();
			if (!cwd) {
				void vscode.window.showErrorMessage('Nimbus: フォルダを開いてからセッションを開始してください。');
				return;
			}
			if (!resolveClaudeExecutable()) {
				// SDK 内部の英語メッセージで詰まらせず、次の一手を示す
				log('[session] Claude Code の実行ファイルが見つかりません');
				await reportMissingExecutable();
				return;
			}
			// セッション ID を先に決めて active にしておく。createSession の実行中に出る
			// 最初の user-text / status イベントは、ID が未確定だと購読側で捨てられてしまう
			// （実測: 最初の発言がコックピットに表示されなかった）
			const sessionId = randomUUID();
			activeSessionId = sessionId;
			retained.length = 0;
			await sessions.createSession({ cwd, firstMessage: text, reuseSessionId: sessionId });
			log(`[session] 新規セッション ${sessionId} cwd=${cwd}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log(`[session] 送信に失敗: ${message}`);
			void vscode.window.showErrorMessage(`Nimbus: ${message}`);
		}
	}

	async function interrupt(): Promise<void> {
		if (!activeSessionId || !sessions.isActive(activeSessionId)) {
			return;
		}
		try {
			await sessions.interrupt(activeSessionId);
			log('[session] 中断を要求しました');
		} catch (error) {
			log(`[session] 中断に失敗: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async function newSession(): Promise<void> {
		if (activeSessionId && sessions.isActive(activeSessionId)) {
			sessions.close(activeSessionId);
		}
		activeSessionId = undefined;
		lastApiKeySource = undefined;
		retained.length = 0;
		contextView.update(undefined);
		updateStatus(undefined);
		cockpit.post({ type: 'history', events: [], session: undefined });
		cockpit.reveal();
	}

	context.subscriptions.push(
		output,
		status,
		previewer,
		vscode.window.registerTreeDataProvider('nimbus.context', contextView),
		vscode.window.registerWebviewViewProvider(CockpitViewProvider.viewType, cockpit, {
			webviewOptions: { retainContextWhenHidden: true }
		}),
		vscode.commands.registerCommand('nimbus.newSession', () => newSession()),
		vscode.commands.registerCommand('nimbus.interrupt', () => interrupt()),
		vscode.commands.registerCommand('nimbus.showLog', () => output.show(true)),
		new vscode.Disposable(() => sessions.closeAll())
	);

	log('[nimbus] 拡張を有効化しました');

	// 自動確認用。UI を人手で操作せずにコックピットまで到達できるようにしておく。
	// GUI をクリックできない環境（CI・自動検証）でも、拡張→セッション→イベントの
	// 経路を丸ごと通せるようにするための口で、環境変数が無ければ何もしない。
	if (process.env['NIMBUS_SMOKE']) {
		void vscode.commands.executeCommand('nimbus.cockpit.focus');
		const prompt = process.env['NIMBUS_SMOKE_PROMPT'];
		if (prompt) {
			void send(prompt);
		}
	}
}

export function deactivate(): void {
	// セッションの後始末は context.subscriptions の Disposable で行う
}

function workspaceCwd(): string | undefined {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) {
		return undefined;
	}
	// マルチルートは F4（並列タスク）で扱う。ここでは最初のフォルダを使う
	return folders[0].uri.fsPath;
}

/**
 * SDK に渡す追加オプション。
 * `settingSources: []` を明示して、利用者の ~/.claude 設定を暗黙に読み込ませない
 * （何が文脈に入るかを Nimbus 側で説明できる状態に保つため）。
 */
function buildOptions(): Partial<Options> {
	const options: Partial<Options> = { settingSources: [] };
	const executable = resolveClaudeExecutable();
	if (executable) {
		options.pathToClaudeCodeExecutable = executable;
	}
	return options;
}
