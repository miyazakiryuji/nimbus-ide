/**
 * Nimbus 拡張のエントリポイント。
 *
 * 役割は「Claude セッションの実行」と「その状態を IDE に見せること」の 2 つだけ。
 * エディタ・ファイルツリー・SCM・検索は Code - OSS のものをそのまま使う。
 */
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { homedir } from 'os';
import * as vscode from 'vscode';
import { pickWorkspaceRoot, resolveWorkspaceRoot } from './workspaceRoots';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { NimbusEvent, SessionInitEvent, SessionSummary } from './events';
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
import { addClaudeMdSection, ClaudeMdViewProvider, promoteInstruction } from './claudeMdView';
import { editProtectedPaths } from './protectedPaths';
import { openDigest } from './digest';
import { explainLockDiff } from './lockDiff';
import { openFromStackTrace } from './stackTrace';
import { draftReleaseNotes } from './releaseNotes';
import { openChangeStats } from './changeStats';
import { openCodeHealth } from './codeHealth';
import { openBranchHealth } from './branchHealth';
import { draftPrDescription } from './prDescription';
import { bisect } from './bisect';
import { openMobileChecks } from './mobileChecks';
import { openFlutterLint } from './flutterLint';
import { measureBuild } from './buildMetrics';
import { resolveXcodeConflict } from './pbxprojConflict';
import { openDepConsistency } from './depConsistency';
import { openReviewProgress } from './reviewProgress';
import { openRhythm } from './rhythm';
import { openPlatformChannels } from './platformChannel';
import { generateFromSchema } from './openapi';
import { checkApiResponse, generateMockResponse } from './apiCheck';
import { createSandbox } from './sandbox';
import { scheduleRun, showSchedule, watchSchedule } from './schedule';
import { openPromptStats } from './promptStats';
import { openLicenses } from './licenses';
import { openHighlights } from './highlights';
import { draftReviewRequest } from './reviewRequest';
import { openExplanation } from './explain';
import { importReviewComments } from './reviewComments';
import { shareSession } from './shareSession';
import { openReplay } from './replay';
import { checkMermaidDiagrams } from './mermaid';
import { runSetupWizard } from './setupWizard';
import { openEnvCheck } from './envCheck';
import { auditDependency } from './depAudit';
import { openVulnFixPlan } from './vulnFix';
import { checkSql } from './sqlSafety';
import { openCiRepro } from './ciRepro';
import { openMigrationPlan } from './schemaDiff';
import { openPreflight } from './preflight';
import { generateWidgetTest } from './flutterTests';
import { proposeCommitSplit } from './commitSplit';
import { assistConflicts } from './conflicts';
import { showDiffSummary } from './diffSummary';
import { showImpact } from './impact';
import { editPermissionRules } from './permissionRules';
import { importPrReview } from './prReview';
import { findFlakyTests } from './flaky';
import { regenerateNow, watchForRegeneration } from './regenerate';
import { compareBenchmarks } from './benchmark';
import { reproduceFromLog } from './reproTest';
import { importMonitoredIssue } from './errorMonitor';
import { ReviewViewProvider } from './reviewView';
import type { ReviewEntry } from './core/reviewState';
import { UsageViewProvider } from './usageView';
import { bar, costAlertLevel, formatCost } from './core/usage';
import { ActivityViewProvider } from './activityView';
import { McpViewProvider } from './mcpView';
import { canReconnect, type McpServer } from './core/mcp';
import { buildCheckpoints, checkpointLabel, describeRewind } from './core/checkpoints';
import { searchTranscripts } from './transcriptSearch';
import { openCompletionReport } from './completionReport';
import { describeAttachments, parseDataUrl, toAttachment, type Attachment } from './core/attachments';
import { captureAfterReload, readHotReloadConfig } from './hotReload';
import { buildPinnedPrompt, describePinned, selectWithinBudget, type PinnedFile } from './core/pinned';
import { thresholdLevel } from './core/usage';
import { describeSessionConflict, SessionFilesTracker } from './core/sessionFiles';
import { managePresets, pickPreset, pickRestorable, planBranch } from './sessionLifecycle';
import { moveToDone, parseTasksFile, startableEntries } from './core/tasksFile';
import { buildCompactCommand, compactCandidates } from './core/compactSelection';
import { buildAgentOverrides, describeAgent, parseAgentFile, type AgentFile } from './core/agentDefs';
import {
	BUILTIN_TEMPLATES,
	describeTemplate,
	extractVariables,
	fillTemplate,
	missingVariables,
	removeTemplate,
	upsertTemplate,
	type PromptTemplate
} from './core/promptLibrary';
import { describeFindable, searchFindables, toPrompt, type Findable } from './core/findAnything';
import { draftSkill, renderSkillFile } from './core/sessionToSkill';
import { describeOutbox, isTransientFailure, Outbox } from './core/outbox';
import { collectTags } from './core/tasks';
import { dryRunHook, manageHooks } from './hooksBuilder';
import { exportBundle, importBundle, syncTeamBundle } from './bundleCommands';
import { runEvaluation } from './evaluationRunner';
import { createCompletionProvider, previewRun, validateDocument } from './authoring';
import {
	BUILTIN_PERSONAS,
	findPersona,
	stateColor,
	stateLabel,
	TURN_MODE_LABEL,
	turnModeInstruction,
	type AgentState,
	type TurnMode
} from './core/persona';
import {
	localOnlyEffect,
	RECOVERY_LABEL,
	shouldNotify,
	suggestRecovery,
	type RecoveryOption
} from './core/recovery';
import { checkBundleUrl } from './core/importSettings';
import { importOtherToolRules } from './importRules';
import { buildCrashPrompt, parseCrashLog } from './core/crashLog';
import { clarificationMessage, findVagueness } from './core/ambiguity';
import { buildWeeklyReview, describeWeeklyReview } from './core/weeklyReview';
import type { EvalCase } from './core/evaluation';
import { SettingsViewProvider } from './settingsView';
import { TimelineViewProvider } from './timelineView';
import { toAuditRecord, toJsonLine } from './core/audit';
import { describeEstimate, estimate } from './core/estimate';
import { COMPARE_OPTIONS_PROMPT, disagreementPrompt } from './core/dialogue';
import {
	advance,
	BUILTIN_WORKFLOWS,
	describeProgress,
	EXPLAIN_MODE_PROMPT,
	fillStep,
	isFinished,
	nextStep,
	type Workflow,
	type WorkflowState
} from './core/workflow';
import { buildAttributions, runningTool } from './core/activity';
import {
	BUILTIN_PROFILES,
	describeProfile,
	findProfile,
	isWidening,
	toSdkSandbox,
	type PolicyProfile
} from './core/policyProfiles';
import { PRIORITY_LABEL, type TaskPriority } from './core/tasks';
import { collectEvidence } from './core/evidence';
import { buildNotifyCommand, oneLine } from './core/notify';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { runMcpToolOnce } from './mcpToolRunner';
import { NimbusApiHost, type NimbusApi } from './nimbusApi';
import {
	applyToAlwaysAllow,
	applyToAudit,
	applyToProfile,
	describeManagedPolicy,
	hasManagedPolicy,
	type ManagedPolicy
} from './core/managedPolicy';
import { readManagedPolicy } from './managedPolicySource';
import { LSP_SERVER_NAME, lspMcpServer } from './lspTools';
import { DEBUG_SERVER_NAME, debugMcpServer } from './debugTools';
import { buildSignatureNote } from './signatureAttachment';
import { buildGroundingForPrompt, clearDependencyCache } from './grounding';
import { askAboutSelection, NimbusCodeLensProvider } from './editorActions';
import { showCoverageDiff } from './coverageDiff';
import { buildFailingTestPrompt } from './core/testFailures';
import { runImpactedTests } from './impactedTests';
import { addRefactorTrack, showRefactorProgress, startRefactorTrack } from './refactorProgress';
import { showRepoSummary } from './repoSummary';
import { reviewSnapshots } from './snapshotReview';
import { captureBehavior, verifyEquivalence } from './equivalence';
import { showConventions } from './conventions';
import { planBulkChange } from './bulkChange';
import { checkMutations } from './mutations';
import { saveSelectionAsSnippet } from './snippets';
import { writeAdr } from './decisions';
import { checkApiDocs } from './apiDocs';
import { trackSchemaImpact } from './schemaImpact';
import { investigateCi } from './ciFailure';
import { importCpuProfile } from './cpuProfile';
import { splitTerminals } from './terminalLayout';
import { managePlugins } from './plugins';
import { exportGif } from './gifExport';
import { packageSkills } from './skillPackage';
import { dictateInstruction } from './voiceInput';
import { notifyCodeOwners, showOwnersOfActiveFile } from './codeowners';
import { planHotfix, prepareRollback } from './rollback';
import { restackAfterMerge, showPrStack } from './prStack';
import { measureStartup, trackMemory } from './perfWatch';
import { compareAgentWork } from './agentCompare';
import { captureSimulator, writeFlowTest } from './simulator';
import { exportToWiki } from './wikiExport';
import { createRemoteApproval } from './remoteApproval';
import { exportSession, importSession } from './sessionSync';
import { listenForCommand } from './voiceCommands';
import { noticeUpgrade } from './versionWatch';
import { ClipboardHints } from './clipboardHints';
import { SessionRepeats } from './sessionRepeats';
import { exploreHistory } from './archaeology';
import { reverseSpec } from './reverseSpec';
import { chooseScope, currentScope } from './monorepo';
import { TerminalWatcher } from './terminalWatcher';
import { TestWatcher } from './testWatcher';
import { EditVerifier } from './editVerifier';
import { ApprovalsViewProvider } from './approvalsView';
import type { ApprovalDecision, PendingApproval } from './permissions';

/** 書き込み系ツール（衝突判定に使う。T-011） */
const WRITE_TOOL_NAMES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** 表示復元用に保持するイベント数の上限（長い会話でメモリを食い潰さないため） */
const MAX_RETAINED_EVENTS = 2000;

