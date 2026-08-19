/**
 * 全画面の右半分に出すもの（tasks.md T-270）。
 *
 * 左が会話（T-269）、右が「いま何が起きているか」。出すのは 2 つのどちらか —
 * **そのセッションが動かしたコマンドの出力**と、**そのセッションが書いたファイルの差分**。
 *
 * ここは**何を出すかの組み立てだけ**。端末も差分エディタもワークベンチが本物を持っているので、
 * 描き直さずに実物へ渡す（`src/sessionSide.ts`）。VS Code に依存しないので単体で検証できる。
 */
import type { NimbusEvent } from '../events';
import { commandOf, filePathOf, WRITE_TOOLS } from './toolInput';

export interface SessionCommand {
	toolUseId: string;
	command: string;
	at: number;
	/** 返ってきた出力（無ければ実行中） */
	output?: string;
	failed?: boolean;
}

/** 端末に写す 1 行の長さ。長すぎる出力で端末を埋めない */
const MAX_OUTPUT_CHARS = 4000;

/**
 * そのセッションが動かしたコマンドを、呼び出しと結果の組にする。
 * 結果がまだ返っていないものは `output` が無い（＝実行中として出せる）。
 */
export function sessionCommands(events: readonly NimbusEvent[]): SessionCommand[] {
	const byId = new Map<string, SessionCommand>();
	const order: string[] = [];
	for (const event of events) {
		if (event.kind === 'tool-use' && event.toolName === 'Bash') {
			const command = commandOf(event.input);
			if (!command) {
				continue;
			}
			byId.set(event.toolUseId, { toolUseId: event.toolUseId, command, at: event.timestamp });
			order.push(event.toolUseId);
		} else if (event.kind === 'tool-result') {
			const found = byId.get(event.toolUseId);
			if (found) {
				found.output = event.preview.slice(0, MAX_OUTPUT_CHARS);
				found.failed = event.isError;
			}
		}
	}
	return order.map((id) => byId.get(id)).filter((entry): entry is SessionCommand => Boolean(entry));
}

/**
 * 端末へ書く行に直す。
 * **実行したことが分かる形**にする — 打ったコマンドと、その出力を続けて出す。
 * 端末は `\r\n` でしか改行しない。
 */
export function terminalLines(commands: readonly SessionCommand[]): string[] {
	const lines: string[] = [];
	for (const entry of commands) {
		lines.push(`$ ${entry.command}`);
		if (entry.output === undefined) {
			lines.push('（実行中…）');
		} else if (entry.output.trim()) {
			lines.push(...entry.output.replace(/\r?\n$/, '').split('\n'));
		}
		if (entry.failed) {
			lines.push('（失敗しました）');
		}
		lines.push('');
	}
	return lines;
}

/**
 * そのセッションが**書いた**ファイル（新しい順・重複なし）。
 * 読んだだけのものは出さない — 差分が出ないので、開いても空になる。
 */
export function sessionWrittenFiles(events: readonly NimbusEvent[]): string[] {
	const seen = new Map<string, number>();
	for (const event of events) {
		if (event.kind !== 'tool-use' || !WRITE_TOOLS.has(event.toolName)) {
			continue;
		}
		const path = filePathOf(event.input);
		if (path) {
			seen.set(path, event.timestamp);
		}
	}
	return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([path]) => path);
}
