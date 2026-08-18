/**
 * デバッグ面（tasks.md T-249）。
 *
 * 「セッションの中身」「時系列」は起きたこと**全部**を出す面で、下部パネルの診断側にある。
 * こちらはアクティビティバーに独立した入口を持ち、詰まったときの 3 問だけを出す ──
 * *何が失敗したか* / *同じところを回っていないか* / *何を渡して何が返ったか*。
 *
 * 入口を分けたのは頻度が違うから。全部を眺めるのは時々だが、「何が失敗した」は
 * 詰まっているあいだ**ずっと**見る。頻度の違うものを同じ段に置くと、どちらも遠くなる。
 *
 * 3 つを別々のビューにせず 1 面に畳んでいるのは `activityView` と同じ理由で、
 * 失敗とツール呼び出しは**突き合わせながら**読むため、同じ面にあるほうが速い。
 */
import * as vscode from 'vscode';
import type { NimbusEvent } from './events';
import { runningTool } from './core/activity';
import {
	findFailures,
	findRepetitions,
	pairToolCalls,
	sourceIcon,
	sourceLabel,
	stableStringify,
	type Failure,
	type ToolCall
} from './core/debugInsight';
import { group, NimbusTreeView, type TreeNode } from './views/treeView';

/**
 * 行に実体を持たせる。
 *
 * インラインのボタン（`view/item/context`）には、押された行そのものが渡ってくる。
 * ここに実体を載せておけば、ラベルから引き直さずに済む。
 */
export interface DebugNode extends TreeNode {
	failure?: Failure;
	call?: ToolCall;
}

function time(at: number): string {
	return new Date(at).toLocaleTimeString('ja-JP');
}

