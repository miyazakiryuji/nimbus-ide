/**
 * Hooks の組み立てとドライラン（tasks.md T-026 / T-161）。
 *
 * フックは `settings.json` に手で JSON を書くもので、書式を 1 文字間違えると
 * **黙って動かない**。動かないことにも気づけない。画面から組み立てられるようにする。
 *
 * SDK 実測でフックイベントは **31 種類**ある（タスクの「31 種類とのこと・要確認」は正しい）。
 * ただし実務で使うのは 5 つで足りるので、それを前面に出し、残りは折りたたむ。
 *
 * VS Code に依存しないので単体で検証できる。
 */

/** SDK 0.3.226 実測の 31 種類 */
export const ALL_HOOK_EVENTS = [
	'PreToolUse',
	'PostToolUse',
	'UserPromptSubmit',
	'SessionStart',
	'Stop',
	'PostToolUseFailure',
	'PostToolBatch',
	'Notification',
	'UserPromptExpansion',
	'SessionEnd',
	'StopFailure',
	'SubagentStart',
	'SubagentStop',
	'PreCompact',
	'PostCompact',
	'PermissionRequest',
	'PermissionDenied',
	'Setup',
	'TeammateIdle',
	'TaskCreated',
	'TaskCompleted',
	'Elicitation',
	'ElicitationResult',
	'ConfigChange',
	'WorktreeCreate',
	'WorktreeRemove',
	'InstructionsLoaded',
	'CwdChanged',
	'FileChanged',
	'DirectoryAdded',
	'MessageDisplay'
] as const;

export type HookEventName = (typeof ALL_HOOK_EVENTS)[number];

/**
 * 実務で使うのはこの 5 つ。**前面に出す**のはこれだけにする
 * （31 個をそのまま並べると、どれを選べばいいか分からない）。
 */
export const COMMON_HOOK_EVENTS: readonly HookEventName[] = [
	'PreToolUse',
	'PostToolUse',
	'UserPromptSubmit',
	'SessionStart',
	'Stop'
];

/** それぞれ何のときに走るか。選ぶ側に必要なのは名前ではなくこれ */
export const HOOK_EVENT_HELP: Partial<Record<HookEventName, string>> = {
	PreToolUse: 'ツールを実行する前。終了コード 2 で実行を止められる',
	PostToolUse: 'ツールを実行した後。結果を見て次に指示を足せる',
	UserPromptSubmit: '指示を送る直前。内容を検査したり足したりできる',
	SessionStart: 'セッションの開始時。前提を読み込ませるのに使う',
	Stop: 'Claude が応答を終えたとき。仕上げの確認に使う',
	PreCompact: '圧縮の直前',
	SessionEnd: 'セッションの終了時',
	SubagentStop: 'サブエージェントが終わったとき',
	PermissionDenied: '権限が拒否されたとき'
};

/** `settings.json` の 1 エントリ */
export interface HookCommand {
	type: 'command';
	command: string;
	timeout?: number;
}

export interface HookMatcher {
	/** ツール名の正規表現。イベントによっては使わない */
	matcher?: string;
	hooks: HookCommand[];
}

export type HooksConfig = Partial<Record<HookEventName, HookMatcher[]>>;

/** `matcher` が意味を持つイベント（ツールに紐づくものだけ） */
export function usesMatcher(event: HookEventName): boolean {
	return event === 'PreToolUse' || event === 'PostToolUse' || event === 'PostToolUseFailure';
}

/**
 * フックを 1 つ足す。**同じイベント・同じ matcher があれば、そこへ足す**
 * （matcher ごとに配列が分かれると、どれが効くのか読めなくなる）。
 */
