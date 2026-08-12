/**
 * 承認ルール（tasks.md T-038）。
 *
 * 「このセッションでは常に許可」はセッションが終われば消える。同じ判断を毎日繰り返さないために、
 * 承認したその場で**ルールとして残せる**ようにするのがここの役目。
 *
 * ルールは設定 `nimbus.permissions.alwaysAllow` に文字列で並べる。手で読めて手で直せる形なので、
 * パーミッションの GUI 編集（T-028）が入っても同じ表現をそのまま使える。
 *
 *   Read             … Read なら何でも
 *   Write(*.md)      … 拡張子が .md のファイルへの Write
 *   Bash(npm test)   … `npm test` で始まるコマンド
 *
 * **安全側の約束が 2 つある。**
 *
 * 1. `danger` と判定されたものはここへ来る前に弾く（呼び出し側 `permissions.ts` の責任）
 * 2. シェルの制御文字（`;` `&&` `|` `$(` など）を含むコマンドは、**どのルールにも一致させない**。
 *    `git status && rm -rf /` は `git status` で始まるので、前方一致だけでは安全にならない
 *
 * VS Code に依存しないので単体で検証できる（誤ると承認を素通りさせる場所なので必ずテストする）。
 */

export interface ApprovalRule {
	/** ツール名。完全一致で見る */
	tool: string;
	/** 絞り込み。`*.md` なら拡張子、それ以外はコマンドの前方一致。無ければそのツール全部 */
	arg?: string;
}

/**
 * シェルが解釈して**別のコマンドを走らせうる**文字。
 * 1 つでも含まれていたら、前方一致は「何が実行されるか」を言い当てられない。
 */
const SHELL_CONTROL = /[;&|<>$`(){}\n\r\\]/;

/** ツール名として認める形。MCP ツール（`mcp__server__tool`）も通す */
const TOOL_NAME = /^[A-Za-z_][\w.-]*$/;

/** 連続する空白を 1 つに畳む。`git   status` と `git status` を同じものとして扱うため */
function normalizeCommand(command: string): string {
	return command.replace(/\s+/g, ' ').trim();
}

function commandOf(input: unknown): string | undefined {
	if (!input || typeof input !== 'object') {
		return undefined;
	}
	const value = (input as Record<string, unknown>)['command'];
	return typeof value === 'string' ? value : undefined;
}

function pathOf(input: unknown): string | undefined {
	if (!input || typeof input !== 'object') {
		return undefined;
	}
	const record = input as Record<string, unknown>;
	for (const key of ['file_path', 'path', 'notebook_path']) {
		const value = record[key];
		if (typeof value === 'string' && value) {
			return value;
		}
	}
	return undefined;
}

/** 拡張子（小文字・ドット無し）。`.env` のような先頭ドットはファイル名なので拡張子として扱わない */
function extensionOf(filePath: string): string | undefined {
	const name = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
	const dot = name.lastIndexOf('.');
	if (dot <= 0 || dot === name.length - 1) {
		return undefined;
	}
	return name.slice(dot + 1).toLowerCase();
}

/**
 * コマンドから「これで始まるものは許す」と言える最小の前置きを取り出す（1〜2 語）。
 * 2 語目はサブコマンド（`git status` の `status`）のときだけ含める。
 * フラグやパスまで固定すると鋭すぎて二度と再利用されない。
 */
function commandPrefix(command: string): string | undefined {
	const normalized = normalizeCommand(command);
	if (!normalized || SHELL_CONTROL.test(normalized)) {
		return undefined;
	}
	const tokens = normalized.split(' ');
	const head = tokens[0];
	if (!head) {
		return undefined;
	}
	const sub = tokens[1];
	return sub && /^[A-Za-z][A-Za-z0-9_-]*$/.test(sub) ? `${head} ${sub}` : head;
}

/** 文字列表現からルールへ。読めない文字列は undefined（設定を手で書き間違えても落とさない） */
export function parseRule(text: string): ApprovalRule | undefined {
	const match = /^([^(]+)(?:\((.*)\))?$/.exec(text.trim());
	if (!match) {
		return undefined;
	}
	const tool = match[1].trim();
	if (!TOOL_NAME.test(tool)) {
		return undefined;
	}
	// `Bash()` は「Bash なら何でも」に見えてしまうので書き間違いとして捨てる
	if (match[2] !== undefined) {
		const arg = match[2].trim();
		return arg ? { tool, arg } : undefined;
	}
	return { tool };
}

export function formatRule(rule: ApprovalRule): string {
	return rule.arg ? `${rule.tool}(${rule.arg})` : rule.tool;
}

/**
 * この呼び出しを「今後は常に許可」にするとしたら、どのルールになるか。
 * ルールを作れないとき（制御文字を含むコマンド）は undefined を返し、
 * 呼び出し側はボタン自体を出さない — 押せるのに効かない選択肢を見せないため。
 */
export function suggestRule(toolName: string, input: unknown): ApprovalRule | undefined {
	if (!TOOL_NAME.test(toolName)) {
		return undefined;
	}
	const command = commandOf(input);
	if (command !== undefined) {
		const arg = commandPrefix(command);
		return arg ? { tool: toolName, arg } : undefined;
	}
	const filePath = pathOf(input);
	const ext = filePath ? extensionOf(filePath) : undefined;
	return ext ? { tool: toolName, arg: `*.${ext}` } : { tool: toolName };
}

export function matchesRule(rule: ApprovalRule, toolName: string, input: unknown): boolean {
	if (rule.tool !== toolName) {
		return false;
	}
	if (!rule.arg) {
		return true;
	}
	if (rule.arg.startsWith('*.')) {
		const filePath = pathOf(input);
		return filePath ? extensionOf(filePath) === rule.arg.slice(2).toLowerCase() : false;
	}
	const command = commandOf(input);
	if (command === undefined) {
		return false;
	}
	const normalized = normalizeCommand(command);
	// 制御文字を含むコマンドはどのルールにも一致させない（このファイル冒頭の約束 2）
	if (SHELL_CONTROL.test(normalized)) {
		return false;
	}
	const prefix = normalizeCommand(rule.arg);
	// 語の切れ目で一致させる。`Bash(git)` が `github-cli …` を許してしまわないように
	return normalized === prefix || normalized.startsWith(`${prefix} `);
}

export function matchesAnyRule(rules: readonly string[], toolName: string, input: unknown): boolean {
	return rules.some((text) => {
		const rule = parseRule(text);
		return rule ? matchesRule(rule, toolName, input) : false;
	});
}