export function activate(context: vscode.ExtensionContext): NimbusApi {
	const output = vscode.window.createOutputChannel('Nimbus', { log: true });
	const sanitizer = createSanitizer();
	// ログに API キーやホームパス（＝OS ユーザー名）を残さない
	const log = (message: string): void => output.appendLine(sanitizer.sanitizeString(message));
	// 他の拡張が足した前提・指示を預かる（T-092）
	const pluginApi = new NimbusApiHost(log);

	const sessionAllowAll = new Set<string>();
	const previewer = new ProposedEditPreviewer();
	const contextView = new ContextViewProvider();
	const skillsView = new SkillsViewProvider();
	const claudeMdView = new ClaudeMdViewProvider();
	const usageView = new UsageViewProvider();
	const activityView = new ActivityViewProvider();
	const mcpView = new McpViewProvider();
	// 設定タブ（T-016）。いま効いている値を 1 か所に集める
	const settingsView = new SettingsViewProvider();
	// 生イベントの時系列（T-015 / T-184）
	const timelineView = new TimelineViewProvider();
	// 書式ミスをその場で見せる（T-030）
	const authoringDiagnostics = vscode.languages.createDiagnosticCollection('nimbus');
	// 誰がどのファイルを触っているか（T-011 / T-012）。全セッション横断で覚える
	const sessionFiles = new SessionFilesTracker();
	// 送れなかった入力を預かる（T-151）。打った文が黙って消えるのが一番困る
	const outbox = new Outbox();
	// どこまで見たか（T-160）。大きな変更を分割して見るときに要る
	const reviewView = new ReviewViewProvider(context.workspaceState, () => workspaceCwd(currentScope(context.workspaceState)), log);
	const reviewTree = vscode.window.createTreeView('nimbus.review', { treeDataProvider: reviewView });
	// 承認の横断キュー（T-010）。バッジを出すため registerTreeDataProvider ではなく createTreeView を使う
	const approvalsView = new ApprovalsViewProvider();
	const approvals = vscode.window.createTreeView('nimbus.approvals', { treeDataProvider: approvalsView });
	let pendingApprovals = 0;
	/** 文脈の消費率（T-020）。ステータスバーに出すため保持する */
	let contextPercent: number | undefined;
	/** ホットリロードで自動投入した回数（T-072）。指示のたびに 0 に戻す */
	let reloadRounds = 0;
	/** 文脈の予算の警告を出した段階（T-153）。同じ段階で何度も出さない */
	let budgetAlerted: 'warn' | 'over' | undefined;
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
				notify('Nimbus — 承認待ち', oneLine(latest.summary), true);
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
		alwaysAllowRules: () => {
			// 組織が認めていないルールは、設定に書いてあっても効かせない（T-212）
			const decided = applyToAlwaysAllow(
				managedPolicy(),
				vscode.workspace.getConfiguration('nimbus').get<string[]>('permissions.alwaysAllow') ?? []
			);
			if (decided.reason) {
				log(`[policy] ${decided.reason}`);
			}
			return decided.value;
		},
		onAlwaysAllow: (rule) => saveAlwaysAllowRule(rule)
	});

	// 同じ Wi-Fi の中から承認だけする口（T-054 / T-086）。開くのは明示的に呼ばれたときだけ
	const remoteApproval = createRemoteApproval({
		pending: () => broker.pending(),
		decide: (id, decision) => broker.decide(id, decision),
		log
	});

	const sessions = new SessionManager(
		undefined,
		async () =>
			buildOptions(
				await readPinnedFiles(),
				await readAgentFiles(),
				currentProfile(),
				findPersona(vscode.workspace.getConfiguration('nimbus').get<string>('persona')).instruction
			),
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
	/** 直近の init。探す対象（コマンド・サブエージェント・MCP ツール）の出どころ（T-117） */
	let lastInit: SessionInitEvent | undefined;
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
		onSend: (text, images) => void send(text, images),
		onInterrupt: () => void interrupt(),
		onNewSession: () => void newSession(),
		snapshot: () => ({
			events: retained,
			session: activeSessionId ? sessions.get(activeSessionId) : undefined
		}),
		log
	});

	sessions.on('event', (event: NimbusEvent) => {
		// 触ったファイルは全セッションぶん覚える。絞り込みの前に置く（T-011 / T-012）
		sessionFiles.record(event);
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
			// Claude Code が上がって使えるものが増えたら知らせる（T-094）
			void noticeUpgrade(context.globalState, event, {
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log
			});
			lastInit = event;
			void refreshMcp();
			contextView.update(event);
			skillsView.setSessionSkills(event.skills);
			lastApiKeySource = event.apiKeySource;
		}
		if (event.kind === 'tool-use') {
			// 書き換える前の診断を控えておく。「そのターンで増えたぶん」を出すため（T-101）
			verifier.noteToolUse(event.toolName, event.input);
		}
		cockpit.post({ type: 'event', event });
		warnOnConflict(event);
		timelineView.update(retained);
		void appendAudit(event);
		activityView.update(
			retained,
			sessionFiles.snapshots().filter((snapshot) => snapshot.sessionId !== activeSessionId),
			sessionName
		);
		updateStatus(sessions.get(event.sessionId));
		logEvent(event);
		if (event.kind === 'turn-result') {
			notify('Nimbus — ターンが終わりました', oneLine(event.resultText ?? '応答が返りました'));
			void runHotReload(event.sessionId);
			// ターンが終わるたびに取り直す。走っている最中に見えないと意味がない（T-017 / T-020）
			void refreshUsage(event.sessionId);
			checkCostLimit(event.sessionId, sessions.get(event.sessionId)?.totalCostUsd);
			// 区切りまで待ってから型を当てる。途中で割り込むと編集の途中経過を叩くことになる（T-101）
			void verifier.verifyAfterTurn();
			// 直したはずのビルドを、同じ端末でもう一度走らせる（T-106・既定は無効）
			terminals.onTurnFinished();
		}
	});

	/**
	 * OS 通知（tasks.md T-019）。放置して他の作業に戻れることが体験の芯なので、
	 * ウィンドウを見ていなくても届く必要がある。VS Code の通知はウィンドウの中にしか出ない。
	 *
	 * 既定では**ウィンドウが前面に無いときだけ**出す。見ている画面に重ねて出しても邪魔なだけで、
	 * それを繰り返すと通知そのものを切られてしまう（T-087 の集中モードとも衝突しない形）。
	 */
	function notify(title: string, body: string, isApproval = false): void {
		const config = vscode.workspace.getConfiguration('nimbus');
		// 集中モード（T-087）は完了通知を黙らせるが、**承認待ちは通す** —
		// 承認待ちは「止まっている」の知らせで、黙らせると作業が進まなくなる
		const decision = shouldNotify({
			enabled: config.get<boolean>('notifications.enabled') !== false,
			focusMode: config.get<boolean>('focusMode') === true,
			onlyWhenUnfocused: config.get<boolean>('notifications.onlyWhenUnfocused') !== false,
			windowFocused: vscode.window.state.focused,
			isApproval
		});
		if (!decision.notify) {
			return;
		}
		// ローカル完結モード（T-077）では、本文が外部プロセスへ渡る OS 通知を使わない
		if (config.get<boolean>('localOnly') === true) {
			void vscode.window.showInformationMessage(`${title} — ${body}`);
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

	/**
	 * ホットリロード連携（tasks.md T-072）。ターンが終わって対象ファイルが変わっていたら、
	 * リロード → スクショ → セッションへ投入、までを自動で回す。
	 * **回数の上限がある**（既定 3 周）。無いと、直す → 撮る → 直す、が止まらない。
	 */
	async function runHotReload(sessionId: string): Promise<void> {
		if (sessionId !== activeSessionId || !sessions.isAccepting(sessionId)) {
			return;
		}
		const config = readHotReloadConfig();
		const cwd = workspaceCwd(currentScope(context.workspaceState));
		// ローカル完結モード（T-077）ではコマンドを実行しない
		if (!config.enabled || !cwd || vscode.workspace.getConfiguration('nimbus').get<boolean>('localOnly') === true) {
			return;
		}
		const changed = collectEvidence(retained).changedFiles;
		const outcome = await captureAfterReload(config, changed, reloadRounds, cwd, log);
		if (!outcome.sent || !outcome.attachment || !outcome.prompt) {
			if (outcome.reason && outcome.reason !== 'not-watched' && outcome.reason !== 'disabled') {
				log(`[hot-reload] 見送りました: ${outcome.reason}`);
			}
			return;
		}
		reloadRounds++;
		log(`[hot-reload] スクショを投入します（${reloadRounds} 周目）`);
		sessions.sendMessage(sessionId, outcome.prompt, [outcome.attachment]);
	}

	/**
	 * ピン留めしたファイルを読む（tasks.md T-152）。
	 * 読めなかったものは黙って飛ばさず、名前を出す（設定に残ったままのパスに気づけるように）。
	 */
	async function readPinnedFiles(): Promise<PinnedFile[]> {
		const paths = vscode.workspace.getConfiguration('nimbus').get<string[]>('context.pinnedFiles') ?? [];
		const files: PinnedFile[] = [];
		for (const path of paths) {
			const uri = path.startsWith('/')
				? vscode.Uri.file(path)
				// 文脈を組み立てるたびに走るので聞かない（T-173）
				: vscode.Uri.joinPath(resolveWorkspaceRoot()?.uri ?? vscode.Uri.file('.'), path);
			try {
				const bytes = await vscode.workspace.fs.readFile(uri);
				files.push({ path, content: Buffer.from(bytes).toString('utf8') });
			} catch {
				log(`[pinned] 読めませんでした: ${path}`);
			}
		}
		return files;
	}

	/** ピン留めの追加・削除。設定を直接書かせない（パスの綴り間違いが一番多い） */
	async function managePinnedFiles(): Promise<void> {
		const config = vscode.workspace.getConfiguration('nimbus');
		const current = config.get<string[]>('context.pinnedFiles') ?? [];
		const ADD = '$(add) ファイルを足す';
		const items: vscode.QuickPickItem[] = [
			{ label: ADD },
			...current.map((path) => ({ label: path, description: '選ぶと外します' }))
		];
		const chosen = await vscode.window.showQuickPick(items, {
			title: `Nimbus: 常に含めるファイル（${describePinned(selectWithinBudget(await readPinnedFiles()))}）`
		});
		if (!chosen) {
			return;
		}
		if (chosen.label === ADD) {
			const picked = await vscode.window.showOpenDialog({ canSelectMany: true, title: '常に含めるファイルを選ぶ' });
			if (!picked || picked.length === 0) {
				return;
			}
			// 選ばれたファイル自身が手がかりなので、聞かずに決まる（T-173）
			const root = resolveWorkspaceRoot(picked[0])?.uri.fsPath;
			const added = picked.map((uri) =>
				root && uri.fsPath.startsWith(`${root}/`) ? uri.fsPath.slice(root.length + 1) : uri.fsPath
			);
			await config.update('context.pinnedFiles', [...current, ...added], vscode.ConfigurationTarget.Workspace);
			log(`[pinned] 追加: ${added.join(', ')}`);
			return;
		}
		await config.update(
			'context.pinnedFiles',
			current.filter((path) => path !== chosen.label),
			vscode.ConfigurationTarget.Workspace
		);
		log(`[pinned] 削除: ${chosen.label}`);
	}

	/** セッション ID を読める名前にする。タスクとして走っているならタスク名を出す */
	function sessionName(sessionId: string): string {
		return tasks.list().find((task) => task.sessionId === sessionId)?.title ?? `セッション ${sessionId.slice(0, 8)}`;
	}

	/** 同じファイルを二重に触っていることを一度だけ知らせる（同じ組み合わせで鳴らし続けない） */
	const warnedConflicts = new Set<string>();

	/**
	 * 同じファイルを触っているセッションを知らせる（tasks.md T-011）。
	 * コンフリクトになってから解くより、書く前に知るほうが安い。
	 */
	function warnOnConflict(event: NimbusEvent): void {
		if (event.kind !== 'tool-use' || !WRITE_TOOL_NAMES.has(event.toolName)) {
			return;
		}
		const input = event.input as { file_path?: unknown } | null;
		const path = typeof input?.file_path === 'string' ? input.file_path : undefined;
		if (!path) {
			return;
		}
		const conflict = sessionFiles.conflictFor(event.sessionId, path);
		if (!conflict) {
			return;
		}
		const key = `${event.sessionId}:${path}`;
		if (warnedConflicts.has(key)) {
			return;
		}
		warnedConflicts.add(key);
		const message = describeSessionConflict(conflict, sessionName);
		log(`[conflict] ${message}`);
		void vscode.window.showWarningMessage(`Nimbus: ${message}`);
	}

	/**
	 * うまくいった流れをスキルにする（tasks.md T-168）。
	 * 骨格までを書き、中身を練るのは Claude に任せる。
	 */
	async function sessionToSkill(): Promise<void> {
		if (retained.length === 0) {
			void vscode.window.showInformationMessage('Nimbus: まだスキルにできる流れがありません。');
			return;
		}
		const title = await vscode.window.showInputBox({
			title: 'Nimbus: このセッションをスキルにする',
			prompt: 'スキルの名前',
			placeHolder: '例: ログイン画面のバリデーションを直す'
		});
		if (!title) {
			return;
		}
		const description = await vscode.window.showInputBox({
			title: 'Nimbus: このセッションをスキルにする',
			prompt: 'どんなときに使うか（1 行）',
			placeHolder: 'この説明で呼び出されるので、使いどきが分かる書き方にする'
		});
		if (description === undefined) {
			return;
		}
		const folder = await pickWorkspaceRoot();
		if (!folder) {
			return;
		}
		const root = folder.uri;
		const draft = draftSkill(retained, title, description);
		const target = vscode.Uri.joinPath(root, '.claude', 'skills', draft.name, 'SKILL.md');
		try {
			// 既にあるものは絶対に上書きしない（書いたスキルが消えるのが一番困る）
			await vscode.workspace.fs.stat(target);
			void vscode.window.showWarningMessage(`Nimbus: ${draft.name} は既にあります。上書きはしません。`);
			await vscode.window.showTextDocument(target);
			return;
		} catch {
			// 無いので作る
		}
		await vscode.workspace.fs.writeFile(target, Buffer.from(renderSkillFile(draft), 'utf8'));
		log(`[skill] ${draft.name} を作りました`);
		await vscode.window.showTextDocument(target);
		skillsView.refresh();
		void vscode.window.showInformationMessage(
			`Nimbus: ${draft.name} の下書きを作りました。手順と気をつけることを整えてください。`
		);
	}

	/** タスクのピン留め（T-147） */
	async function pinTask(taskId: string | undefined): Promise<void> {
		const target = taskId ?? (await pickTask('どのタスクをピン留めしますか'));
		if (!target) {
			return;
		}
		tasks.togglePinned(target);
	}

	/** タスクのタグ付け（T-147）。既にあるタグを候補に出す */
	async function tagTask(taskId: string | undefined): Promise<void> {
		const target = taskId ?? (await pickTask('どのタスクにタグを付けますか'));
		if (!target) {
			return;
		}
		const task = tasks.get(target);
		if (!task) {
			return;
		}
		const known = collectTags(tasks.list()).map((entry) => entry.tag);
		const value = await vscode.window.showInputBox({
			title: `Nimbus: ${task.title} のタグ`,
			prompt: 'カンマ区切り。空にすると外れます',
			value: (task.tags ?? []).join(', '),
			placeHolder: known.length > 0 ? `既にあるタグ: ${known.join(', ')}` : '例: 調査, UI'
		});
		if (value === undefined) {
			return;
		}
		tasks.setTags(target, value.split(','));
	}

	async function pickTask(title: string): Promise<string | undefined> {
		const all = tasks.list();
		if (all.length === 0) {
			void vscode.window.showInformationMessage('Nimbus: タスクがありません。');
			return undefined;
		}
		const chosen = await vscode.window.showQuickPick(
			all.map((task) => ({
				label: `${task.pinned ? '$(pinned) ' : ''}${task.title}`,
				description: (task.tags ?? []).join(' '),
				taskId: task.taskId
			})),
			{ title: `Nimbus: ${title}` }
		);
		return chosen?.taskId;
	}

	/** 配布物を URL から入れる（tasks.md T-071）。**https だけ**通す */
	async function installFromUrl(): Promise<void> {
		const raw = await vscode.window.showInputBox({
			title: 'Nimbus: 配布物の URL',
			placeHolder: 'https://example.com/team-bundle.json'
		});
		if (!raw) {
			return;
		}
		const check = checkBundleUrl(raw);
		if (!check.ok) {
			void vscode.window.showErrorMessage(`Nimbus: ${check.reason}`);
			return;
		}
		// 取ってきたものは、手元のファイルと同じ検査を通す（T-043 と同じ道）
		void vscode.window.showInformationMessage(
			`Nimbus: ${check.url} を開きます。保存してから「配られた設定を読み込む」で取り込んでください。`
		);
		await vscode.env.openExternal(vscode.Uri.parse(check.url));
	}

	/**
	 * 週のふりかえり（tasks.md T-097）。
	 * **盛らない。** 実際に起きたことしか出さない。
	 */
	async function showWeeklyReview(): Promise<void> {
		const review = buildWeeklyReview([retained]);
		void vscode.window.showInformationMessage(`Nimbus: ${describeWeeklyReview(review)}`);
		log(`[weekly] ${describeWeeklyReview(review)}`);
	}

	/**
	 * 実機ログを貼る（tasks.md T-074）。
	 * **全文は渡さない。** 自分のコードのフレームだけを先に出す。
	 */
	async function pasteCrashLog(): Promise<void> {
		const text = await vscode.env.clipboard.readText();
		if (!text.trim()) {
			void vscode.window.showInformationMessage('Nimbus: クリップボードが空です。ログをコピーしてから実行してください。');
			return;
		}
		const report = parseCrashLog(text);
		if (report.frames.length === 0) {
			void vscode.window.showInformationMessage('Nimbus: スタックトレースを読み取れませんでした。');
			return;
		}
		cockpit.reveal();
		await send(buildCrashPrompt(report));
		log(`[crash] フレーム ${report.frames.length} 件（自分のコード ${report.ownFrames.length} 件）を渡しました`);
	}

	/**
	 * ローカル完結モード（tasks.md T-077）。
	 * **何が止まって、何が止まらないかを必ず見せてから**切り替える。
	 * 「外に出ない」と思い込ませるのが一番危ない。
	 */
	async function toggleLocalOnly(): Promise<void> {
		const config = vscode.workspace.getConfiguration('nimbus');
		if (config.get<boolean>('localOnly') === true) {
			await config.update('localOnly', false, vscode.ConfigurationTarget.Workspace);
			void vscode.window.showInformationMessage('Nimbus: ローカル完結モードを切りました。');
			return;
		}
		const effect = localOnlyEffect();
		const CONFIRM = '有効にする';
		const answer = await vscode.window.showWarningMessage(
			'Nimbus: ローカル完結モードにします。',
			{
				modal: true,
				detail:
					`止まるもの:\n${effect.stopped.map((line) => `・${line}`).join('\n')}`
					+ `\n\n止まらないもの:\n${effect.notStopped.map((line) => `・${line}`).join('\n')}`
			},
			CONFIRM
		);
		if (answer !== CONFIRM) {
			return;
		}
		await config.update('localOnly', true, vscode.ConfigurationTarget.Workspace);
		log('[local-only] 有効にしました');
	}

	/**
	 * 詰まったときの立て直し（tasks.md T-088）。
	 * **勝手に戻さない。** 見立てとその理由を出して、選ばせる。
	 */
	async function offerRecovery(): Promise<void> {
		const evidence = collectEvidence(retained);
		const recentErrors = retained.filter((event) => event.kind === 'tool-result' && event.isError).length;
		const lastRun = evidence.runs[evidence.runs.length - 1];
		const editCounts = new Map<string, number>();
		for (const edit of buildAttributions(retained).flatMap((a) => a.edits)) {
			editCounts.set(edit.path, (editCounts.get(edit.path) ?? 0) + 1);
		}
		const suggestion = suggestRecovery({
			recentToolErrors: recentErrors,
			repeatedEditsOnSameFile: Math.max(0, ...editCounts.values()),
			testsFailing: lastRun?.outcome === 'failed'
		});
		if (!suggestion.stuck) {
			void vscode.window.showInformationMessage('Nimbus: いまのところ詰まっているようには見えません。');
			return;
		}
		const chosen = await vscode.window.showQuickPick(
			suggestion.options.map((option) => ({ label: RECOVERY_LABEL[option], option })),
			{ title: `Nimbus: ${suggestion.reason}`, placeHolder: 'どう立て直しますか' }
		);
		if (!chosen) {
			return;
		}
		const commands: Partial<Record<RecoveryOption, string>> = {
			rewind: 'nimbus.rewind',
			alternative: 'nimbus.compareOptions',
			handover: 'nimbus.turnMode'
		};
		const command = commands[chosen.option];
		if (command) {
			await vscode.commands.executeCommand(command);
		}
	}

	/** ペルソナを選ぶ（T-063）。次のセッションから効く */
	async function choosePersona(): Promise<void> {
		const config = vscode.workspace.getConfiguration('nimbus');
		const now = findPersona(config.get<string>('persona'));
		const chosen = await vscode.window.showQuickPick(
			BUILTIN_PERSONAS.map((persona) => ({
				label: `${persona.name === now.name ? '$(check) ' : ''}${persona.name}`,
				description: persona.description,
				persona
			})),
			{ title: `Nimbus: 話しかたを選ぶ（いまは「${now.name}」）` }
		);
		if (!chosen) {
			return;
		}
		await config.update('persona', chosen.persona.name, vscode.ConfigurationTarget.Workspace);
		log(`[persona] ${chosen.persona.name}`);
		void vscode.window.showInformationMessage(
			`Nimbus: 「${chosen.persona.name}」にしました。次のセッションから効きます。`
		);
	}

	/** 書く番を切り替える（T-190 / T-191）。いまのセッションへ即座に伝える */
	async function chooseTurnMode(): Promise<void> {
		const chosen = await vscode.window.showQuickPick(
			(['agent', 'human', 'shoulder'] as TurnMode[]).map((mode) => ({
				label: TURN_MODE_LABEL[mode],
				mode
			})),
			{ title: 'Nimbus: どちらが書きますか' }
		);
		if (!chosen) {
			return;
		}
		cockpit.reveal();
		await send(turnModeInstruction(chosen.mode));
		log(`[turn] ${TURN_MODE_LABEL[chosen.mode]}`);
	}

	const EVAL_KEY = 'nimbus.evalCases';

	/**
	 * 回帰テスト・ブレ幅・モデル比較（tasks.md T-165 / T-166 / T-167）。
	 * ケースを保存しておき、直したあとに同じものを流し直せるようにする。
	 */
	async function evaluate(): Promise<void> {
		const cwd = requireCwd();
		if (!cwd) {
			return;
		}
		const saved = context.globalState.get<EvalCase[]>(EVAL_KEY, []);
		const ADD = '$(add) 新しいケース';
		const chosen = await vscode.window.showQuickPick(
			[
				{ label: ADD, description: '', testCase: undefined as EvalCase | undefined },
				...saved.map((testCase) => ({
					label: testCase.name,
					description: `期待: ${testCase.expect.join(' / ')}`,
					testCase
				}))
			],
			{ title: 'Nimbus: 評価するケース', matchOnDescription: true }
		);
		if (!chosen) {
			return;
		}
		let testCase = chosen.testCase;
		if (!testCase) {
			const name = await vscode.window.showInputBox({ title: 'ケース名', placeHolder: '例: レビューが根拠を示す' });
			if (!name) {
				return;
			}
			const prompt = await vscode.window.showInputBox({ title: '投げる指示' });
			if (!prompt) {
				return;
			}
			const expect = await vscode.window.showInputBox({
				title: '応答に含まれていてほしい語',
				prompt: 'カンマ区切り。**すべて**含まれたときだけ合格にします'
			});
			if (!expect) {
				return;
			}
			testCase = { name, prompt, expect: expect.split(',').map((word) => word.trim()).filter(Boolean) };
			await context.globalState.update(EVAL_KEY, [...saved.filter((c) => c.name !== name), testCase]);
		}

		const attemptsText = await vscode.window.showQuickPick(['1', '3', '5'], {
			title: 'Nimbus: 何回まわしますか',
			placeHolder: '同じ指示で結果が変わるかを見るなら 3 回以上'
		});
		if (!attemptsText) {
			return;
		}
		const available = activeSessionId ? await sessions.supportedModels(activeSessionId) : [];
		const models = await vscode.window.showQuickPick(
			available.map((entry) => entry.id ?? String(entry)),
			{ title: 'Nimbus: 比べるモデル（選ばなければ既定のモデルだけ）', canPickMany: true }
		);
		await runEvaluation(
			sessions,
			cwd,
			{ testCase, attempts: Number(attemptsText), models: models ?? [] },
			log
		);
	}

	/** 進行中のワークフロー（T-149）。1 本だけ持つ（同時に 2 本走らせても追えない） */
	let workflow: { definition: Workflow; state: WorkflowState } | undefined;

	/** ワークフローを始める（tasks.md T-149） */
	async function startWorkflow(): Promise<void> {
		const chosen = await vscode.window.showQuickPick(
			BUILTIN_WORKFLOWS.map((definition) => ({
				label: definition.name,
				description: `${definition.steps.length} 段`,
				detail: definition.description,
				definition
			})),
			{ title: 'Nimbus: どの流れで進めますか', matchOnDetail: true }
		);
		if (!chosen) {
			return;
		}
		const input = await vscode.window.showInputBox({
			title: `Nimbus: ${chosen.definition.name}`,
			prompt: '最初の段に渡すこと',
			placeHolder: '例: ログイン画面のバリデーションが効いていない'
		});
		if (!input) {
			return;
		}
		workflow = { definition: chosen.definition, state: { workflowName: chosen.definition.name, stepIndex: 0, input } };
		await runNextWorkflowStep();
	}

	/**
	 * 次の段へ進む（T-149）。
	 * **自動では進めない。** 段の切れ目で人が確認できることが、この機能の値打ちなので。
	 */
	async function runNextWorkflowStep(): Promise<void> {
		if (!workflow) {
			void vscode.window.showInformationMessage('Nimbus: 進行中の流れがありません。');
			return;
		}
		if (isFinished(workflow.definition, workflow.state)) {
			void vscode.window.showInformationMessage(`Nimbus: ${describeProgress(workflow.definition, workflow.state)}`);
			workflow = undefined;
			return;
		}
		const step = nextStep(workflow.definition, workflow.state);
		if (!step) {
			return;
		}
		log(`[workflow] ${describeProgress(workflow.definition, workflow.state)}`);
		cockpit.reveal();
		await send(fillStep(step, workflow.state.input));
		workflow = { ...workflow, state: advance(workflow.state) };
		const progress = describeProgress(workflow.definition, workflow.state);
		if (step.confirm && !isFinished(workflow.definition, workflow.state)) {
			const NEXT = '次の段へ';
			void vscode.window.showInformationMessage(`Nimbus: ${progress}`, NEXT).then((choice) => {
				if (choice === NEXT) {
					void runNextWorkflowStep();
				}
			});
		}
	}

	/**
	 * 見積もり（tasks.md T-187）。
	 * **未来は予測しない。** このセッションで実際に起きたことの中央値を出す。
	 */
	async function showEstimate(): Promise<void> {
		const value = estimate(retained);
		const text = describeEstimate(value);
		log(`[estimate] ${text}`);
		if (value.samples === 0) {
			void vscode.window.showInformationMessage(`Nimbus: ${text}`);
			return;
		}
		void vscode.window.showInformationMessage(`Nimbus: ${text}`, { modal: false });
	}

	/** 意見の相違を残す（T-189）。どちらが正しいかは決めつけさせない */
	async function recordDisagreement(): Promise<void> {
		const mine = await vscode.window.showInputBox({
			title: 'Nimbus: 意見の相違を残す',
			prompt: 'あなたの考え',
			placeHolder: '例: 既存の設計を活かすべきだと思う'
		});
		if (!mine) {
			return;
		}
		const theirs = await vscode.window.showInputBox({
			title: 'Nimbus: 意見の相違を残す',
			prompt: 'Claude の提案の要点'
		});
		if (theirs === undefined) {
			return;
		}
		cockpit.reveal();
		await send(disagreementPrompt(mine, theirs));
	}

	/** 監査ログの置き場所（T-050）。globalStorage に日付ごとの JSONL で残す */
	function auditUri(): vscode.Uri {
		const day = new Date().toISOString().slice(0, 10);
		return vscode.Uri.joinPath(context.globalStorageUri, 'audit', `${day}.jsonl`);
	}

	/**
	 * 監査ログへ追記（tasks.md T-050）。
	 * **必ずサニタイザを通してから書く** — 監査ログこそ人に見せる前提のものなので、
	 * ここに資格情報が残ると、いちばん流出しやすい形になる。
	 */
	async function appendAudit(event: NimbusEvent): Promise<void> {
		const auditConfig = vscode.workspace.getConfiguration('nimbus');
		// 組織が「止めさせない」と決めていれば、設定で切られていても残す（T-212）
		const auditOn = applyToAudit(managedPolicy(), auditConfig.get<boolean>('audit.enabled') !== false).value;
		// ローカル完結モード（T-077）では、持ち出される経路そのものを作らない
		if (!auditOn || auditConfig.get<boolean>('localOnly') === true) {
			return;
		}
		const record = toAuditRecord(event);
		if (!record) {
			return;
		}
		const line = sanitizer.sanitizeString(toJsonLine(record));
		const uri = auditUri();
		try {
			await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
			let existing = Buffer.alloc(0);
			try {
				existing = Buffer.from(await vscode.workspace.fs.readFile(uri));
			} catch {
				// 初回は空から
			}
			await vscode.workspace.fs.writeFile(uri, Buffer.concat([existing, Buffer.from(line, 'utf8')]));
		} catch (error) {
			// 監査が書けないことを、セッションが動かない理由にしない
			log(`[audit] 書き出せませんでした: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/** 今日の監査ログを開く（T-050） */
	async function showAuditLog(): Promise<void> {
		const uri = auditUri();
		try {
			await vscode.workspace.fs.stat(uri);
		} catch {
			void vscode.window.showInformationMessage('Nimbus: 今日の監査ログはまだありません。');
			return;
		}
		await vscode.window.showTextDocument(uri);
	}

	/**
	 * 組織が置いた制限（T-212）。マシン単位の設定なので、
	 * 利用者のワークスペース設定では上書きできない。置かれていなければ何も変わらない。
	 */
	function managedPolicy(): ManagedPolicy | undefined {
		return readManagedPolicy();
	}

	/** いま効いているプロファイル（T-162）。設定には名前だけを持つ */
	function currentProfile(): PolicyProfile {
		const requested = findProfile(BUILTIN_PROFILES, vscode.workspace.getConfiguration('nimbus').get<string>('policy.profile'));
		const decided = applyToProfile(managedPolicy(), BUILTIN_PROFILES, requested);
		if (decided.reason) {
			// 黙って変えない。「なぜか設定が戻る」が一番たちが悪い
			log(`[policy] ${decided.reason}`);
		}
		return decided.value;
	}

	/**
	 * 承認ポリシーの切り替え（tasks.md T-162 / T-163）。
	 * 許可の広さは何をしているかで変わる。まとめて名前で切り替えられるようにする。
	 */
	async function switchPolicy(): Promise<void> {
		const now = currentProfile();
		const chosen = await vscode.window.showQuickPick(
			BUILTIN_PROFILES.map((profile) => ({
				label: `${profile.name === now.name ? '$(check) ' : ''}${profile.name}`,
				description: describeProfile(profile),
				detail: profile.description,
				profile
			})),
			{ title: `Nimbus: いまは「${now.name}」`, matchOnDetail: true }
		);
		if (!chosen || chosen.profile.name === now.name) {
			return;
		}
		// 広げるときだけ確認する。狭めるのは黙って通してよい
		if (isWidening(now, chosen.profile)) {
			const CONFIRM = '切り替える';
			const answer = await vscode.window.showWarningMessage(
				`Nimbus: 「${chosen.profile.name}」は、いまより許可が広くなります。`,
				{ modal: true, detail: describeProfile(chosen.profile) },
				CONFIRM
			);
			if (answer !== CONFIRM) {
				return;
			}
		}
		const config = vscode.workspace.getConfiguration('nimbus');
		await config.update('policy.profile', chosen.profile.name, vscode.ConfigurationTarget.Workspace);
		await config.update('permissions.autoApproveReadOnly', chosen.profile.autoApproveReadOnly, vscode.ConfigurationTarget.Workspace);
		await config.update('safety.blockProtectedReads', chosen.profile.blockProtectedReads, vscode.ConfigurationTarget.Workspace);
		log(`[policy] ${now.name} → ${chosen.profile.name}（${describeProfile(chosen.profile)}）`);
		void vscode.window.showInformationMessage(
			`Nimbus: 「${chosen.profile.name}」に切り替えました。次のセッションから効きます。`
		);
	}

	const PROMPT_KEY = 'nimbus.promptTemplates';

	function loadTemplates(): PromptTemplate[] {
		const saved = context.globalState.get<PromptTemplate[]>(PROMPT_KEY, []);
		const names = new Set(saved.map((template) => template.name));
		// 出荷時のものは常に出す。同名で保存されていたら、そちらが勝つ
		return [...saved, ...BUILTIN_TEMPLATES.filter((template) => !names.has(template.name))];
	}

	/**
	 * プロンプトライブラリ（tasks.md T-035）。
	 * 変数を空けた定型を選び、**フォームで埋めてから**送る。
	 */
	async function usePromptTemplate(): Promise<void> {
		const templates = loadTemplates();
		const chosen = await vscode.window.showQuickPick(
			templates.map((template) => ({
				label: template.name,
				description: describeTemplate(template),
				template
			})),
			{ title: 'Nimbus: 定型プロンプトを使う', matchOnDescription: true }
		);
		if (!chosen) {
			return;
		}
		const values: Record<string, string> = {};
		for (const name of extractVariables(chosen.template.body)) {
			const value = await vscode.window.showInputBox({
				title: `Nimbus: ${chosen.template.name}`,
				prompt: name,
				placeHolder: `{{${name}}} に入ります`
			});
			if (value === undefined) {
				// 途中でやめたら送らない（半端に埋まったものを送るほうが困る）
				return;
			}
			values[name] = value;
		}
		const filled = fillTemplate(chosen.template.body, values);
		const missing = missingVariables(chosen.template.body, values);
		if (missing.length > 0) {
			const SEND = 'このまま送る';
			const answer = await vscode.window.showWarningMessage(
				`Nimbus: 埋まっていない変数があります（${missing.join(' / ')}）。`,
				{ modal: true, detail: '埋まらなかったところは {{名前}} のまま送られます。' },
				SEND
			);
			if (answer !== SEND) {
				return;
			}
		}
		cockpit.reveal();
		await send(filled);
	}

	/** 定型の追加・削除。出荷時のものは消せない */
	async function managePromptTemplates(): Promise<void> {
		const saved = context.globalState.get<PromptTemplate[]>(PROMPT_KEY, []);
		const ADD = '$(add) 新しい定型';
		const chosen = await vscode.window.showQuickPick([ADD, ...saved.map((t) => t.name)].map((label) => ({ label })), {
			title: 'Nimbus: 定型プロンプトの管理（選ぶと削除）'
		});
		if (!chosen) {
			return;
		}
		if (chosen.label !== ADD) {
			await context.globalState.update(PROMPT_KEY, removeTemplate(saved, chosen.label));
			return;
		}
		const name = await vscode.window.showInputBox({ title: '名前', placeHolder: '例: レビューを頼む' });
		if (!name) {
			return;
		}
		const body = await vscode.window.showInputBox({
			title: '本文',
			prompt: '{{名前}} と書いたところが、呼び出し時に聞かれます',
			placeHolder: '{{対象ファイル}} をレビューしてください'
		});
		if (!body) {
			return;
		}
		await context.globalState.update(PROMPT_KEY, upsertTemplate(saved, { name, body }));
		log(`[prompt] 定型を保存しました: ${name}`);
	}

	/**
	 * スキル以外も同じ場所から探す（tasks.md T-117）。
	 * サブエージェント・スラッシュコマンド・MCP ツールは、名前を覚えている人しか使えなかった。
	 */
	async function findAnything(): Promise<void> {
		const init = lastInit;
		const roots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
		const items: Findable[] = [
			...discoverSkills(roots).map((skill) => ({
				kind: 'skill' as const,
				name: skill.name,
				description: skill.description,
				origin: skill.origin,
				path: skill.path
			})),
			...(init?.slashCommands ?? []).map((name) => ({
				kind: 'command' as const,
				name,
				description: 'スラッシュコマンド'
			})),
			...(init?.agents ?? []).map((name) => ({
				kind: 'agent' as const,
				name,
				description: 'サブエージェント'
			})),
			...(init?.tools ?? [])
				.filter((name) => name.startsWith('mcp__'))
				.map((name) => ({ kind: 'tool' as const, name, description: 'MCP ツール' })),
			...loadTemplates().map((template) => ({
				kind: 'prompt' as const,
				name: template.name,
				description: template.body
			}))
		];
		if (items.length === 0) {
			void vscode.window.showInformationMessage('Nimbus: 探せるものがまだありません（セッションを開始すると増えます）。');
			return;
		}

		const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { item: Findable }>();
		picker.title = 'Nimbus: 探す（スキル・コマンド・サブエージェント・MCP ツール・定型）';
		picker.placeholder = 'したいことを書く（例: レビュー、PDF、テスト）';
		picker.matchOnDescription = true;
		picker.matchOnDetail = true;
		const toItem = (item: Findable): vscode.QuickPickItem & { item: Findable } => ({
			label: item.name,
			description: describeFindable(item),
			detail: item.description.replace(/\s+/g, ' ').slice(0, 120),
			item
		});
		picker.items = items.map(toItem);
		// 入力のたびに自前の採点で並べ替える（説明文への当たりを効かせるため）
		picker.onDidChangeValue((value) => {
			picker.items = searchFindables(items, value).map(toItem);
		});
		const chosen = await new Promise<Findable | undefined>((resolvePick) => {
			picker.onDidAccept(() => {
				resolvePick(picker.selectedItems[0]?.item);
				picker.hide();
			});
			picker.onDidHide(() => resolvePick(undefined));
			picker.show();
		});
		picker.dispose();
		if (!chosen) {
			return;
		}
		if (chosen.kind === 'prompt') {
			await usePromptTemplate();
			return;
		}
		const USE = 'コックピットで使う';
		const OPEN = 'ファイルを開く';
		const action = await vscode.window.showInformationMessage(
			`${chosen.name} — ${chosen.description || '（説明なし）'}`,
			...(chosen.path ? [USE, OPEN] : [USE])
		);
		if (action === OPEN && chosen.path) {
			await vscode.window.showTextDocument(vscode.Uri.file(chosen.path));
		} else if (action === USE) {
			cockpit.reveal();
			await send(toPrompt(chosen));
		}
	}

	/**
	 * サブエージェントの定義を読む（tasks.md T-232）。
	 * プロジェクトの `.claude/agents/` と、利用者の `~/.claude/agents/` の両方を見る。
	 */
	async function readAgentFiles(): Promise<AgentFile[]> {
		const roots = [
			...(vscode.workspace.workspaceFolders ?? []).map((folder) => vscode.Uri.joinPath(folder.uri, '.claude', 'agents')),
			vscode.Uri.joinPath(vscode.Uri.file(homedir()), '.claude', 'agents')
		];
		const files: AgentFile[] = [];
		const seen = new Set<string>();
		for (const root of roots) {
			let entries: [string, vscode.FileType][];
			try {
				entries = await vscode.workspace.fs.readDirectory(root);
			} catch {
				continue;
			}
			for (const [name, type] of entries) {
				if (type !== vscode.FileType.File || !name.endsWith('.md')) {
					continue;
				}
				try {
					const content = Buffer.from(
						await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, name))
					).toString('utf8');
					const parsed = parseAgentFile(name, content);
					// 先に見つかったほう（プロジェクト側）を優先する
					if (parsed && !seen.has(parsed.name)) {
						seen.add(parsed.name);
						files.push(parsed);
					}
				} catch {
					continue;
				}
			}
		}
		return files;
	}

	/** サブエージェントにモデルを割り当てる（T-232） */
	async function assignAgentModels(): Promise<void> {
		const files = await readAgentFiles();
		if (files.length === 0) {
			void vscode.window.showInformationMessage(
				'Nimbus: サブエージェントの定義が見つかりませんでした（.claude/agents/*.md に置きます）。'
			);
			return;
		}
		const config = vscode.workspace.getConfiguration('nimbus');
		const assigned = config.get<Record<string, string>>('agents.models') ?? {};
		const chosen = await vscode.window.showQuickPick(
			files.map((file) => ({
				label: file.name,
				description: describeAgent(file, assigned[file.name]),
				detail: file.description,
				file
			})),
			{ title: 'Nimbus: どのサブエージェントのモデルを決めますか', matchOnDetail: true }
		);
		if (!chosen) {
			return;
		}
		const CLEAR = '既定に戻す';
		// 実際に使えるモデルはセッションから引く。無ければ手で入れてもらう
		const available = activeSessionId ? await sessions.supportedModels(activeSessionId) : [];
		const model = await vscode.window.showQuickPick(
			[CLEAR, ...available.map((entry) => entry.id ?? String(entry))],
			{ title: `Nimbus: ${chosen.file.name} に使うモデル`, placeHolder: available.length === 0 ? 'セッションを開始すると候補が出ます' : '' }
		);
		if (!model) {
			return;
		}
		const next = { ...assigned };
		if (model === CLEAR) {
			delete next[chosen.file.name];
		} else {
			next[chosen.file.name] = model;
		}
		await config.update('agents.models', next, vscode.ConfigurationTarget.Workspace);
		log(`[agents] ${chosen.file.name} → ${model}`);
		void vscode.window.showInformationMessage(
			`Nimbus: ${chosen.file.name} は次のセッションから ${model === CLEAR ? '既定のモデル' : model} を使います。`
		);
	}

	/**
	 * 圧縮前に「何を残すか」を選ぶ（tasks.md T-154）。
	 * コンパクションを黙って任せない。選んだものは `/compact` への指示として渡す。
	 */
	async function compactWithSelection(): Promise<void> {
		if (!activeSessionId || !sessions.isAccepting(activeSessionId)) {
			void vscode.window.showInformationMessage('Nimbus: 動いているセッションがありません。');
			return;
		}
		const candidates = compactCandidates(retained);
		if (candidates.length === 0) {
			void vscode.window.showInformationMessage('Nimbus: 残すものを選べるだけの会話がまだありません。');
			return;
		}
		const chosen = await vscode.window.showQuickPick(
			candidates.map((candidate) => ({
				label: candidate.label,
				description: candidate.kind === 'instruction' ? '指示' : 'まとめ',
				detail: new Date(candidate.at).toLocaleTimeString('ja-JP'),
				candidate,
				picked: false
			})),
			{
				title: 'Nimbus: 圧縮後も残すものを選ぶ（選ばなければ全部おまかせ）',
				canPickMany: true,
				matchOnDescription: true
			}
		);
		if (!chosen) {
			return;
		}
		const command = buildCompactCommand(chosen.map((item) => item.candidate));
		sessions.sendMessage(activeSessionId, command);
		log(`[compact] ${chosen.length} 件を残すよう指示して圧縮します`);
	}

	/**
	 * セッションを始めるには作業フォルダが要る。
	 * 無いときの言い回しを 1 か所にまとめる（同じ案内が散ると、直すときに片方が残る）。
	 */
	function requireCwd(): string | undefined {
		const cwd = workspaceCwd(currentScope(context.workspaceState));
		if (!cwd) {
			void vscode.window.showErrorMessage('Nimbus: フォルダを開いてからセッションを開始してください。');
		}
		return cwd;
	}

	function tasksFileUri(): vscode.Uri | undefined {
		// 同期の入口なので聞かない。開いているファイルのあるルートが当たる（T-173）
		const root = resolveWorkspaceRoot()?.uri;
		return root ? vscode.Uri.joinPath(root, 'tasks.md') : undefined;
	}

	/**
	 * `tasks.md` の項目から板のタスクを作る（tasks.md T-013）。
	 * **完了済みと claim 済みは候補に出さない**（二重作業の元になる）。
	 */
	async function taskFromTasksFile(): Promise<void> {
		const uri = tasksFileUri();
		const cwd = workspaceCwd(currentScope(context.workspaceState));
		if (!uri || !cwd) {
			void vscode.window.showErrorMessage('Nimbus: フォルダを開いてください。');
			return;
		}
		let content: string;
		try {
			content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
		} catch {
			void vscode.window.showInformationMessage('Nimbus: tasks.md が見つかりませんでした。');
			return;
		}
		const candidates = startableEntries(parseTasksFile(content));
		if (candidates.length === 0) {
			void vscode.window.showInformationMessage('Nimbus: 着手できる項目がありません（完了済みか、誰かが claim 済みです）。');
			return;
		}
		const chosen = await vscode.window.showQuickPick(
			candidates.map((entry) => ({
				label: `${entry.id} ${entry.title}`,
				description: [entry.priority, entry.section].filter(Boolean).join(' · '),
				entry
			})),
			{ title: 'Nimbus: tasks.md から着手する', matchOnDescription: true }
		);
		if (!chosen) {
			return;
		}
		const prompt = await vscode.window.showInputBox({
			title: `Nimbus: ${chosen.entry.id}`,
			prompt: 'Claude への指示',
			value: chosen.entry.title
		});
		if (!prompt) {
			return;
		}
		try {
			await tasks.createTask({
				title: `${chosen.entry.id} ${chosen.entry.title}`,
				prompt,
				repoCwd: cwd,
				autoStart: true,
				// tasks.md の優先度を待機列の優先度へそのまま持ち込む
				priority: chosen.entry.priority === 'P1' ? 'high' : chosen.entry.priority === 'P3' ? 'low' : 'normal',
				sourceTaskId: chosen.entry.id
			});
			log(`[tasks.md] ${chosen.entry.id} を板へ移しました`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Nimbus: ${message}`);
		}
	}

	/** 完了したタスクの元になった tasks.md の行を、完了セクションへ移す（T-013） */
	async function offerMoveToDone(sourceTaskId: string, title: string): Promise<void> {
		const uri = tasksFileUri();
		if (!uri) {
			return;
		}
		const MOVE = 'tasks.md も完了にする';
		const choice = await vscode.window.showInformationMessage(
			`Nimbus: ${sourceTaskId} を tasks.md の 完了 へ移しますか。`,
			MOVE
		);
		if (choice !== MOVE) {
			return;
		}
		try {
			const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
			// 行ごと動かす（書き換えると、並行して編集している他のセッションとマージできなくなる）
			const updated = moveToDone(content, sourceTaskId, `${new Date().toISOString().slice(0, 10)} / ${title}`);
			if (!updated) {
				void vscode.window.showWarningMessage(`Nimbus: ${sourceTaskId} が tasks.md に見つかりませんでした。`);
				return;
			}
			await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, 'utf8'));
			log(`[tasks.md] ${sourceTaskId} を 完了 へ移しました`);
		} catch (error) {
			log(`[tasks.md] 更新に失敗: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/** 待機中タスクの優先度を変える（T-233） */
	async function setTaskPriority(taskId: string | undefined): Promise<void> {
		const pending = tasks.list().filter((task) => task.state === 'pending');
		if (pending.length === 0) {
			void vscode.window.showInformationMessage('Nimbus: 待機中のタスクがありません。');
			return;
		}
		const target =
			(taskId && pending.find((task) => task.taskId === taskId)) ??
			(
				await vscode.window.showQuickPick(
					pending.map((task) => ({
						label: task.title,
						description: PRIORITY_LABEL[task.priority ?? 'normal'],
						task
					})),
					{ title: 'Nimbus: どのタスクの優先度を変えますか' }
				)
			)?.task;
		if (!target) {
			return;
		}
		const chosen = await vscode.window.showQuickPick(
			(['high', 'normal', 'low'] as TaskPriority[]).map((priority) => ({
				label: PRIORITY_LABEL[priority],
				description: priority === 'high' ? '待機列の先頭へ' : priority === 'low' ? '後回し' : '既定',
				priority
			})),
			{ title: `Nimbus: ${target.title} の優先度` }
		);
		if (!chosen) {
			return;
		}
		tasks.setPriority(target.taskId, chosen.priority);
		log(`[task] 優先度を ${PRIORITY_LABEL[chosen.priority]} にしました: ${target.title}`);
	}

	/** テンプレートから始める（tasks.md T-148） */
	async function startFromPreset(): Promise<void> {
		const start = await pickPreset(context.globalState);
		if (!start) {
			return;
		}
		const cwd = requireCwd();
		if (!cwd) {
			return;
		}
		await newSession();
		const sessionId = randomUUID();
		activeSessionId = sessionId;
		await sessions.createSession({
			cwd,
			firstMessage: start.prompt,
			reuseSessionId: sessionId,
			extraOptions: {
				...(start.permissionMode ? { permissionMode: start.permissionMode } : {}),
				...(start.model ? { model: start.model } : {})
			}
		});
		cockpit.reveal();
		log(`[preset] テンプレートから開始しました（${start.permissionMode ?? 'default'}）`);
	}

	/**
	 * セッションの分岐（tasks.md T-036）。
	 * いまのセッションを**再開したもの**を案の数だけ作り、それぞれ別の指示を送る。
	 * 同じ地点から始まるので、比べているのは「指示の違い」だけになる。
	 */
	async function branchSession(): Promise<void> {
		const cwd = workspaceCwd(currentScope(context.workspaceState));
		const summary = activeSessionId ? sessions.get(activeSessionId) : undefined;
		if (!cwd) {
			void vscode.window.showErrorMessage('Nimbus: フォルダを開いてください。');
			return;
		}
		const plan = await planBranch(summary?.claudeSessionId, 'いまの作業');
		if (!plan) {
			return;
		}
		for (let index = 0; index < plan.prompts.length; index++) {
			try {
				// タスクとして作ると worktree が切られ、案どうしが互いを壊さない
				await tasks.createTask({
					title: plan.titles[index],
					prompt: plan.prompts[index],
					repoCwd: cwd,
					autoStart: index === 0
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				log(`[branch] ${plan.titles[index]} を作れませんでした: ${message}`);
				void vscode.window.showErrorMessage(`Nimbus: ${message}`);
				return;
			}
		}
		void vscode.window.showInformationMessage(
			`Nimbus: ${plan.prompts.length} 案をタスクとして作りました。同時実行の上限まで順に走ります。`
		);
	}

	/** 過去のセッションを再開する（tasks.md T-150） */
	async function restoreSession(): Promise<void> {
		const cwd = workspaceCwd(currentScope(context.workspaceState));
		if (!cwd) {
			void vscode.window.showErrorMessage('Nimbus: フォルダを開いてください。');
			return;
		}
		const chosen = await pickRestorable(cwd);
		if (!chosen) {
			return;
		}
		await newSession();
		const sessionId = randomUUID();
		activeSessionId = sessionId;
		await sessions.createSession({ cwd, resumeClaudeSessionId: chosen.sessionId, reuseSessionId: sessionId });
		cockpit.reveal();
		log(`[restore] ${chosen.title ?? chosen.sessionId} を再開しました`);
		void vscode.window.showInformationMessage(
			`Nimbus: 「${chosen.title ?? chosen.sessionId.slice(0, 8)}」を再開しました。続きから指示できます。`
		);
	}

	/** 枠の消費と文脈の使用量を取り直してビューへ流す */
	async function refreshUsage(sessionId: string): Promise<void> {
		if (sessionId !== activeSessionId) {
			return;
		}
		const [usage, context] = await Promise.all([sessions.getUsage(sessionId), sessions.getContextUsage(sessionId)]);
		contextPercent = context && context.maxTokens > 0 ? (context.totalTokens / context.maxTokens) * 100 : undefined;
		const budget = vscode.workspace.getConfiguration('nimbus').get<number>('context.budgetTokens') ?? 0;
		usageView.update(usage, context, retained, budget);
		if (context) {
			checkContextBudget(context.totalTokens, budget);
		}
		updateStatus(sessions.get(sessionId));
	}

	/**
	 * 文脈の予算（tasks.md T-153）。
	 * 上限で止めるのではなく、**近づいていることを言う**。圧縮という手が残っているので、
	 * 止めるより「いま圧縮しますか」と聞くほうが役に立つ。
	 */
	function checkContextBudget(usedTokens: number, budgetTokens: number): void {
		const level = thresholdLevel(usedTokens, budgetTokens);
		if (level === 'none') {
			budgetAlerted = undefined;
			return;
		}
		if (budgetAlerted === level) {
			return;
		}
		budgetAlerted = level;
		const COMPACT = '圧縮する';
		void vscode.window
			.showWarningMessage(
				level === 'over'
					? `Nimbus: 文脈が予算 ${budgetTokens.toLocaleString('en-US')} トークンを超えました。`
					: `Nimbus: 文脈が予算の 8 割に達しました（${usedTokens.toLocaleString('en-US')} / ${budgetTokens.toLocaleString('en-US')}）。`,
				COMPACT
			)
			.then((choice) => {
				if (choice === COMPACT) {
					void vscode.commands.executeCommand('nimbus.compact');
				}
			});
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
		// 状態で色を変える（T-064）。新しい配色は足さず、既にその意味を持つトークンへ寄せる
		const agentState: AgentState =
			pendingApprovals > 0
				? 'waiting-approval'
				: summary?.status === 'error'
					? 'error'
					: active.length > 0
						? 'thinking'
						: 'idle';
		const color = stateColor(agentState);
		status.backgroundColor = color ? new vscode.ThemeColor(color) : undefined;
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
		// いま何をしているかを視界の端に出す（T-056）。走っている間だけ
		const doing = runningTool(retained);
		const doingText = busy && doing ? ` · ${doing.toolName}${doing.target ? ` ${doing.target.split('/').pop()}` : ''}` : '';
		// 文脈をどれだけ使っているかは常に見えていてほしい（T-020）
		const context = contextPercent !== undefined ? ` · ${bar(contextPercent, 5)} ${Math.round(contextPercent)}%` : '';
		status.text = `${waiting}${busy ? '$(sync~spin)' : '$(cloud)'} Nimbus${doingText}${context}${cost}`;
		status.tooltip = [
			`Nimbus — ${summary.status}`,
			billingModeLabel(lastApiKeySource),
			summary.model ?? '',
			`状態: ${stateLabel(agentState)}`,
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
		// 日本語の指示は主語と対象が落ちやすい（T-090）。走り出す前に一度だけ聞く
		if (vscode.workspace.getConfiguration('nimbus').get<boolean>('clarifyVagueJapanese') !== false) {
			const vague = findVagueness(text);
			if (vague.length > 0) {
				const SEND = 'このまま送る';
				const answer = await vscode.window.showWarningMessage(
					'Nimbus: 指示が曖昧かもしれません。',
					{ modal: true, detail: `${clarificationMessage(vague)}\n\n書き足してから送ると、やり直しが減ります。` },
					SEND
				);
				if (answer !== SEND) {
					// 止めない。書き直したいだけなので、入力はそのまま残る
					return undefined;
				}
			}
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

	/**
	 * Webview から来たデータ URL を、送れる添付に整える（T-040）。
	 * 送れないものは**理由を出して落とす**（黙って消すと「貼ったのに無視された」に見える）。
	 */
	function toAttachments(images: { name: string; dataUrl: string }[] | undefined): Attachment[] {
		const attachments: Attachment[] = [];
		for (const image of images ?? []) {
			const parsed = parseDataUrl(image.dataUrl);
			if (!parsed) {
				void vscode.window.showWarningMessage(`Nimbus: ${image.name} を読み取れませんでした。`);
				continue;
			}
			const bytes = Buffer.from(parsed.base64, 'base64');
			const result = toAttachment(image.name, bytes, (raw) => Buffer.from(raw).toString('base64'));
			if (result.ok) {
				attachments.push(result.attachment);
			} else {
				void vscode.window.showWarningMessage(`Nimbus: ${image.name} は送れません — ${result.reason}`);
			}
		}
		return attachments;
	}

	async function send(rawText: string, images?: { name: string; dataUrl: string }[]): Promise<void> {
		try {
			let text = await checkBeforeSending(rawText);
			if (text === undefined) {
				return;
			}
			// 名指しされた API の実物のシグネチャを添える（T-175）。推測で書かせないための前段
			const signatures = await buildSignatureNote(text);
			text = signatures ? `${text}\n\n${signatures}` : text;
			// 使っているライブラリのバージョンを添える（T-083）。記憶で書かせない
			const grounding = await buildGroundingForPrompt(text);
			text = grounding ? `${text}\n\n${grounding}` : text;
			repeats.record(rawText);
			// 利用者が新しい指示を出したら、自動リロードの周回数を戻す
			reloadRounds = 0;
			const attachments = toAttachments(images);
			if (attachments.length > 0) {
				log(`[send] ${describeAttachments(attachments)} を添えます`);
			}
			// 停止済みのセッションへ送らない。緊急停止のあとは新しいセッションとして始める
			if (activeSessionId && sessions.isAccepting(activeSessionId)) {
				sessions.sendMessage(activeSessionId, text, attachments);
				return;
			}
			const cwd = requireCwd();
			if (!cwd) {
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
			await sessions.createSession({ cwd, firstMessage: text, firstImages: attachments, reuseSessionId: sessionId });
			log(`[session] 新規セッション ${sessionId} cwd=${cwd}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log(`[session] 送信に失敗: ${message}`);
			if (isTransientFailure(message)) {
				// 繋がらない類の失敗だけ預かる。書き方の誤りは送り直しても同じ結果になる
				outbox.add(rawText, message, Date.now());
				const RETRY = '送り直す';
				void vscode.window
					.showWarningMessage(`Nimbus: 送れなかったので預かりました（${describeOutbox(outbox)}）。`, RETRY)
					.then((choice) => {
						if (choice === RETRY) {
							void flushOutbox();
						}
					});
				return;
			}
			void vscode.window.showErrorMessage(`Nimbus: ${message}`);
		}
	}

	/** 預かっている入力を順に送り直す（T-151）。出すかどうかは利用者が決める */
	async function flushOutbox(): Promise<void> {
		const queued = outbox.drain();
		if (queued.length === 0) {
			void vscode.window.showInformationMessage('Nimbus: 預かっている入力はありません。');
			return;
		}
		log(`[outbox] ${queued.length} 件を送り直します`);
		for (const item of queued) {
			await send(item.text);
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
		verifier.reset();
		repeats.reset();
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
				cwd: workspaceCwd(currentScope(context.workspaceState)) ?? context.extensionUri.fsPath,
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
		const cwd = workspaceCwd(currentScope(context.workspaceState));
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
		const sourceTaskId = task.sourceTaskId;
		const { wipCommit } = await tasks.completeTask(taskId);
		if (sourceTaskId) {
			void offerMoveToDone(sourceTaskId, task.title);
		}
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

	// 関数の上に「Nimbus に頼む」を出す（T-172）。右クリックからも同じ入口（T-171）
	const codeLens = new NimbusCodeLensProvider();

	// 走っている最中に「また同じことを言っている」に気づく（T-237）
	const repeats = new SessionRepeats({
		promote: (text) => promoteInstruction(claudeMdView, text),
		log
	});

	// コピーしたエラー文に気づいて聞く（T-170・既定は無効）
	const clipboardHints = new ClipboardHints({
		send: (text) => {
			cockpit.reveal();
			void send(text);
		},
		log
	});

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

	// 生成直後に型を当て、そのターンで増えたエラーだけを差し戻す（T-101）。
	// 存在しない API を呼んだことに、ビルドを回すより先に気づける
	const verifier = new EditVerifier({ send: (text) => void send(text), log });

	context.subscriptions.push(
		output,
		status,
		stopButton,
		previewer,
		terminals,
		clipboardHints,
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
		// エージェント抜きでツールを 1 回だけ呼ぶ（T-235）
		// 拡張が足した指示を選んで送る（T-092）
		vscode.commands.registerCommand('nimbus.pluginActions', async () => {
			const text = await pluginApi.pickAction();
			if (text) {
				cockpit.reveal();
				void send(text);
			}
		}),
		vscode.commands.registerCommand('nimbus.runMcpTool', () =>
			runMcpToolOnce({ log, servers: inProcessMcpServers })
		),
		vscode.window.registerTreeDataProvider('nimbus.settings', settingsView),
		vscode.window.registerTreeDataProvider('nimbus.timeline', timelineView),
		vscode.commands.registerCommand('nimbus.showAuditLog', () => showAuditLog()),
		// 見積もり（T-187）と、決めたことの記録（T-060 / T-188 / T-189）
		vscode.commands.registerCommand('nimbus.estimate', () => showEstimate()),
		// ワークフロー（T-149）・解説モード（T-045）・チーム設定の同期（T-049）
		// 回帰テスト・ブレ幅・モデル比較（T-165 / T-166 / T-167）
		// ペルソナ（T-063）と、書く番の切り替え（T-190 / T-191）
		// ローカル完結（T-077）・立て直し（T-088）
		// 他ツールからの取り込み（T-068）・ワンクリック導入（T-071）・実機ログ（T-074）
		vscode.commands.registerCommand('nimbus.importOtherToolRules', () => importOtherToolRules({ log })),
		vscode.commands.registerCommand('nimbus.installFromUrl', () => installFromUrl()),
		vscode.commands.registerCommand('nimbus.pasteCrashLog', () => pasteCrashLog()),
		// 週のふりかえり（T-097）
		vscode.commands.registerCommand('nimbus.weeklyReview', () => showWeeklyReview()),
		vscode.commands.registerCommand('nimbus.localOnly', () => toggleLocalOnly()),
		vscode.commands.registerCommand('nimbus.recover', () => offerRecovery()),
		vscode.commands.registerCommand('nimbus.persona', () => choosePersona()),
		vscode.commands.registerCommand('nimbus.turnMode', () => chooseTurnMode()),
		vscode.commands.registerCommand('nimbus.evaluate', () => evaluate()),
		// スキル・サブエージェント・コマンドを書く支援（T-030 / T-031）
		vscode.languages.registerCompletionItemProvider({ language: 'markdown' }, createCompletionProvider(), ':', '\n'),
		authoringDiagnostics,
		vscode.workspace.onDidSaveTextDocument((document) => validateDocument(document, authoringDiagnostics)),
		vscode.workspace.onDidOpenTextDocument((document) => validateDocument(document, authoringDiagnostics)),
		vscode.commands.registerCommand('nimbus.previewSkill', async () => {
			const editor = vscode.window.activeTextEditor;
			const cwd = requireCwd();
			if (!editor || !cwd) {
				return;
			}
			await previewRun(sessions, cwd, editor.document, log);
		}),
		vscode.commands.registerCommand('nimbus.runWorkflow', () => startWorkflow()),
		vscode.commands.registerCommand('nimbus.nextWorkflowStep', () => runNextWorkflowStep()),
		vscode.commands.registerCommand('nimbus.explainMode', () => void send(EXPLAIN_MODE_PROMPT)),
		vscode.commands.registerCommand('nimbus.syncTeam', () => syncTeamBundle(log, false)),
		vscode.commands.registerCommand('nimbus.compareOptions', () => void send(COMPARE_OPTIONS_PROMPT)),
		vscode.commands.registerCommand('nimbus.recordDisagreement', () => recordDisagreement()),
		// 設定のパッケージ配布（T-043）
		vscode.commands.registerCommand('nimbus.exportBundle', () => exportBundle((text) => sanitizer.detect(text), log)),
		vscode.commands.registerCommand('nimbus.importBundle', () => importBundle(log)),
		// 設定が変わったら設定タブを出し直す
		vscode.workspace.onDidSaveTextDocument((document) => {
			// マニフェストを直したら、添えるバージョンも取り直す（T-083）
			if (/(package\.json|pubspec\.yaml|go\.mod)$/.test(document.uri.path)) {
				clearDependencyCache();
			}
		}),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('nimbus')) {
				settingsView.reload();
			}
		}),
		// 過去セッションの横断検索（T-034）。読むのは Claude Code 本体の記録で、Nimbus は書かない
		vscode.commands.registerCommand('nimbus.searchTranscripts', () => searchTranscripts(log)),
		vscode.commands.registerCommand('nimbus.pinnedFiles', () => managePinnedFiles()),
		// テンプレートから始める（T-148）
		// tasks.md から板へ（T-013）
		// 圧縮前に残すものを選ぶ（T-154）
		// サブエージェントごとのモデル指定（T-232）
		// プロンプトライブラリ（T-035）
		vscode.commands.registerCommand('nimbus.prompts', () => usePromptTemplate()),
		vscode.commands.registerCommand('nimbus.managePrompts', () => managePromptTemplates()),
		// スキル以外も同じ場所から探す（T-117）
		vscode.commands.registerCommand('nimbus.findAnything', () => findAnything()),
		// 送れなかった入力（T-151）
		// フックの組み立てとドライラン（T-026 / T-161）
		vscode.commands.registerCommand('nimbus.hooks', () => manageHooks(log)),
		vscode.commands.registerCommand('nimbus.hookDryRun', () => dryRunHook(log)),
		// 承認ポリシーのプロファイル（T-162 / T-163）
		vscode.commands.registerCommand('nimbus.switchPolicy', () => switchPolicy()),
		vscode.commands.registerCommand('nimbus.flushOutbox', () => flushOutbox()),
		// うまくいった流れをスキルにする（T-168）
		vscode.commands.registerCommand('nimbus.sessionToSkill', () => sessionToSkill()),
		// タスクのピン留めとタグ（T-147）
		vscode.commands.registerCommand('nimbus.pinTask', (node?: { taskId?: string }) => pinTask(node?.taskId)),
		vscode.commands.registerCommand('nimbus.tagTask', (node?: { taskId?: string }) => tagTask(node?.taskId)),
		vscode.commands.registerCommand('nimbus.agentModels', () => assignAgentModels()),
		vscode.commands.registerCommand('nimbus.compactWithSelection', () => compactWithSelection()),
		vscode.commands.registerCommand('nimbus.taskFromFile', () => taskFromTasksFile()),
		// 待機列の優先度（T-233）
		vscode.commands.registerCommand('nimbus.setTaskPriority', (node?: { taskId?: string }) =>
			setTaskPriority(node?.taskId)
		),
		vscode.commands.registerCommand('nimbus.startFromPreset', () => startFromPreset()),
		vscode.commands.registerCommand('nimbus.managePresets', () => managePresets(context.globalState)),
		// 同じ地点から A 案・B 案（T-036）
		vscode.commands.registerCommand('nimbus.branchSession', () => branchSession()),
		// 過去のセッションを再開（T-150）
		vscode.commands.registerCommand('nimbus.restoreSession', () => restoreSession()),
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
		vscode.commands.registerCommand('nimbus.editProtectedPaths', () => editProtectedPaths()),
		vscode.commands.registerCommand('nimbus.openDigest', () => openDigest()),
		vscode.commands.registerCommand('nimbus.explainLockDiff', () => explainLockDiff()),
		vscode.commands.registerCommand('nimbus.openFromStackTrace', () => openFromStackTrace()),
		vscode.commands.registerCommand('nimbus.draftReleaseNotes', () => draftReleaseNotes()),
		vscode.commands.registerCommand('nimbus.openChangeStats', () => openChangeStats()),
		vscode.commands.registerCommand('nimbus.openCodeHealth', () => openCodeHealth()),
		vscode.commands.registerCommand('nimbus.openBranchHealth', () => openBranchHealth()),
		vscode.commands.registerCommand('nimbus.draftPrDescription', () => draftPrDescription()),
		vscode.commands.registerCommand('nimbus.bisect', () => bisect(context)),
		vscode.commands.registerCommand('nimbus.openMobileChecks', () => openMobileChecks()),
		vscode.commands.registerCommand('nimbus.openFlutterLint', () => openFlutterLint()),
		vscode.commands.registerCommand('nimbus.measureBuild', () => measureBuild(context)),
		vscode.commands.registerCommand('nimbus.resolveXcodeConflict', () => resolveXcodeConflict()),
		vscode.commands.registerCommand('nimbus.openDepConsistency', () => openDepConsistency()),
		vscode.commands.registerCommand('nimbus.openReviewProgress', () => openReviewProgress(context)),
		vscode.commands.registerCommand('nimbus.openPlatformChannels', () => openPlatformChannels()),
		vscode.commands.registerCommand('nimbus.generateFromSchema', () => generateFromSchema()),
		vscode.commands.registerCommand('nimbus.createSandbox', () => createSandbox()),
		vscode.commands.registerCommand('nimbus.scheduleRun', () => scheduleRun(context)),
		vscode.commands.registerCommand('nimbus.showSchedule', () => showSchedule(context)),
		vscode.commands.registerCommand('nimbus.openPromptStats', () => openPromptStats()),
		vscode.commands.registerCommand('nimbus.openLicenses', () => openLicenses()),
		vscode.commands.registerCommand('nimbus.openHighlights', () => openHighlights()),
		vscode.commands.registerCommand('nimbus.draftReviewRequest', () => draftReviewRequest()),
		vscode.commands.registerCommand('nimbus.openExplanation', () => openExplanation()),
		vscode.commands.registerCommand('nimbus.importReviewComments', () => importReviewComments((text) => void send(text))),
		vscode.commands.registerCommand('nimbus.shareSession', () => shareSession()),
		vscode.commands.registerCommand('nimbus.openReplay', () => openReplay()),
		vscode.commands.registerCommand('nimbus.checkMermaid', () => checkMermaidDiagrams()),
		vscode.commands.registerCommand('nimbus.runSetupWizard', () => runSetupWizard()),
		vscode.commands.registerCommand('nimbus.openEnvCheck', () => openEnvCheck()),
		vscode.commands.registerCommand('nimbus.auditDependency', () => auditDependency()),
		vscode.commands.registerCommand('nimbus.openVulnFixPlan', () => openVulnFixPlan()),
		vscode.commands.registerCommand('nimbus.checkSql', () => checkSql()),
		vscode.commands.registerCommand('nimbus.openCiRepro', () => openCiRepro()),
		vscode.commands.registerCommand('nimbus.openMigrationPlan', () => openMigrationPlan()),
		vscode.commands.registerCommand('nimbus.openPreflight', () => openPreflight()),
		// 仕込んだものは Nimbus が開いている間だけ見張る（常駐はしない）
		watchSchedule(context, (prompt, autoApprove) => {
			void (async () => {
				await newSession();
				await send(prompt);
				// 承認を自動で通すのは、仕込むときに明示的に選ばれたときだけ（T-051）
				if (autoApprove && activeSessionId) {
					sessionAllowAll.add(activeSessionId);
				}
			})();
		}),
		vscode.commands.registerCommand('nimbus.checkApiResponse', () => checkApiResponse()),
		vscode.commands.registerCommand('nimbus.generateMockResponse', () => generateMockResponse()),
		vscode.commands.registerCommand('nimbus.openRhythm', () =>
			openRhythm(context, () => ({ running: sessions.list().filter((s) => s.status === 'running').length, pending: pendingApprovals }))
		),
		vscode.commands.registerCommand('nimbus.promoteInstruction', (node?: { item?: { text?: string } }) =>
			promoteInstruction(claudeMdView, node?.item?.text ?? '')
		),
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
		// 開いている Dart から Widget / ゴールデンテストの雛形を作る（T-193）
		vscode.commands.registerCommand('nimbus.generateWidgetTest', () => generateWidgetTest()),
		// 作業ツリーの変更を意図ごとに束ねて見せる（T-114）
		vscode.commands.registerCommand('nimbus.proposeCommitSplit', () => proposeCommitSplit()),
		// 監視ツールの障害をセッションへ（T-142）
		vscode.commands.registerCommand('nimbus.importMonitoredIssue', () =>
			importMonitoredIssue((text) => {
				cockpit.reveal();
				void send(text);
			})
		),
		// ログから、まず落ちるテストを起こす（T-143）
		vscode.commands.registerCommand('nimbus.reproduceFromLog', () =>
			reproduceFromLog((text) => {
				cockpit.reveal();
				void send(text);
			})
		),
		// 改善前後のベンチを比べる（T-130）
		vscode.commands.registerCommand('nimbus.compareBenchmarks', () => compareBenchmarks()),
		// 元を直したら生成物も作り直す（T-141）
		vscode.commands.registerCommand('nimbus.regenerate', () => regenerateNow()),
		watchForRegeneration(log),
		// テストを何度か回して揺れているものを見つける（T-133）
		vscode.commands.registerCommand('nimbus.findFlakyTests', () => findFlakyTests()),
		// PR のレビュー指摘をセッションへ（T-116）
		vscode.commands.registerCommand('nimbus.importPrReview', () =>
			importPrReview((text) => {
				cockpit.reveal();
				void send(text);
			})
		),
		// 溜まった承認ルールを見返して減らす（T-028）
		vscode.commands.registerCommand('nimbus.editPermissionRules', () => editPermissionRules()),
		// 消した export の呼び出し元を先に見せる（T-158）
		vscode.commands.registerCommand('nimbus.showImpact', () => showImpact()),
		// 差分を読む前の見取り図（T-157）
		vscode.commands.registerCommand('nimbus.showDiffSummary', () =>
			showDiffSummary((text) => {
				cockpit.reveal();
				void send(text);
			})
		),
		// 競合を 1 件ずつ解決する。判断がつかないものは Claude に相談文を投げる（T-115）
		reviewTree,
		reviewView,
		// どこまで見たか（T-160）
		vscode.commands.registerCommand('nimbus.refreshReview', async () => {
			await reviewView.refresh();
			reviewTree.description = reviewView.progressLabel();
		}),
		vscode.commands.registerCommand('nimbus.markReviewed', async (entry?: ReviewEntry) => {
			if (entry) {
				await reviewView.setReviewed(entry, true);
				reviewTree.description = reviewView.progressLabel();
			}
		}),
		vscode.commands.registerCommand('nimbus.markUnreviewed', async (entry?: ReviewEntry) => {
			if (entry) {
				await reviewView.setReviewed(entry, false);
				reviewTree.description = reviewView.progressLabel();
			}
		}),
		vscode.commands.registerCommand('nimbus.clearReviewMarks', async () => {
			await reviewView.clearAll();
			reviewTree.description = reviewView.progressLabel();
		}),
		// 行をクリックしたら差分を開く。印だけの画面にしないため
		vscode.commands.registerCommand('nimbus.openReviewDiff', async (entry?: ReviewEntry) => {
			const cwd = workspaceCwd(currentScope(context.workspaceState));
			if (!entry || !cwd) {
				return;
			}
			const uri = vscode.Uri.file(`${cwd}/${entry.path}`);
			try {
				// git 側（HEAD）と作業ツリーを並べる。SCM 拡張の gitScheme を使う
				await vscode.commands.executeCommand('git.openChange', uri);
			} catch {
				// git 拡張が無い場合はファイルを開くだけにする（見られないよりよい）
				await vscode.window.showTextDocument(uri, { preview: true });
			}
		}),
		vscode.commands.registerCommand('nimbus.assistConflicts', () =>
			assistConflicts((text) => {
				cockpit.reveal();
				void send(text);
			})
		),
		// エディタから直接頼む（T-171 / T-172）。ファイル名も行番号も打ち直さない
		vscode.commands.registerCommand(
			'nimbus.askAboutSelection',
			(args?: { uri: string; startLine: number; endLine: number; symbol?: string }) =>
				askAboutSelection(
					{
						send: (text) => {
							cockpit.reveal();
							void send(text);
						}
					},
					args
				)
		),
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLens),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('nimbus.editor.codeLens')) {
				codeLens.refresh();
			}
		}),
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
		vscode.commands.registerCommand('nimbus.verifyEdits', () => {
			if (!verifier.sendLast()) {
				void vscode.window.showInformationMessage('Nimbus: 差し戻す型エラーはありません。');
			}
		}),
		// モノレポで作業対象のパッケージだけを見せる（T-078）
		vscode.commands.registerCommand('nimbus.chooseScope', () =>
			chooseScope({ storage: context.workspaceState, log })
		),
		// ドキュメントの無いコードから仕様書を起こす（T-080）
		vscode.commands.registerCommand('nimbus.reverseSpec', () =>
			reverseSpec({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log
			})
		),
		// このコードがなぜこうなっているのかを辿る（T-079）
		vscode.commands.registerCommand('nimbus.exploreHistory', () =>
			exploreHistory({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log
			})
		),
		// 落ちた CI のログを取りに行って切り分けさせる（T-131）
		vscode.commands.registerCommand('nimbus.investigateCi', () =>
			investigateCi({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log
			})
		),
		// 声で指示する（T-055）
		vscode.commands.registerCommand('nimbus.dictateInstruction', () =>
			dictateInstruction({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log
			})
		),
		// 自分のスキルを配れる形にする（T-070）
		vscode.commands.registerCommand('nimbus.packageSkills', () => packageSkills({ log })),
		// 作業の様子を GIF にする（T-223）
		vscode.commands.registerCommand('nimbus.exportGif', () => exportGif({ log })),
		// プラグインの一覧と有効／無効（T-032）
		vscode.commands.registerCommand('nimbus.managePlugins', () => managePlugins({ log })),
		// ターミナルを好きな数に並べる（T-014）
		vscode.commands.registerCommand('nimbus.splitTerminals', () => splitTerminals({ log })),
		// 計測結果を渡して、重いところを見つけさせる（T-128）
		vscode.commands.registerCommand('nimbus.importCpuProfile', () =>
			importCpuProfile({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log
			})
		),
		// 声で指示する。危ないことは音声で実行しない（T-055）
		vscode.commands.registerCommand('nimbus.listenForCommand', () =>
			listenForCommand({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log,
				runTests: () => void vscode.commands.executeCommand('nimbus.runImpactedTests'),
				showStatus: () => cockpit.reveal(),
				stopAll: () => void vscode.commands.executeCommand('nimbus.stopAll')
			})
		),
		// マシンをまたいで続ける。入れる前に手元と突き合わせる（T-085）
		vscode.commands.registerCommand('nimbus.exportSession', () =>
			exportSession({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log,
				activeSessionId: () => activeSessionId
			})
		),
		vscode.commands.registerCommand('nimbus.importSession', () =>
			importSession({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log,
				activeSessionId: () => activeSessionId
			})
		),
		// 同じ Wi-Fi の中から承認だけする。できるのは許す・断るだけ（T-054 / T-086）
		remoteApproval,
		vscode.commands.registerCommand('nimbus.toggleRemoteApproval', () => remoteApproval.toggle()),
		// 書いたものを社内 Wiki に貼れる形にする。貼るのは人（T-208）
		vscode.commands.registerCommand('nimbus.exportToWiki', () => exportToWiki({ log })),
		// 画面を撮って渡す・流れを integration_test に起こす（T-073）
		vscode.commands.registerCommand('nimbus.captureSimulator', () =>
			captureSimulator({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log
			})
		),
		vscode.commands.registerCommand('nimbus.writeFlowTest', () =>
			writeFlowTest({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log
			})
		),
		// 別のツールの結果と並べる。どちらが良いかは言わない（T-069）
		vscode.commands.registerCommand('nimbus.compareAgentWork', () =>
			compareAgentWork({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log
			})
		),
		// メモリの増え方と起動時間。前と比べて初めて言えること（T-222）
		vscode.commands.registerCommand('nimbus.trackMemory', () =>
			trackMemory({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log,
				state: context.workspaceState
			})
		),
		vscode.commands.registerCommand('nimbus.measureStartup', () =>
			measureStartup({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log,
				state: context.workspaceState
			})
		),
		// 積み上げた PR の順と、下が入った後の付け替え（T-135）
		vscode.commands.registerCommand('nimbus.showPrStack', () => showPrStack({ log })),
		vscode.commands.registerCommand('nimbus.restackAfterMerge', () => restackAfterMerge({ log })),
		// 戻す手順を出す。走らせない（T-216）
		vscode.commands.registerCommand('nimbus.prepareRollback', () => prepareRollback({ log })),
		// 急ぐときの手順。省かない段は省かない（T-144）
		vscode.commands.registerCommand('nimbus.planHotfix', () => planHotfix({ log })),
		// 触ったファイルの持ち主（CODEOWNERS）を出す。投げるのは人（T-221）
		vscode.commands.registerCommand('nimbus.notifyCodeOwners', () => notifyCodeOwners({ log })),
		vscode.commands.registerCommand('nimbus.showOwnersOfActiveFile', () =>
			showOwnersOfActiveFile({ log })
		),
		// 変えた型を参照している場所が壊れていないかを確かめさせる（T-123）
		vscode.commands.registerCommand('nimbus.trackSchemaImpact', () =>
			trackSchemaImpact({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log
			})
		),
		// 変えた名前に触れている古い文書を挙げる（T-209）
		vscode.commands.registerCommand('nimbus.checkApiDocs', () =>
			checkApiDocs({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log
			})
		),
		// 会話で決まったことを ADR として残す（T-060）
		vscode.commands.registerCommand('nimbus.writeAdr', () =>
			writeAdr({
				transcript: () =>
					retained
						.filter((event) => event.kind === 'assistant-text' || event.kind === 'user-text')
						.map((event) => (event as { text: string }).text),
				instructions: () =>
					retained.filter((event) => event.kind === 'user-text').map((event) => (event as { text: string }).text),
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log
			})
		),
		// 一度うまく書けた形はエディタ側に置く（T-177）
		vscode.commands.registerCommand('nimbus.saveSnippet', () => saveSelectionAsSnippet({ log })),
		// テストが本当に守っているかを、わざと壊して確かめる（T-182）
		vscode.commands.registerCommand('nimbus.checkMutations', () =>
			checkMutations({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log
			})
		),
		// 破壊的変更への追従は、まとまりに分けて間にテストを挟ませる（T-110）
		vscode.commands.registerCommand('nimbus.planBulkChange', () =>
			planBulkChange({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log,
				track: async (pattern, label) => {
					const initial = await addRefactorTrack(context.workspaceState, pattern, label);
					if (initial > 0) {
						void vscode.window.showInformationMessage(
							`Nimbus: 「${label}」を追いかけます（いま ${initial} 箇所）。`
						);
					}
				}
			})
		),
		// 既存のファイルを数えて、このリポジトリの書き方を渡す（T-103）
		vscode.commands.registerCommand('nimbus.projectConventions', () =>
			showConventions({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log
			})
		),
		// 移行の前に、いまの振る舞いを写したテストを書かせる（T-179）
		vscode.commands.registerCommand('nimbus.captureBehavior', () =>
			captureBehavior({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log
			})
		),
		vscode.commands.registerCommand('nimbus.verifyEquivalence', () =>
			verifyEquivalence({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log
			})
		),
		// スナップショットは通すために更新できてしまう（T-181）。更新そのものをレビューする
		vscode.commands.registerCommand('nimbus.reviewSnapshots', () =>
			reviewSnapshots({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log
			})
		),
		// 何のプロジェクトで、どこに何があるか（T-176）。最初の探索を省くための地図
		vscode.commands.registerCommand('nimbus.repoSummary', () =>
			showRepoSummary({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log
			})
		),
		// 段階的リファクタの進捗（T-111）。残りの数が見えないと、大きな置き換えは途中で止まる
		vscode.commands.registerCommand('nimbus.trackRefactor', () =>
			startRefactorTrack({ storage: context.workspaceState, send: (text) => void send(text), log })
		),
		vscode.commands.registerCommand('nimbus.refactorProgress', () =>
			showRefactorProgress({
				storage: context.workspaceState,
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log
			})
		),
		// 変更に関係するテストだけを走らせる（T-180）
		vscode.commands.registerCommand('nimbus.runImpactedTests', () => runImpactedTests({ log })),
		// 先に落ちるテストを書かせて、赤 → 緑になるまで回す（T-107）
		vscode.commands.registerCommand('nimbus.startFromFailingTest', async () => {
			const goal = await vscode.window.showInputBox({
				title: 'Nimbus: 失敗するテストから始める',
				prompt: '何を作りますか（先にテストを書かせます）',
				placeHolder: '例: 期限切れのトークンを弾く'
			});
			if (!goal) {
				return;
			}
			cockpit.reveal();
			await send(buildFailingTestPrompt(goal));
		}),
		// この変更で足した行がテストされているか（T-109）
		vscode.commands.registerCommand('nimbus.coverageDiff', () =>
			showCoverageDiff({
				send: (text) => {
					cockpit.reveal();
					void send(text);
				},
				log
			})
		),
		new vscode.Disposable(() => sessions.closeAll())
	);

	void vscode.commands.executeCommand('setContext', 'nimbus.approvalQueueMode', isApprovalQueueMode());

	// 組織の制限が効いているなら、起動時に一度だけ言う（見えない制限を作らない・T-212）
	const managed = managedPolicy();
	if (hasManagedPolicy(managed)) {
		for (const line of describeManagedPolicy(managed)) {
			log(`[policy] ${line}`);
		}
	}

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

	// 他の拡張へ渡す口（T-092）。`activate()` の戻り値が公開面になる
	return pluginApi;
}