export function addHook(config: HooksConfig, event: HookEventName, matcher: string | undefined, command: string): HooksConfig {
	const next: HooksConfig = { ...config };
	const list = [...(next[event] ?? [])];
	const key = usesMatcher(event) ? (matcher ?? '') : undefined;
	const index = list.findIndex((entry) => (entry.matcher ?? '') === (key ?? ''));
	const entry: HookCommand = { type: 'command', command };
	if (index >= 0) {
		list[index] = { ...list[index], hooks: [...list[index].hooks, entry] };
	} else {
		list.push({ ...(key ? { matcher: key } : {}), hooks: [entry] });
	}
	next[event] = list;
	return next;
}

/** フックを 1 つ外す。空になった入れ物は残さない */
export function removeHook(config: HooksConfig, event: HookEventName, matcherIndex: number, hookIndex: number): HooksConfig {
	const next: HooksConfig = { ...config };
	const list = [...(next[event] ?? [])];
	const target = list[matcherIndex];
	if (!target) {
		return config;
	}
	const hooks = target.hooks.filter((_, index) => index !== hookIndex);
	if (hooks.length === 0) {
		list.splice(matcherIndex, 1);
	} else {
		list[matcherIndex] = { ...target, hooks };
	}
	if (list.length === 0) {
		delete next[event];
	} else {
		next[event] = list;
	}
	return next;
}

export interface HookRow {
	event: HookEventName;
	matcher?: string;
	command: string;
	matcherIndex: number;
	hookIndex: number;
}

/** 一覧に出せる形へ平らにする。**実務でよく使う 5 つを先に**並べる */
export function flattenHooks(config: HooksConfig): HookRow[] {
	const rows: HookRow[] = [];
	const order = (event: HookEventName): number => {
		const common = COMMON_HOOK_EVENTS.indexOf(event);
		return common >= 0 ? common : COMMON_HOOK_EVENTS.length + ALL_HOOK_EVENTS.indexOf(event);
	};
	for (const event of Object.keys(config) as HookEventName[]) {
		(config[event] ?? []).forEach((matcher, matcherIndex) => {
			matcher.hooks.forEach((hook, hookIndex) => {
				rows.push({ event, matcher: matcher.matcher, command: hook.command, matcherIndex, hookIndex });
			});
		});
	}
	return rows.sort((a, b) => order(a.event) - order(b.event) || a.command.localeCompare(b.command));
}

/**
 * ドライラン用の入力（T-161）。
 * フックは stdin から JSON を受け取るので、**本番と同じ形**を作って渡す。
 * 中身は作り物だと分かる値にする（本物のパスを混ぜると、消す・送るフックが実際に動く）。
 */
export function dryRunPayload(event: HookEventName, cwd: string): string {
	const base = {
		session_id: 'nimbus-dry-run',
		transcript_path: `${cwd}/.nimbus-dry-run.jsonl`,
		cwd,
		hook_event_name: event
	};
	if (event === 'PreToolUse' || event === 'PostToolUse' || event === 'PostToolUseFailure') {
		return JSON.stringify(
			{ ...base, tool_name: 'Bash', tool_input: { command: 'echo nimbus-dry-run' } },
			null,
			2
		);
	}
	if (event === 'UserPromptSubmit' || event === 'UserPromptExpansion') {
		return JSON.stringify({ ...base, prompt: 'これは Nimbus のドライランです' }, null, 2);
	}
	return JSON.stringify(base, null, 2);
}

export type DryRunVerdict = 'allowed' | 'blocked' | 'error';

/**
 * 終了コードの意味を言葉にする。
 * Claude Code の約束では **2 が「止める」**で、それ以外の非ゼロはフック側の不具合。
 */
export function interpretExitCode(code: number): { verdict: DryRunVerdict; label: string } {
	if (code === 0) {
		return { verdict: 'allowed', label: '通した（終了コード 0）' };
	}
	if (code === 2) {
		return { verdict: 'blocked', label: '止めた（終了コード 2）— stderr の内容が Claude に返ります' };
	}
	return { verdict: 'error', label: `フック側のエラー（終了コード ${code}）— 止めません` };
}
