/**
 * Nimbus 拡張のエントリポイント。
 *
 * 役割は「Claude セッションの実行」と「その状態を IDE に見せること」の 2 つだけ。
 * エディタ・ファイルツリー・SCM・検索は Code - OSS のものをそのまま使う。
 */
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { NimbusEvent, SessionSummary } from './events';
import { SessionManager } from './session/SessionManager';
import { createPermissionBroker } from './permissions';
import { CockpitViewProvider } from './cockpit/CockpitViewProvider';
import { createSanitizer } from './sanitizer';
import { assessClarity, formatClarification } from './core/clarify';
import { reportMissingExecutable, resolveClaudeExecutable } from './claudeExecutable';
import { ContextViewProvider } from './contextView';
import { ProposedEditPreviewer } from './proposedEdit';
import { billingModeLabel } from './billing';
import { WorktreeManager } from './core/worktree';
import { TaskService } from './tasks/TaskService';
import { BoardViewProvider } from './tasks/BoardViewProvider';
import { buildYuaSystemPrompt } from './help/yua';
import { discoverSkills, searchSkills, type Skill } from './core/skills';
import { SkillsViewProvider } from './skillsView';
import { addClaudeMdSection, ClaudeMdViewProvider } from './claudeMdView';
import { UsageViewProvider } from './usageView';
import { bar, costAlertLevel, formatCost } from './core/usage';
import { ActivityViewProvider } from './activityView';
import { McpViewProvider } from './mcpView';
import { canReconnect, type McpServer } from './core/mcp';
import { buildCheckpoints, checkpointLabel, describeRewind } from './core/checkpoints';
import { searchTranscripts } from './transcriptSearch';
import { openCompletionReport } from './completionReport';
import { buildNotifyCommand, oneLine } from './core/notify';
import { LSP_SERVER_NAME, lspMcpServer } from './lspTools';
import { TerminalWatcher } from './terminalWatcher';
import { TestWatcher } from './testWatcher';
import { ApprovalsViewProvider } from './approvalsView';
import type { ApprovalDecision, PendingApproval } from './permissions';

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
	const skillsView = new SkillsViewProvider();
	const claudeMdView = new ClaudeMdViewProvider();
	const usageView = new UsageViewProvider();
	const activityView = new ActivityViewProvider();
	const mcpView = new McpViewProvider();
	// 承認の横断キュー（T-010）。バッジを出すため registerTreeDataProvider ではなく createTreeView を使う
	const approvalsView = new ApprovalsViewProvider();
	const approvals = vscode.window.createTreeView('nimbus.approvals', { treeDataProvider: approvalsView });
	let pendingApprovals = 0;
	/** 文脈の消費率（T-020）。ステータスバーに出すため保持する */
	let contextPercent: number | undefined;
	/** コスト警告を出したセッション。同じ段階で何度も出さない（T-059） */
	const costAlerted = new Map<string, 'warn' | 'over'>();

	const broker = createPermissionBroker({
		sessionAllowAll,
		log,
		previewer,
		onPendingChanged: (pending) => {
			// 承認待ちで止まっていることに気づけないのが一番困る（T-019）
			if (pending.length > pendingApprovals) {
				const latest = pending[pending.length - 1];
				notify('Nimbus — 承認待ち', oneLine(latest.summary));
			}
			pendingApprovals = pending.length;
			// 承認待ちのセッションはカンバン上でも「承認待ち」に見せる
			tasks?.applyPendingApprovals(new Set(pending.map((p) => p.sessionId)));
			// 横断キュー（T-010）。並列で走らせると「誰が何で止まっているか」がここにしか出ない
			approvalsView.update(pending);
			approvals.badge = pending.length > 0
				? { value: pending.length, tooltip: `承認待ち ${pending.length} 件` }
				: undefined;
			updateStatus(activeSessionId ? sessions.get(activeSessionId) : undefined);
		},
		queueMode: () => isApprovalQueueMode(),
		alwaysAllowRules: () => vscode.workspace.getConfiguration('nimbus').get<string[]>('permissions.alwaysAllow') ?? [],
		onAlwaysAllow: (rule) => saveAlwaysAllowRule(rule)
	});

	const sessions = new SessionManager(
		undefined,
		async () => buildOptions(),
		(sessionId) => broker.canUseToolFor(sessionId)
	);

	const worktrees = new WorktreeManager();
	const tasks: TaskService = new TaskService(
		context.globalState,
		worktrees,
		sessions,
		() => vscode.workspace.getConfiguration('nimbus').get<number>('tasks.maxConcurrent') ?? 2,
		log
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

	// 緊急停止はコマンドパレットを開く余裕が無いときに押すものなので、
	// 動いている間だけステータスバーに出しておく（T-057）
	const stopButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
	stopButton.command = 'nimbus.stopAll';
	stopButton.text = '$(debug-stop) 停止';
	stopButton.tooltip = 'Nimbus — 動いているセッションをすべて止める';
	stopButton.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');

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
		if (event.sessionId === helpSessionId) {
			helpEvents.push(event);
			help.post({ type: 'event', event });
			return;
		}
		if (event.sessionId !== activeSessionId) {
			return;
		}
		retained.push(event);
		if (retained.length > MAX_RETAINED_EVENTS) {
			retained.splice(0, retained.length - MAX_RETAINED_EVENTS);
		}
		if (event.kind === 'session-init') {
			void refreshMcp();
			contextView.update(event);
			skillsView.setSessionSkills(event.skills);
			lastApiKeySource = event.apiKeySource;
		}
		cockpit.post({ type: 'event', event });
		activityView.update(retained);
		updateStatus(sessions.get(event.sessionId));
		logEvent(event);
		if (event.kind === 'turn-result') {
			notify('Nimbus — ターンが終わりました', oneLine(event.resultText ?? '応答が返りました'));
			// ターンが終わるたびに取り直す。走っている最中に見えないと意味がない（T-017 / T-020）
			void refreshUsage(event.sessionId);
			checkCostLimit(event.sessionId, sessions.get(event.sessionId)?.totalCostUsd);
		}
	});

	/**
	 * OS 通知（tasks.md T-019）。放置して他の作業に戻れることが体験の芯なので、
	 * ウィンドウを見ていなくても届く必要がある。VS Code の通知はウィンドウの中にしか出ない。
	 *
	 * 既定では**ウィンドウが前面に無いときだけ**出す。見ている画面に重ねて出しても邪魔なだけで、
	 * それを繰り返すと通知そのものを切られてしまう（T-087 の集中モードとも衝突しない形）。
	 */
	function notify(title: string, body: string): void {
		const config = vscode.workspace.getConfiguration('nimbus');
		if (config.get<boolean>('notifications.enabled') === false) {
			return;
		}
		if (config.get<boolean>('notifications.onlyWhenUnfocused') !== false && vscode.window.state.focused) {
			return;
		}
		const command = buildNotifyCommand(process.platform, title, body);
		if (!command) {
			// OS 通知を出せないプラットフォームではウィンドウ内に落とす（黙って消さない）
			void vscode.window.showInformationMessage(`${title} — ${body}`);
			return;
		}
		try {
			// シェルを通さない。タスク名に引用符が混ざっても壊れないようにするため
			const child = spawn(command.command, command.args, { stdio: 'ignore' });
			child.on('error', (error) => log(`[notify] 通知を出せませんでした: ${error.message}`));
			child.unref();
		} catch (error) {
			log(`[notify] 通知を出せませんでした: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * チェックポイントへの巻き戻し（tasks.md T-025）。
	 * CLI の Esc 2 回と違い、**戻す先を選んでから**、**何が変わるかを見てから**戻す。
	 */
	async function rewindToCheckpoint(): Promise<void> {
		if (!activeSessionId) {
			void vscode.window.showInformationMessage('Nimbus: セッションが開始されていません。');
			return;
		}
		const checkpoints = buildCheckpoints(retained);
		if (checkpoints.length === 0) {
			void vscode.window.showInformationMessage('Nimbus: 戻れる地点がまだありません。');
			return;
		}
		const chosen = await vscode.window.showQuickPick(
			checkpoints.map((checkpoint) => ({
				label: `${checkpoint.index}. ${checkpointLabel(checkpoint)}`,
				description: new Date(checkpoint.at).toLocaleTimeString('ja-JP'),
				checkpoint
			})),
			{ title: 'Nimbus: どこまで戻しますか', placeHolder: 'この指示を出す直前の状態に戻します' }
		);
		if (!chosen) {
			return;
		}
		// 先に空振りで何が変わるかを見る。見せずに戻すのは Esc 2 回と同じで、進歩が無い
		const preview = await sessions.rewind(activeSessionId, chosen.checkpoint.messageUuid, true);
		if (!preview || !preview.canRewind) {
			void vscode.window.showWarningMessage(`Nimbus: ${describeRewind(preview ?? { canRewind: false })}`);
			return;
		}
		const CONFIRM = '戻す';
		const answer = await vscode.window.showWarningMessage(
			`「${checkpointLabel(chosen.checkpoint)}」の直前まで戻します。`,
			{ modal: true, detail: describeRewind(preview) },
			CONFIRM
		);
		if (answer !== CONFIRM) {
			return;
		}
		const result = await sessions.rewind(activeSessionId, chosen.checkpoint.messageUuid, false);
		log(`[rewind] ${describeRewind(result ?? { canRewind: false })}`);
		void vscode.window.showInformationMessage(`Nimbus: 戻しました（${describeRewind(result ?? { canRewind: false })}）。`);
	}

	/** MCP サーバーの一覧を取り直す（T-029 / T-042） */
	async function refreshMcp(): Promise<void> {
		if (!activeSessionId) {
			mcpView.clear();
			return;
		}
		mcpView.update(await sessions.mcpServers(activeSessionId));
	}

	/** 繋ぎ直し・有効無効の切り替え。押して意味のある状態のときだけ効かせる */
	async function mcpAction(server: McpServer | undefined, action: 'reconnect' | 'toggle'): Promise<void> {
		if (!server || !activeSessionId) {
			return;
		}
		try {
			if (action === 'reconnect') {
				if (!canReconnect(server.status)) {
					void vscode.window.showInformationMessage(`Nimbus: ${server.name} は繋ぎ直せる状態ではありません。`);
					return;
				}
				await sessions.reconnectMcpServer(activeSessionId, server.name);
				log(`[mcp] ${server.name} を繋ぎ直しました`);
			} else {
				await sessions.toggleMcpServer(activeSessionId, server.name, server.status === 'disabled');
				log(`[mcp] ${server.name} を${server.status === 'disabled' ? '有効' : '無効'}にしました`);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log(`[mcp] 操作に失敗: ${message}`);
			void vscode.window.showErrorMessage(`Nimbus: ${message}`);
		}
		await refreshMcp();
	}

	/** 枠の消費と文脈の使用量を取り直してビューへ流す */
	async function refreshUsage(sessionId: string): Promise<void> {
		if (sessionId !== activeSessionId) {
			return;
		}
		const [usage, context] = await Promise.all([sessions.getUsage(sessionId), sessions.getContextUsage(sessionId)]);
		contextPercent = context && context.maxTokens > 0 ? (context.totalTokens / context.maxTokens) * 100 : undefined;
		usageView.update(usage, context);
		updateStatus(sessions.get(sessionId));
	}

	/**
	 * コスト上限アラート（T-059）。使いすぎてから請求で気づくのでは遅い。
	 * 段階ごとに一度だけ出す（毎ターン出すと読み飛ばされる）。
	 */
	function checkCostLimit(sessionId: string, costUsd: number | undefined): void {
		if (costUsd === undefined) {
			return;
		}
		const config = vscode.workspace.getConfiguration('nimbus');
		const limit = config.get<number>('usage.costLimitUsd') ?? 0;
		const level = costAlertLevel(costUsd, limit, config.get<number>('usage.warnAtPercent') ?? 80);
		if (level === 'none' || costAlerted.get(sessionId) === level) {
			return;
		}
		costAlerted.set(sessionId, level);
		if (level === 'warn') {
			void vscode.window.showWarningMessage(
				`Nimbus: このセッションの費用が ${formatCost(costUsd)} になりました（上限 ${formatCost(limit)}）。`
			);
			return;
		}
		const STOP = 'すべて停止';
		void vscode.window
			.showWarningMessage(
				`Nimbus: 費用が上限 ${formatCost(limit)} を超えました（現在 ${formatCost(costUsd)}）。`,
				STOP
			)
			.then((choice) => {
				if (choice === STOP) {
					void vscode.commands.executeCommand('nimbus.stopAll');
				}
			});
	}

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
		// 「止める」は動いているときだけ出す（押せる状態のときにだけ見えるほうが分かりやすい）
		const active = sessions.list().filter((s) => s.status === 'running' || s.status === 'starting');
		if (active.length > 0) {
			stopButton.text = active.length > 1 ? `$(debug-stop) 停止 ${active.length}` : '$(debug-stop) 停止';
			stopButton.show();
		} else {
			stopButton.hide();
		}
		if (!summary) {
			status.text = `${waiting}$(cloud) Nimbus`;
			status.tooltip = 'Nimbus — セッション未開始';
			void vscode.commands.executeCommand('setContext', 'nimbus.hasRunningSession', false);
			return;
		}
		const busy = summary.status === 'running' || summary.status === 'starting';
		const cost = summary.totalCostUsd !== undefined ? ` · $${summary.totalCostUsd.toFixed(4)}` : '';
		// 文脈をどれだけ使っているかは常に見えていてほしい（T-020）
		const context = contextPercent !== undefined ? ` · ${bar(contextPercent, 5)} ${Math.round(contextPercent)}%` : '';
		status.text = `${waiting}${busy ? '$(sync~spin)' : '$(cloud)'} Nimbus${context}${cost}`;
		status.tooltip = [
			`Nimbus — ${summary.status}`,
			billingModeLabel(lastApiKeySource),
			summary.model ?? '',
			contextPercent !== undefined ? `文脈 ${Math.round(contextPercent)}%（クリックでログ／使用量ビューに内訳）` : '',
			summary.cwd
		].filter(Boolean).join('\n');
		void vscode.commands.executeCommand('setContext', 'nimbus.hasRunningSession', busy);
	}

	/**
	 * 送信前検査（tasks.md T-075）。資格情報らしき文字列を見つけたら送る前に止める。
	 * サニタイザはログ・DB 向けに既にあるが、**送信は逆向き**（外に出る前）なので別経路で効かせる。
	 * @returns 実際に送る文字列。undefined なら送らない
	 */
	/**
	 * 曖昧な指示のまま走らせない（T-185）。
	 *
	 * 曖昧なまま走らせると、エージェントは自分で前提を埋めて動き出す。違っていたと分かるのは
	 * たいてい何十ファイルも書き換えたあと。だから走らせる前に、足りていないものを名指しで聞く。
	 * ただし**毎回聞かれる仕組みは無視されるようになる**ので、判定は保守的にしてある。
	 */
	async function confirmIfVague(text: string): Promise<boolean> {
		if (vscode.workspace.getConfiguration('nimbus').get<boolean>('dialogue.confirmVaguePrompt') === false) {
			return true;
		}
		// 会話が続いているなら前のやり取りに文脈がある
		const hasHistory = activeSessionId !== undefined && retained.length > 0;
		const assessment = assessClarity(text, hasHistory);
		if (assessment.level === 'ok') {
			return true;
		}
		const SEND = 'このまま送る';
		const EDIT = '書き直す';
		const choice = await vscode.window.showWarningMessage(
			'指示に足りていないものがあります。このまま走らせると、Claude が自分で前提を埋めます。',
			{ modal: true, detail: formatClarification(assessment) },
			SEND,
			EDIT
		);
		if (choice === SEND) {
			log(`[dialogue] 曖昧なまま送信（${assessment.issues.length} 件の指摘）`);
			return true;
		}
		// Esc で閉じた場合も undefined。答えなかったものを送信に倒さない
		log('[dialogue] 書き直しのため送信を取りやめました');
		return false;
	}

	async function checkBeforeSending(text: string): Promise<string | undefined> {
		if (!(await confirmIfVague(text))) {
			return undefined;
		}
		if (vscode.workspace.getConfiguration('nimbus').get<boolean>('safety.scanBeforeSend') === false) {
			return text;
		}
		const hits = sanitizer.detect(text);
		if (hits.length === 0) {
			return text;
		}
		const MASK = 'マスクして送信';
		const AS_IS = 'そのまま送信';
		const choice = await vscode.window.showWarningMessage(
			'送信しようとしている文に、資格情報らしき文字列が含まれています。',
			{
				modal: true,
				detail: `${hits.map((hit) => `・${hit.label}: ${hit.preview}`).join('\n')}\n\n「マスクして送信」を選ぶと、該当部分を伏せ字に置き換えてから送ります。`
			},
			MASK,
			AS_IS
		);
		if (choice === MASK) {
			log(`[safety] 送信前にマスクしました（${hits.length} 件）`);
			return sanitizer.maskSecrets(text);
		}
		if (choice === AS_IS) {
			log(`[safety] 検出あり・利用者の判断でそのまま送信（${hits.length} 件）`);
			return text;
		}
		// Esc で閉じた場合も undefined。答えなかったものを送信に倒さない
		log('[safety] 送信を取りやめました');
		return undefined;
	}

	async function send(rawText: string): Promise<void> {
		try {
			const text = await checkBeforeSending(rawText);
			if (text === undefined) {
				return;
			}
			// 停止済みのセッションへ送らない。緊急停止のあとは新しいセッションとして始める
			if (activeSessionId && sessions.isAccepting(activeSessionId)) {
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

	/**
	 * 承認をキューに積むモード（T-010）。既定は無効＝これまでどおりその場でモーダルを出す。
	 * 有効にすると、走っている全セッションの承認待ちが「承認待ち」ビューに集まり、順に片付けられる。
	 */
	function isApprovalQueueMode(): boolean {
		return vscode.workspace.getConfiguration('nimbus').get<boolean>('permissions.queueApprovals') === true;
	}

	/**
	 * 「今後この種類は常に許可」を設定へ保存する（T-038）。
	 *
	 * ルールはプロジェクトごとに違う（`Bash(npm test)` は、そのリポジトリでしか意味がない）ので、
	 * フォルダが開いていればワークスペース設定へ。開いていなければユーザー設定へ落とす。
	 * 押し間違いは取り返しがつくべきなので、保存したことを伝えたうえで「元に戻す」を添える。
	 */
	async function saveAlwaysAllowRule(rule: string): Promise<void> {
		const config = vscode.workspace.getConfiguration('nimbus');
		const current = config.get<string[]>('permissions.alwaysAllow') ?? [];
		if (current.includes(rule)) {
			return;
		}
		const target = vscode.workspace.workspaceFolders?.length
			? vscode.ConfigurationTarget.Workspace
			: vscode.ConfigurationTarget.Global;
		await config.update('permissions.alwaysAllow', [...current, rule], target);
		log(`[permission] ルールを保存しました: ${rule}`);
		const UNDO = '元に戻す';
		const where = target === vscode.ConfigurationTarget.Workspace ? 'このワークスペース' : 'ユーザー設定';
		const choice = await vscode.window.showInformationMessage(
			`Nimbus: 今後「${rule}」は確認せずに許可します（${where}）。`,
			UNDO
		);
		if (choice === UNDO) {
			const saved = config.get<string[]>('permissions.alwaysAllow') ?? [];
			await config.update('permissions.alwaysAllow', saved.filter((r) => r !== rule), target);
			log(`[permission] ルールを取り消しました: ${rule}`);
		}
	}

	/** キューの行から答える（T-010）。既に片付いていたら黙って何もしない */
	function decideApproval(entry: PendingApproval | undefined, decision: ApprovalDecision): void {
		const target = entry ?? approvalsView.list()[0];
		if (!target) {
			void vscode.window.showInformationMessage('Nimbus: 承認待ちはありません。');
			return;
		}
		broker.decide(target.id, decision);
	}

	/**
	 * 暴走の緊急停止（tasks.md T-057）。走っているセッションを全部止める。
	 * 「1 つずつ中断して回る」では間に合わないので、確認 1 回で全部に効かせる。
	 * 成果（worktree・未コミットの変更）には触らない — 止めることと捨てることは別。
	 */
	async function stopAll(): Promise<void> {
		const running = sessions.list().filter((s) => s.status === 'running' || s.status === 'starting');
		if (running.length === 0) {
			void vscode.window.showInformationMessage('Nimbus: 動いているセッションはありません。');
			return;
		}
		const CONFIRM = 'すべて停止';
		const choice = await vscode.window.showWarningMessage(
			`動いている ${running.length} 件のセッションをすべて止めます。`,
			{
				modal: true,
				detail: '待機中のタスクの自動開始も止めます（タスクの ▶ を押すと再開します）。worktree と未コミットの変更はそのまま残ります。'
			},
			CONFIRM
		);
		if (choice !== CONFIRM) {
			return;
		}
		tasks.pauseAutoStart();
		// 承認待ちも片付ける。答えを待っているものが残ると、止めたはずのセッションが
		// 「承認さえすれば動ける」状態でぶら下がり続ける（キューモードでは特に気づけない）
		const denied = broker.denyAll();
		const stopped = await sessions.stopAll();
		log(`[safety] 緊急停止: ${stopped} 件のセッションを止めました${denied > 0 ? `（承認待ち ${denied} 件も拒否）` : ''}`);
		updateStatus(activeSessionId ? sessions.get(activeSessionId) : undefined);
		void vscode.window.showInformationMessage(`Nimbus: ${stopped} 件のセッションを止めました。`);
	}

	async function newSession(): Promise<void> {
		if (activeSessionId && sessions.isActive(activeSessionId)) {
			sessions.close(activeSessionId);
		}
		activeSessionId = undefined;
		lastApiKeySource = undefined;
		retained.length = 0;
		contextView.update(undefined);
		skillsView.setSessionSkills([]);
		usageView.clear();
		activityView.update([]);
		mcpView.clear();
		contextPercent = undefined;
		updateStatus(undefined);
		cockpit.post({ type: 'history', events: [], session: undefined });
		cockpit.reveal();
	}

	// ヘルプ（ゆあ）。コックピットとは別セッションで、ツールを一切渡さない
	let helpSessionId: string | undefined;
	const helpEvents: NimbusEvent[] = [];
	const help = new CockpitViewProvider(
		context.extensionUri,
		{
			onSend: (text) => void askYua(text),
			onInterrupt: async () => {
				if (helpSessionId && sessions.isActive(helpSessionId)) {
					await sessions.interrupt(helpSessionId);
				}
			},
			onNewSession: async () => {
				if (helpSessionId && sessions.isActive(helpSessionId)) {
					sessions.close(helpSessionId);
				}
				helpSessionId = undefined;
				helpEvents.length = 0;
				help.post({ type: 'history', events: [], session: undefined });
			},
			snapshot: () => ({ events: helpEvents, session: undefined }),
			log
		},
		{ assistantLabel: 'ゆあ', placeholder: 'Nimbus の使い方を聞く（Enter で送信）' }
	);

	async function askYua(rawText: string): Promise<void> {
		try {
			const text = await checkBeforeSending(rawText);
			if (text === undefined) {
				return;
			}
			if (helpSessionId && sessions.isAccepting(helpSessionId)) {
				sessions.sendMessage(helpSessionId, text);
				return;
			}
			if (!resolveClaudeExecutable()) {
				await reportMissingExecutable();
				return;
			}
			const sessionId = randomUUID();
			helpSessionId = sessionId;
			helpEvents.length = 0;
			await sessions.createSession({
				cwd: workspaceCwd() ?? context.extensionUri.fsPath,
				firstMessage: text,
				reuseSessionId: sessionId,
				extraOptions: {
					// preset を使わず独自のシステムプロンプトにする（コーディング用の振る舞いを外す）
					systemPrompt: buildYuaSystemPrompt(),
					// ゆあにはツールを渡さない。使い方に答える以上のことをさせない
					allowedTools: [],
					settingSources: []
				}
			});
			log('[help] ゆあのセッションを開始しました');
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log(`[help] 送信に失敗: ${message}`);
			void vscode.window.showErrorMessage(`Nimbus: ${message}`);
		}
	}

	const board = new BoardViewProvider(context.extensionUri, {
		onNewTask: () => newTask(),
		onStart: async (taskId) => {
			const result = await tasks.startTask(taskId);
			if (!result.started && result.reason) {
				void vscode.window.showInformationMessage(`Nimbus: ${result.reason}`);
			}
		},
		onComplete: (taskId) => completeTask(taskId),
		onOpen: (taskId) => openTaskWorktree(taskId),
		onForget: (taskId) => tasks.forget(taskId),
		tasks: () => tasks.list(),
		log
	});
	tasks.on('changed', () => board.refresh());

	/** タスクを作る。タイトルと指示は 2 段階で聞く（後から編集できないので、ここは丁寧に） */
	async function newTask(): Promise<void> {
		const cwd = workspaceCwd();
		if (!cwd) {
			void vscode.window.showErrorMessage('Nimbus: フォルダを開いてからタスクを作成してください。');
			return;
		}
		const title = await vscode.window.showInputBox({
			title: 'Nimbus: 新しいタスク',
			prompt: 'タスク名（worktree のブランチ名にも使われます）',
			placeHolder: '例: ログイン画面のバリデーションを直す'
		});
		if (!title) {
			return;
		}
		const prompt = await vscode.window.showInputBox({
			title: 'Nimbus: 新しいタスク',
			prompt: 'Claude への最初の指示',
			placeHolder: '何をしてほしいかを書く'
		});
		if (!prompt) {
			return;
		}
		try {
			await tasks.createTask({ title, prompt, repoCwd: cwd, autoStart: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log(`[task] 作成に失敗: ${message}`);
			void vscode.window.showErrorMessage(`Nimbus: ${message}`);
		}
	}

	async function completeTask(taskId: string): Promise<void> {
		const task = tasks.get(taskId);
		if (!task) {
			return;
		}
		const CONFIRM = '完了にする';
		const choice = await vscode.window.showWarningMessage(
			`「${task.title}」を完了にします。worktree は削除しますが、未コミットの変更は ${task.branch} に自動でコミットして残します。`,
			{ modal: true },
			CONFIRM
		);
		if (choice !== CONFIRM) {
			return;
		}
		const { wipCommit } = await tasks.completeTask(taskId);
		void vscode.window.showInformationMessage(
			wipCommit
				? `Nimbus: 完了しました。未コミットの成果は ${task.branch} の ${wipCommit.slice(0, 8)} に保存しました。`
				: `Nimbus: 完了しました（${task.branch} は残っています）。`
		);
	}

	/** worktree は別ウィンドウで開く。並列タスクは「窓を分ける」のがいちばん分かりやすい */
	async function openTaskWorktree(taskId: string): Promise<void> {
		const task = tasks.get(taskId);
		if (!task) {
			return;
		}
		await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(task.worktreePath), {
			forceNewWindow: true
		});
	}

	/**
	 * 「こんなことをしてくれるスキル、ないかな？」に答える。
	 * 曖昧な言葉で聞けることが大事なので、名前だけでなく説明文にも当てる。
	 */
	async function findSkill(): Promise<void> {
		const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
		const skills = discoverSkills(roots);
		if (skills.length === 0) {
			void vscode.window.showInformationMessage(
				'Nimbus: スキルが見つかりませんでした（.claude/skills または ~/.claude/skills に置きます）。'
			);
			return;
		}

		const toItem = (skill: Skill): vscode.QuickPickItem & { skill: Skill } => ({
			label: skill.name,
			description: skill.origin,
			detail: skill.description,
			skill
		});

		const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { skill: Skill }>();
		picker.title = 'Nimbus: スキルを探す';
		picker.placeholder = 'したいことを書く（例: PDF、スクリーンショット、レビュー）';
		picker.matchOnDescription = true;
		picker.matchOnDetail = true;
		picker.items = skills.map(toItem);
		// 入力のたびに自前の採点で並べ替える（説明文への部分一致を効かせるため）
		picker.onDidChangeValue((value) => {
			picker.items = searchSkills(skills, value).map(toItem);
		});

		const chosen = await new Promise<Skill | undefined>((resolvePick) => {
			picker.onDidAccept(() => {
				resolvePick(picker.selectedItems[0]?.skill);
				picker.hide();
			});
			picker.onDidHide(() => resolvePick(undefined));
			picker.show();
		});
		picker.dispose();
		if (!chosen) {
			return;
		}

		const USE = 'コックピットで使う';
		const OPEN = 'SKILL.md を開く';
		const action = await vscode.window.showInformationMessage(
			`${chosen.name} — ${chosen.description || '（説明なし）'}`,
			USE,
			OPEN
		);
		if (action === OPEN) {
			await vscode.window.showTextDocument(vscode.Uri.file(chosen.path));
		} else if (action === USE) {
			cockpit.reveal();
			await send(`/${chosen.name}`);
		}
	}

	// ターミナルで落ちたコマンドを拾ってセッションへ渡す（T-169）。
	// 「出力を選んでコピーして貼る」を通知のボタン 1 つに畳む
	const terminals = new TerminalWatcher({
		send: (text) => {
			cockpit.reveal();
			void send(text);
		},
		log
	});

	// 落ちたテストを Test Explorer の結果から直接拾う（T-039）。
	// ターミナルの出力を読み解かせるより、名前・場所・メッセージが構造のまま渡る
	const testRuns = new TestWatcher({
		send: (text) => {
			cockpit.reveal();
			void send(text);
		},
		log
	});

	context.subscriptions.push(
		output,
		status,
		stopButton,
		previewer,
		terminals,
		approvals,
		approvalsView,
		// 承認の横断キュー（T-010）。行から直接答える。キューモードでないときは
		// モーダルが正の入口なので、ボタンは package.json 側の when で隠してある
		vscode.commands.registerCommand('nimbus.approvals.allow', (entry?: PendingApproval) =>
			decideApproval(entry, 'allow')
		),
		vscode.commands.registerCommand('nimbus.approvals.deny', (entry?: PendingApproval) =>
			decideApproval(entry, 'deny')
		),
		// 「今後この種類は常に許可」をルールとして残す（T-038）
		vscode.commands.registerCommand('nimbus.approvals.alwaysAllow', (entry?: PendingApproval) =>
			decideApproval(entry, 'always-allow')
		),
		// 待っているものを全部断る。「全部見ずに帰る」ときの出口
		vscode.commands.registerCommand('nimbus.approvals.denyAll', async () => {
			const waiting = approvalsView.list().length;
			if (waiting === 0) {
				void vscode.window.showInformationMessage('Nimbus: 承認待ちはありません。');
				return;
			}
			const CONFIRM = 'すべて拒否';
			const choice = await vscode.window.showWarningMessage(
				`承認待ちの ${waiting} 件をすべて拒否します。`,
				{ modal: true, detail: 'セッションは止まりません。拒否されたことを伝えて、そのまま続きを進めます。' },
				CONFIRM
			);
			if (choice === CONFIRM) {
				log(`[permission] まとめて拒否: ${broker.denyAll()} 件`);
			}
		}),
		vscode.window.registerTreeDataProvider('nimbus.context', contextView),
		vscode.window.registerTreeDataProvider('nimbus.skills', skillsView),
		vscode.window.registerTreeDataProvider('nimbus.claudeMd', claudeMdView),
		vscode.window.registerTreeDataProvider('nimbus.usage', usageView),
		vscode.window.registerTreeDataProvider('nimbus.activity', activityView),
		vscode.window.registerTreeDataProvider('nimbus.mcp', mcpView),
		// 過去セッションの横断検索（T-034）。読むのは Claude Code 本体の記録で、Nimbus は書かない
		vscode.commands.registerCommand('nimbus.searchTranscripts', () => searchTranscripts(log)),
		// 証跡つき完了報告（T-081）。「できました」だけの報告を無くす
		vscode.commands.registerCommand('nimbus.completionReport', () => openCompletionReport(retained)),
		vscode.commands.registerCommand('nimbus.rewind', () => rewindToCheckpoint()),
		vscode.commands.registerCommand('nimbus.refreshMcp', () => refreshMcp()),
		vscode.commands.registerCommand('nimbus.reconnectMcp', (node?: { server?: McpServer }) =>
			mcpAction(node?.server, 'reconnect')
		),
		vscode.commands.registerCommand('nimbus.toggleMcp', (node?: { server?: McpServer }) =>
			mcpAction(node?.server, 'toggle')
		),
		// 手動のコンパクション（T-022）。溜まってきたと感じた時点で自分で起こせるようにする。
		// SDK に専用の API は無く、CLI と同じく `/compact` を送るのが正規の経路
		vscode.commands.registerCommand('nimbus.compact', async () => {
			if (!activeSessionId || !sessions.isAccepting(activeSessionId)) {
				void vscode.window.showInformationMessage('Nimbus: 動いているセッションがありません。');
				return;
			}
			sessions.sendMessage(activeSessionId, '/compact');
			log('[session] 手動でコンパクションを要求しました');
		}),
		vscode.commands.registerCommand('nimbus.refreshUsage', async () => {
			if (!activeSessionId) {
				void vscode.window.showInformationMessage('Nimbus: セッションを開始すると使用量を取得できます。');
				return;
			}
			await refreshUsage(activeSessionId);
		}),
		vscode.window.registerWebviewViewProvider(BoardViewProvider.viewType, board, {
			webviewOptions: { retainContextWhenHidden: true }
		}),
		vscode.window.registerWebviewViewProvider('nimbus.help', help, {
			webviewOptions: { retainContextWhenHidden: true }
		}),
		vscode.commands.registerCommand('nimbus.newTask', () => newTask()),
		vscode.commands.registerCommand('nimbus.findSkill', () => findSkill()),
		vscode.commands.registerCommand('nimbus.refreshSkills', () => skillsView.refresh()),
		vscode.commands.registerCommand('nimbus.refreshClaudeMd', () => claudeMdView.refresh()),
		vscode.commands.registerCommand('nimbus.addClaudeMdSection', () => addClaudeMdSection(claudeMdView)),
		// 一覧から直接「使う」。コックピットへ /<name> を送る
		vscode.commands.registerCommand('nimbus.useSkill', async (node?: { skill?: { name?: string } }) => {
			const name = node?.skill?.name;
			if (!name) {
				return;
			}
			cockpit.reveal();
			await send(`/${name}`);
		}),
		// フォルダを開き直したら一覧も作り直す
		vscode.workspace.onDidChangeWorkspaceFolders(() => skillsView.refresh()),
		// キューモードの切り替えを行のボタンの出し分けに反映する（T-010）
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('nimbus.permissions.queueApprovals')) {
				void vscode.commands.executeCommand('setContext', 'nimbus.approvalQueueMode', isApprovalQueueMode());
			}
		}),
		vscode.commands.registerCommand('nimbus.askYua', async () => {
			await vscode.commands.executeCommand('nimbus.help.focus');
		}),
		vscode.window.registerWebviewViewProvider(CockpitViewProvider.viewType, cockpit, {
			webviewOptions: { retainContextWhenHidden: true }
		}),
		vscode.commands.registerCommand('nimbus.newSession', () => newSession()),
		vscode.commands.registerCommand('nimbus.interrupt', () => interrupt()),
		vscode.commands.registerCommand('nimbus.stopAll', () => stopAll()),
		vscode.commands.registerCommand('nimbus.showLog', () => output.show(true)),
		// 通知を閉じてしまっても、あとから同じものを投入できる（T-169 / T-039）
		vscode.commands.registerCommand('nimbus.sendLastTerminalFailure', () => {
			if (!terminals.sendLastFailure()) {
				void vscode.window.showInformationMessage('Nimbus: 直近に失敗したコマンドはありません。');
			}
		}),
		testRuns,
		vscode.commands.registerCommand('nimbus.sendLastTestFailure', () => {
			if (!testRuns.sendLastFailure()) {
				void vscode.window.showInformationMessage('Nimbus: 直近に失敗したテストはありません。');
			}
		}),
		new vscode.Disposable(() => sessions.closeAll())
	);

	void vscode.commands.executeCommand('setContext', 'nimbus.approvalQueueMode', isApprovalQueueMode());

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
	// LSP をツールとして渡す（T-098）。定義・参照・型を grep の総当たりより正確に引ける。
	// 拡張ホストの中で動く MCP サーバーなので、別プロセスは立たない
	if (vscode.workspace.getConfiguration('nimbus').get<boolean>('lsp.enabled') !== false) {
		options.mcpServers = { ...options.mcpServers, [LSP_SERVER_NAME]: lspMcpServer() };
	}
	return options;
}
