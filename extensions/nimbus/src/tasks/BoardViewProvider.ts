/**
 * 並列タスクの板（Webview）。
 *
 * 「いま何本走っていて、どれが人間の番か」を一目で分かるようにするためだけの画面。
 * 状態は TaskService が持ち、ここは描画と操作の受け渡しに徹する。
 */
import * as vscode from 'vscode';
import type { KanbanTask } from '../core/tasks';
import { KANBAN_COLUMNS } from '../core/tasks';

export type BoardInbound =
	| { type: 'ready' }
	| { type: 'newTask' }
	| { type: 'start'; taskId: string }
	| { type: 'complete'; taskId: string }
	| { type: 'open'; taskId: string }
	| { type: 'forget'; taskId: string };

export interface BoardHandlers {
	onNewTask(): void | Promise<void>;
	onStart(taskId: string): void | Promise<void>;
	onComplete(taskId: string): void | Promise<void>;
	onOpen(taskId: string): void | Promise<void>;
	onForget(taskId: string): void | Promise<void>;
	tasks(): KanbanTask[];
	log(message: string): void;
}

function nonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}

export class BoardViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'nimbus.board';

	private view?: vscode.WebviewView;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly handlers: BoardHandlers
	) { }

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
		};
		webviewView.webview.html = this.render(webviewView.webview);
		this.handlers.log('[board] Webview を生成しました');

		webviewView.webview.onDidReceiveMessage(async (message: BoardInbound) => {
			switch (message.type) {
				case 'ready':
					this.refresh();
					break;
				case 'newTask':
					await this.handlers.onNewTask();
					break;
				case 'start':
					await this.handlers.onStart(message.taskId);
					break;
				case 'complete':
					await this.handlers.onComplete(message.taskId);
					break;
				case 'open':
					await this.handlers.onOpen(message.taskId);
					break;
				case 'forget':
					await this.handlers.onForget(message.taskId);
					break;
			}
		});

		webviewView.onDidDispose(() => {
			if (this.view === webviewView) {
				this.view = undefined;
			}
		});
	}

	refresh(): void {
		void this.view?.webview.postMessage({
			type: 'tasks',
			columns: KANBAN_COLUMNS,
			tasks: this.handlers.tasks()
		});
	}

	private render(webview: vscode.Webview): string {
		const media = (name: string): vscode.Uri =>
			webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name));
		const n = nonce();
		return /* html */ `<!DOCTYPE html>
<html lang="ja">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${n}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href="${media('board.css')}" rel="stylesheet">
	<title>Nimbus タスク</title>
</head>
<body>
	<header class="toolbar">
		<button id="newTask">新しいタスク</button>
		<span id="summary" class="summary"></span>
	</header>
	<main id="board" class="board"></main>
	<script nonce="${n}" src="${media('board.js')}"></script>
</body>
</html>`;
	}
}
