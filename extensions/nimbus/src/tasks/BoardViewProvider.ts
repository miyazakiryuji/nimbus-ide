/**
 * 並列タスクの板（Webview）。
 *
 * 「いま何本走っていて、どれが人間の番か」を一目で分かるようにするためだけの画面。
 * 状態は TaskService が持ち、ここは描画と操作の受け渡しに徹する。
 */
import * as vscode from 'vscode';
import type { KanbanTask } from '../core/tasks';
import { renderWebviewPage } from '../webview/page';
import { WebviewViewHost } from '../webview/WebviewViewHost';
import { KANBAN_COLUMNS } from '../core/tasks';

export type BoardInbound =
	| { type: 'ready' }
	| { type: 'newTask' }
	| { type: 'start'; taskId: string }
	| { type: 'complete'; taskId: string }
	| { type: 'open'; taskId: string }
	| { type: 'forget'; taskId: string }
	| { type: 'check' };

export interface BoardHandlers {
	onNewTask(): void | Promise<void>;
	onStart(taskId: string): void | Promise<void>;
	onComplete(taskId: string): void | Promise<void>;
	onOpen(taskId: string): void | Promise<void>;
	onForget(taskId: string): void | Promise<void>;
	/** 止まっているタスクの点検（T-262）。板から 1 つのボタンで呼べるようにする */
	onCheck?(): void | Promise<void>;
	tasks(): KanbanTask[];
	/** taskId → 直近の進捗の 1 行（T-261）。カードに出す */
	progress?(): Record<string, string>;
	log(message: string): void;
}

export class BoardViewProvider extends WebviewViewHost {
	public static readonly viewType = 'nimbus.board';

	constructor(
		extensionUri: vscode.Uri,
		private readonly handlers: BoardHandlers
	) {
		super(extensionUri);
	}

	protected onResolved(webviewView: vscode.WebviewView): void {
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
				case 'check':
					await this.handlers.onCheck?.();
					break;
			}
		});
	}

	refresh(): void {
		this.postMessage({
			type: 'tasks',
			columns: KANBAN_COLUMNS,
			tasks: this.handlers.tasks(),
			progress: this.handlers.progress?.() ?? {}
		});
	}

	protected render(webview: vscode.Webview): string {
		return renderWebviewPage({
			webview,
			title: 'Nimbus タスク',
			stylesheet: this.mediaUri(webview, 'board.css'),
			script: this.mediaUri(webview, 'board.js'),
			body: `	<header class="toolbar">
		<button id="newTask">新しいタスク</button>
		<button id="check" class="secondary">点検</button>
		<span id="summary" class="summary"></span>
	</header>
	<main id="board" class="board"></main>`
		});
	}
}