export function deactivate(): void {
	// セッションの後始末は context.subscriptions の Disposable で行う
}

function workspaceCwd(scope?: string): string | undefined {
	// 作業対象を絞っていれば、そこをセッションの作業ディレクトリにする（T-078）
	if (scope) {
		return scope;
	}
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
function buildOptions(
	pinned: readonly PinnedFile[] = [],
	agentFiles: readonly AgentFile[] = [],
	profile?: PolicyProfile,
	personaInstruction = ''
): Partial<Options> {
	const options: Partial<Options> = { settingSources: [] };
	// 承認ポリシー（T-162）と、危ないことを試すときの器（T-163）
	if (profile) {
		options.permissionMode = profile.permissionMode;
		const sandbox = toSdkSandbox(profile.sandbox);
		if (sandbox) {
			// SDK の SandboxSettings は zod 由来。ここでは必要なぶんだけを渡す
			options.sandbox = sandbox as Options['sandbox'];
		}
	}
	// サブエージェントごとのモデル（T-232）。**割り当てが 1 つも無ければ渡さない** —
	// 渡すと、利用者の定義を Nimbus が組み直したもので置き換えることになる
	const agentModels = vscode.workspace.getConfiguration('nimbus').get<Record<string, string>>('agents.models') ?? {};
	const overrides = buildAgentOverrides(agentFiles, agentModels);
	if (Object.keys(overrides).length > 0) {
		options.agents = overrides;
	}
	// 常に含めるファイル（T-152）。preset に **足す** ので Claude Code の振る舞いは残る。
	// 上限を超えたぶんは黙って切らず、外したことを利用者へ伝える
	const selection = selectWithinBudget(pinned);
	// ピン留め（T-152）と話しかた（T-063）を、preset に **足す** 形でまとめて渡す
	const appended = [personaInstruction, buildPinnedPrompt(selection.included)].filter(Boolean).join('\n\n');
	if (appended) {
		options.systemPrompt = { type: 'preset', preset: 'claude_code', append: appended };
	}
	if (selection.dropped.length > 0) {
		void vscode.window.showWarningMessage(
			`Nimbus: ピン留めが大きすぎるため ${selection.dropped.length} 件を外しました（${selection.dropped.join(', ')}）。`
		);
	}
	const executable = resolveClaudeExecutable();
	if (executable) {
		options.pathToClaudeCodeExecutable = executable;
	}
	// LSP をツールとして渡す（T-098）。定義・参照・型を grep の総当たりより正確に引ける。
	// 拡張ホストの中で動く MCP サーバーなので、別プロセスは立たない
	if (vscode.workspace.getConfiguration('nimbus').get<boolean>('lsp.enabled') !== false) {
		options.mcpServers = { ...options.mcpServers, [LSP_SERVER_NAME]: lspMcpServer() };
	}
	// 止まっているデバッガの値を読ませる（T-104）。読むだけで、式の評価はさせない
	if (vscode.workspace.getConfiguration('nimbus').get<boolean>('debug.exposeState') !== false) {
		options.mcpServers = { ...options.mcpServers, [DEBUG_SERVER_NAME]: debugMcpServer() };
	}
	return options;
}

/**
 * プロセス内で動いている Nimbus 自身の MCP サーバー（T-235 の単体実行用）。
 * セッションへ渡すものと**同じ実体**を返す — 別に作ると、
 * 「単体では通るのにセッションでは違う」が起きる。
 */
function inProcessMcpServers(): { name: string; config: McpSdkServerConfigWithInstance }[] {
	const configuration = vscode.workspace.getConfiguration('nimbus');
	const servers: { name: string; config: McpSdkServerConfigWithInstance }[] = [];
	if (configuration.get<boolean>('lsp.enabled') !== false) {
		servers.push({ name: LSP_SERVER_NAME, config: lspMcpServer() });
	}
	if (configuration.get<boolean>('debug.exposeState') !== false) {
		servers.push({ name: DEBUG_SERVER_NAME, config: debugMcpServer() });
	}
	return servers;
}
