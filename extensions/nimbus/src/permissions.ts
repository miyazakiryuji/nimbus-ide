/**
 * 承認（canUseTool）。
 *
 * Claude が書き込み・実行系のツールを使う前に、Nimbus が握って利用者に判断させる。
 * SDK は `canUseTool` の Promise が解決するまでそのツール実行を待つので、
 * ここで待たせている間セッションは止まる（＝勝手に進まない）。
 *
 * 旧 Electron 版は自前の「承認インボックス」画面を持っていたが、フォークでは
 * VS Code のモーダルに寄せる。判断を求める瞬間に前面へ出るぶん、見落としが起きにくい。
 */
import * as vscode from 'vscode';
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';

/** 読み取りだけで副作用が無いツール。設定で自動許可できる */
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead', 'TodoWrite']);

/** 承認ダイアログに出す 1 行サマリ。長い入力は畳む */
function describe(toolName: string, input: Record<string, unknown>): string {
	const primary =
		(typeof input.command === 'string' && input.command) ||
		(typeof input.file_path === 'string' && input.file_path) ||
		(typeof input.path === 'string' && input.path) ||
		(typeof input.pattern === 'string' && input.pattern) ||
		(typeof input.url === 'string' && input.url) ||
		'';
	if (!primary) {
		return toolName;
	}
	const oneLine = primary.replace(/\s+/g, ' ').trim();
	return `${toolName}: ${oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine}`;
}

export interface PermissionDeps {
	/** セッションごとの「このセッションでは以後聞かない」記憶 */
	sessionAllowAll: Set<string>;
	log: (message: string) => void;
}

export function createCanUseTool(sessionId: string, deps: PermissionDeps): CanUseTool {
	return async (toolName, input): Promise<PermissionResult> => {
		const config = vscode.workspace.getConfiguration('nimbus');
		const summary = describe(toolName, input as Record<string, unknown>);

		if (config.get<boolean>('permissions.autoApproveReadOnly') && READ_ONLY_TOOLS.has(toolName)) {
			deps.log(`[permission] 自動許可（読み取り専用）: ${summary}`);
			return { behavior: 'allow', updatedInput: input };
		}
		if (deps.sessionAllowAll.has(sessionId)) {
			deps.log(`[permission] 自動許可（このセッションで許可済み）: ${summary}`);
			return { behavior: 'allow', updatedInput: input };
		}

		const ALLOW = '許可';
		const ALLOW_SESSION = 'このセッションでは常に許可';
		const DENY = '拒否';
		const choice = await vscode.window.showWarningMessage(
			`Claude がツールを実行しようとしています。\n\n${summary}`,
			{ modal: true },
			ALLOW,
			ALLOW_SESSION,
			DENY
		);

		if (choice === ALLOW_SESSION) {
			deps.sessionAllowAll.add(sessionId);
		}
		if (choice === ALLOW || choice === ALLOW_SESSION) {
			deps.log(`[permission] 許可: ${summary}`);
			return { behavior: 'allow', updatedInput: input };
		}

		// モーダルを Esc で閉じた場合も choice は undefined になる。
		// 「答えなかった」を許可に倒すのは危険なので拒否として扱う。
		deps.log(`[permission] 拒否: ${summary}`);
		return {
			behavior: 'deny',
			message: choice === DENY ? '利用者が拒否しました' : '利用者が応答しませんでした'
		};
	};
}
