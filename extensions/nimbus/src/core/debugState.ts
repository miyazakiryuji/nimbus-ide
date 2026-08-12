/**
 * デバッガの状態を、エージェントに渡せる形にする（tasks.md T-104）。
 *
 * 原因特定の精度を決めるのは「**実行時の実際の値**」が見えるかどうか。
 * ソースを何度読んでも「この変数が null になっている」は分からない。
 * フォークの中ではデバッグアダプタが繋がっているので、止まっている場所の
 * コールスタックと変数の値をそのまま渡せる。
 *
 * VS Code に依存しない。DAP の応答を写した形から、読めるテキストにするところまでを置く。
 */

/** DAP の StackFrame から必要なものだけを写したもの */
export interface StackFrameLike {
	name: string;
	/** ソースの絶対パス（無いフレームもある — ネイティブや eval など） */
	file?: string;
	/** 1 起点（DAP がそのまま 1 起点で返す） */
	line?: number;
	column?: number;
}

export interface VariableLike {
	name: string;
	value: string;
	type?: string;
}

export interface ScopeLike {
	name: string;
	variables: VariableLike[];
}

/** 値は 1 件ずつ切る。巨大なオブジェクトが 1 つあるだけで文脈が飛ぶ */
const MAX_VALUE_CHARS = 300;

export function truncateValue(value: string, max: number = MAX_VALUE_CHARS): string {
	const flat = value.replace(/\r?\n/g, ' ').trim();
	return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * コールスタック。
 * 上（止まっている場所）から順に並べる。番号は `debug_variables` で指す添字と揃える。
 */
export function renderStack(frames: readonly StackFrameLike[], displayPath: (file: string) => string): string {
	if (frames.length === 0) {
		return '（コールスタックを取得できませんでした）';
	}
	return frames
		.map((frame, index) => {
			const where = frame.file
				? `  ${displayPath(frame.file)}${frame.line === undefined ? '' : `:${frame.line}`}`
				: '';
			return `#${index} ${frame.name}${where}`;
		})
		.join('\n');
}

/** スコープごとの変数。空のスコープは出さない（Registers のような雑音を混ぜない） */
export function renderScopes(scopes: readonly ScopeLike[]): string {
	const parts = scopes
		.filter((scope) => scope.variables.length > 0)
		.map((scope) => {
			const lines = scope.variables.map((variable) => {
				const type = variable.type ? `: ${variable.type}` : '';
				return `  ${variable.name}${type} = ${truncateValue(variable.value)}`;
			});
			return [`${scope.name}`, ...lines].join('\n');
		});
	return parts.length > 0 ? parts.join('\n\n') : '（この位置に見える変数はありません）';
}

/** 止まっていないときに返す文。「取れなかった」ではなく「どうすれば取れるか」を言う */
export const NOT_STOPPED =
	'いまデバッグセッションが停止していません。' +
	'ブレークポイントを置いて実行し、止まった状態でもう一度呼んでください。';
