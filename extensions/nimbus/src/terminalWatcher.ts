/**
 * ターミナルで落ちたコマンドを拾ってセッションへ渡す（tasks.md T-169）。
 *
 * 「テストが落ちた → 出力を選んでコピー → コックピットに貼る」を、通知のボタン 1 つに畳む。
 * VS Code のシェル統合が出力とコマンド行と終了コードを教えてくれるので、
 * 素の Claude Code では取れない情報がそのまま手に入る（フォークにした旨味の一つ）。
 *
 * 整形の判断は `core/terminalCapture.ts` に置き、ここは VS Code の口だけを持つ。
 */
import * as vscode from 'vscode';
import {
	buildFailurePrompt,
	failureHeadline,
	shouldOfferCapture,
	DEFAULT_MAX_LINES,
	type TerminalFailure
} from './core/terminalCapture';

/** 1 コマンドあたりに溜める出力の上限。末尾を残す（失敗の理由は終わりにある） */
const MAX_BUFFERED_CHARS = 256 * 1024;

export interface TerminalWatcherDeps {
	/** コックピットへ投入する */
	send: (text: string) => void;
	log: (message: string) => void;
}

export class TerminalWatcher implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	/** 実行中のコマンドごとの出力。終了時に回収する */
	private readonly buffers = new Map<vscode.TerminalShellExecution, string>();
	/** 直近の失敗。通知を閉じてしまってもコマンドから拾い直せるように持つ */
	private lastFailure?: { prompt: string; headline: string };

	constructor(private readonly deps: TerminalWatcherDeps) {
		this.disposables.push(
			vscode.window.onDidStartTerminalShellExecution((event) => this.onStart(event)),
			vscode.window.onDidEndTerminalShellExecution((event) => void this.onEnd(event))
		);
	}

	dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables.length = 0;
		this.buffers.clear();
	}

	/** 直近の失敗を投入する（`nimbus.sendLastTerminalFailure`） */
	sendLastFailure(): boolean {
		if (!this.lastFailure) {
			return false;
		}
		this.deps.send(this.lastFailure.prompt);
		return true;
	}

	private config(): vscode.WorkspaceConfiguration {
		return vscode.workspace.getConfiguration('nimbus');
	}

	private onStart(event: vscode.TerminalShellExecutionStartEvent): void {
		if (this.config().get<boolean>('terminal.captureFailures') === false) {
			return;
		}
		// 読み始めは開始時でないと取りこぼす（API の注意書きどおり）
		this.buffers.set(event.execution, '');
		void this.collect(event.execution);
	}

	private async collect(execution: vscode.TerminalShellExecution): Promise<void> {
		try {
			for await (const chunk of execution.read()) {
				const current = this.buffers.get(execution);
				if (current === undefined) {
					// 終了して回収済み。読み続ける意味がない
					return;
				}
				const next = current + chunk;
				this.buffers.set(
					execution,
					next.length > MAX_BUFFERED_CHARS ? next.slice(next.length - MAX_BUFFERED_CHARS) : next
				);
			}
		} catch (error) {
			// 出力が読めなくても、コマンド行と終了コードだけで投入はできる
			this.deps.log(`[terminal] 出力を読めませんでした: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async onEnd(event: vscode.TerminalShellExecutionEndEvent): Promise<void> {
		const output = this.buffers.get(event.execution) ?? '';
		this.buffers.delete(event.execution);

		const config = this.config();
		if (config.get<boolean>('terminal.captureFailures') === false) {
			return;
		}
		const commandLine = event.execution.commandLine.value;
		if (!shouldOfferCapture(commandLine, event.exitCode)) {
			return;
		}

		const failure: TerminalFailure = {
			commandLine,
			cwd: event.execution.cwd?.fsPath,
			exitCode: event.exitCode ?? 1,
			output,
			maxLines: config.get<number>('terminal.maxOutputLines') ?? DEFAULT_MAX_LINES
		};
		const headline = failureHeadline(commandLine, failure.exitCode);
		this.lastFailure = { prompt: buildFailurePrompt(failure), headline };
		this.deps.log(`[terminal] ${headline}`);

		const SEND = 'セッションに投入';
		const NEVER = '今後は知らせない';
		// 情報通知だと数秒で消える。押す前に消えたら「ワンクリック」にならないので警告で出す
		const choice = await vscode.window.showWarningMessage(`Nimbus: ${headline}`, SEND, NEVER);
		if (choice === SEND) {
			this.sendLastFailure();
		} else if (choice === NEVER) {
			await config.update('terminal.captureFailures', false, vscode.ConfigurationTarget.Global);
			void vscode.window.showInformationMessage(
				'Nimbus: ターミナルの失敗を知らせません（設定 nimbus.terminal.captureFailures で戻せます）。'
			);
		}
	}
}