/** 経過を人が読める形に。ミリ秒のままだと桁が読めない */
function elapsed(ms: number): string {
	return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export class DebugViewProvider extends NimbusTreeView {
	private events: readonly NimbusEvent[] = [];

	update(events: readonly NimbusEvent[]): void {
		this.events = events;
		this.refresh();
	}

	/** アクティビティバーのバッジに出す件数。失敗が出たことにアイコンで気づけるように */
	failureCount(): number {
		return findFailures(this.events).length;
	}

	/** いまの失敗。コマンドパレットから名前で引くときに使う */
	failures(): Failure[] {
		return findFailures(this.events);
	}

	/** いまのツール呼び出し。コマンドパレットから名前で引くときに使う */
	calls(): ToolCall[] {
		return pairToolCalls(this.events);
	}

	protected nodes(): DebugNode[] {
		if (this.events.length === 0) {
			return [
				{
					label: 'セッションが動き出すと、ここに失敗と呼び出しが出ます',
					icon: 'info'
				}
			];
		}

		const failures = findFailures(this.events);
		const repetitions = findRepetitions(this.events);
		const calls = pairToolCalls(this.events);

		return [
			this.nowNode(),
			group(
				'失敗',
				'error',
				failures.map((failure) => this.failureNode(failure)),
				'失敗はありません'
			),
			group(
				'繰り返し',
				'sync',
				repetitions.map((entry) => ({
					label: entry.toolName,
					description: `${entry.count} 回 · ${time(entry.lastAt)}`,
					tooltip: new vscode.MarkdownString(
						[`**${entry.toolName}** を同じ入力で **${entry.count} 回**`, '', '```', entry.summary, '```'].join(
							'\n'
						)
					),
					icon: 'sync'
				})),
				'同じ呼び出しの繰り返しはありません'
			),
			group(
				'ツール呼び出し',
				'tools',
				calls.map((call) => this.callNode(call)),
				'まだ呼び出しがありません'
			)
		];
	}

	/** いま何をしているか。詰まったときに最初に見るのはここ */
	private nowNode(): DebugNode {
		const running = runningTool(this.events);
		if (!running) {
			return { label: 'いま', description: '走っているツールはありません', icon: 'circle-outline' };
		}
		return {
			label: 'いま',
			description: [running.toolName, running.target].filter(Boolean).join(' · '),
			tooltip: `${running.toolName} を ${time(running.since)} から実行中`,
			icon: 'loading~spin'
		};
	}

	private failureNode(failure: Failure): DebugNode {
		return {
			label: failure.title,
			description: `${time(failure.at)} · ${sourceLabel(failure.source)}`,
			tooltip: new vscode.MarkdownString(
				[`**${failure.title}**（${sourceLabel(failure.source)}）`, '', '```', failure.detail, '```'].join('\n')
			),
			icon: sourceIcon(failure.source),
			// インラインの「直してもらう」を出す目印
			contextValue: 'nimbusFailure',
			command: { command: 'nimbus.showFailure', arguments: [failure] },
			failure
		};
	}

	private callNode(call: ToolCall): DebugNode {
		const state =
			call.failed === undefined
				? '返っていません'
				: `${call.failed ? '失敗' : '成功'}${call.durationMs === undefined ? '' : ` · ${elapsed(call.durationMs)}`}`;
		return {
			label: call.toolName,
			description: [call.summary, state].filter(Boolean).join(' · '),
			tooltip: new vscode.MarkdownString(
				[`**${call.toolName}**`, '', '```json', stableStringify(call.input), '```'].join('\n')
			),
			icon: call.failed === undefined ? 'circle-outline' : call.failed ? 'error' : 'check',
			contextValue: 'nimbusToolCall',
			command: { command: 'nimbus.showToolCall', arguments: [call] },
			call
		};
	}
}

/**
 * 面を開かずに、名前で失敗を選ぶ。
 *
 * 行から押す経路だけだと、その面を開いている人にしか存在しない機能になる。
 * 場所で引く経路（ツリーの行）と、名前で引く経路（コマンドパレット）の両方を用意する。
 */
export async function pickFailure(failures: readonly Failure[]): Promise<Failure | undefined> {
	if (failures.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 失敗はありません。');
		return undefined;
	}
	const chosen = await vscode.window.showQuickPick(
		failures.map((failure) => ({
			label: failure.title,
			description: sourceLabel(failure.source),
			detail: failure.detail,
			failure
		})),
		{ title: 'Nimbus: どの失敗を開きますか', matchOnDetail: true }
	);
	return chosen?.failure;
}

/** 名前でツール呼び出しを選ぶ。`pickFailure` と同じ理由で用意する */
export async function pickToolCall(calls: readonly ToolCall[]): Promise<ToolCall | undefined> {
	if (calls.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: まだツール呼び出しがありません。');
		return undefined;
	}
	const chosen = await vscode.window.showQuickPick(
		calls.map((call) => ({
			label: call.toolName,
			description: call.failed === undefined ? '返っていません' : call.failed ? '失敗' : '成功',
			detail: call.summary,
			call
		})),
		{ title: 'Nimbus: どの呼び出しを開きますか', matchOnDetail: true }
	);
	return chosen?.call;
}

/**
 * 失敗の全文を開く。
 *
 * ツリーの行は 1 行しか出せないので、**押したら中身が出る**ところまでを 1 組にする。
 * 行が押せるだけで何も出ないのは、見えているだけと同じ（T-244）。
 */
export async function showFailure(failure: Failure): Promise<void> {
	const markdown = [
		`# 失敗: ${failure.title}`,
		'',
		`- 出どころ: ${sourceLabel(failure.source)}`,
		`- 時刻: ${new Date(failure.at).toLocaleString('ja-JP')}`,
		'',
		'## 中身',
		'',
		'```',
		failure.detail,
		'```'
	].join('\n');
	const document = await vscode.workspace.openTextDocument({ content: markdown, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: false });
}

/**
 * ツール呼び出しの入力と結果を開く。
 *
 * 生の入力は**サニタイザを通してから**出す。デバッグのために開いた面が、
 * そのまま資格情報の露出になっては困る。
 */
export async function showToolCall(call: ToolCall, maskSecrets: (input: string) => string): Promise<void> {
	const markdown = [
		`# ${call.toolName}`,
		'',
		`- 時刻: ${new Date(call.at).toLocaleString('ja-JP')}`,
		`- 結果: ${call.failed === undefined ? 'まだ返っていません' : call.failed ? '失敗' : '成功'}`,
		...(call.durationMs === undefined ? [] : [`- 所要: ${elapsed(call.durationMs)}`]),
		'',
		'## 渡したもの',
		'',
		'```json',
		maskSecrets(stableStringify(call.input)),
		'```',
		'',
		'## 返ってきたもの',
		'',
		'```',
		call.result === undefined ? '（まだ返っていません）' : maskSecrets(call.result),
		'```'
	].join('\n');
	const document = await vscode.workspace.openTextDocument({ content: markdown, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: false });
}
