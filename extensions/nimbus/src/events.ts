/**
 * Nimbus 正規化イベント。
 *
 * SDK の生ストリームはここで定義した型に正規化してから、Webview・ログ・（将来の）永続化へ流す。
 * SDK の型変更の影響を `session/normalize.ts` とこのファイルに閉じ込めるのが狙い。
 * 全イベントが sessionId（Nimbus 内部 ID。SDK の session_id とは別）を持つ＝多重セッション前提。
 *
 * 旧 Electron 版では IPC 境界の検証に zod スキーマを使っていたが、拡張ホスト内では
 * プロセス境界が無く、Webview との境界は自前の型付きメッセージで足りるため素の型にしてある。
 */

export type SessionStatus =
	| 'starting'
	| 'running'
	| 'awaiting-input'
	| 'interrupted'
	| 'completed'
	| 'error';

interface EventBase {
	sessionId: string;
	timestamp: number;
}

/** SDK init メッセージ（type:'system', subtype:'init'）由来 */
export interface SessionInitEvent extends EventBase {
	kind: 'session-init';
	claudeSessionId: string;
	claudeCodeVersion: string;
	model: string;
	cwd: string;
	permissionMode: string;
	/** SDK 実測 enum: 'user' | 'project' | 'org' | 'temporary' | 'oauth' | 'none'（課金モード表示に使う） */
	apiKeySource: string;
	tools: string[];
	mcpServers: { name: string; status: string }[];
	plugins: { name: string; version?: string }[];
	skills: string[];
	slashCommands: string[];
	agents?: string[];
}

/** ユーザー入力（Nimbus 自身が送ったもの。表示の正はこちら） */
export interface UserTextEvent extends EventBase {
	kind: 'user-text';
	text: string;
	/**
	 * このとき走らせていたモデル（T-367 ①）。指示を直すとき、**そのときのモデルへ戻す**ために要る。
	 * 会話の途中で `setModel()` できるので、いまのモデルとは限らない。
	 */
	model?: string;
	/**
	 * このとき付けていた添付の**枚数だけ**（T-367 ①）。
	 *
	 * **実体（dataUrl）はここに置かない。** 画像は 1 枚 5MB まで許しているので、
	 * 会話の控え（`retained`）に載せると、面を開き直すたびに丸ごと送り直すことになる。
	 * 枚数だけでも「付け直しが要る」ことは言えるので、黙って失うよりずっとよい。
	 * 実体の復元は、控えとは別の器を用意してから（T-377）。
	 */
	attachmentCount?: number;
}

export interface AssistantTextEvent extends EventBase {
	kind: 'assistant-text';
	text: string;
}

export interface AssistantThinkingEvent extends EventBase {
	kind: 'assistant-thinking';
	text: string;
}

export interface ToolUseEvent extends EventBase {
	kind: 'tool-use';
	toolUseId: string;
	toolName: string;
	input: unknown;
}

export interface ToolResultEvent extends EventBase {
	kind: 'tool-result';
	toolUseId: string;
	isError: boolean;
	preview: string;
}

/**
 * SDK result メッセージ由来（sdk.d.ts 実測）:
 * - totalCostUsd はセッション内累積。ただしクラッシュ系 result はゼロを載せることがある
 * - usage はそのターンのみ・メインループのみで、累積ではない
 */
export interface TurnResultEvent extends EventBase {
	kind: 'turn-result';
	subtype: string;
	isError: boolean;
	numTurns: number;
	durationMs: number;
	totalCostUsd?: number;
	usage?: {
		inputTokens: number;
		outputTokens: number;
		cacheCreationInputTokens?: number;
		cacheReadInputTokens?: number;
	};
	resultText?: string;
}

export interface StatusEvent extends EventBase {
	kind: 'status';
	status: SessionStatus;
	detail?: string;
}

/**
 * フックの発火（tasks.md T-027）。「なんでブロックされたの？」に答えるための材料。
 * SDK の `hook_started` / `hook_progress` / `hook_response` をまとめて 1 種類にする
 * （見たいのは「どのフックが何を返したか」であって、SDK の内部段階ではない）。
 */
export interface HookEvent extends EventBase {
	kind: 'hook';
	hookId: string;
	/** フックの名前（設定に書いたコマンド名） */
	hookName: string;
	/** PreToolUse / PostToolUse / UserPromptSubmit など */
	hookEvent: string;
	phase: 'started' | 'progress' | 'response';
	outcome?: 'success' | 'error' | 'cancelled';
	exitCode?: number;
	output?: string;
	stderr?: string;
}

/**
 * サブエージェントの実行（tasks.md T-018）。
 * サブエージェントは独立した文脈で動き、親には最終サマリーしか返らない。
 * 「中で何が起きたか」を覗くために、開始・進捗・終了をここへ流す。
 */
export interface SubagentEvent extends EventBase {
	kind: 'subagent';
	taskId: string;
	phase: 'started' | 'progress' | 'updated';
	description?: string;
	subagentType?: string;
	prompt?: string;
	status?: 'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'paused';
	error?: string;
	/** いま使っているツール（進捗表示に使う） */
	lastToolName?: string;
	summary?: string;
	usage?: { totalTokens: number; toolUses: number; durationMs: number };
}

/**
 * 巻き戻し先の候補（tasks.md T-025）。ユーザーの発言 1 つが 1 つのチェックポイント。
 * SDK が付けたメッセージ UUID はストリーム上でしか手に入らないので、ここで拾って持っておく。
 */
export interface CheckpointEvent extends EventBase {
	kind: 'checkpoint';
	/** `Query.rewindFiles()` に渡す UUID */
	messageUuid: string;
	text: string;
}

/** コンパクション（要約圧縮）の発生（tasks.md T-022）。黙って起きると履歴が飛んだように見える */
export interface CompactionEvent extends EventBase {
	kind: 'compaction';
	trigger: 'manual' | 'auto';
	preTokens: number;
	postTokens?: number;
	durationMs?: number;
}

export interface SessionErrorEvent extends EventBase {
	kind: 'session-error';
	message: string;
}

/**
 * 画面にだけ出す但し書き（T-367）。SDK から来たのではなく **Nimbus が足す 1 行**。
 *
 * 「巻き戻したのに会話が残っている」ような、**見えているものと実際が食い違う場面**を
 * 黙らせないために要る。会話の流れの中に置くので、面を開き直しても消えない。
 */
export interface NoticeEvent extends EventBase {
	kind: 'notice';
	text: string;
}

export type NimbusEvent =
	| SessionInitEvent
	| UserTextEvent
	| AssistantTextEvent
	| AssistantThinkingEvent
	| ToolUseEvent
	| ToolResultEvent
	| TurnResultEvent
	| StatusEvent
	| SessionErrorEvent
	| NoticeEvent
	| HookEvent
	| SubagentEvent
	| CheckpointEvent
	| CompactionEvent;

export type NimbusEventKind = NimbusEvent['kind'];

/** セッション一覧表示用のサマリ */
export interface SessionSummary {
	sessionId: string;
	claudeSessionId?: string;
	status: SessionStatus;
	cwd: string;
	model?: string;
	createdAt: number;
	totalCostUsd?: number;
}
