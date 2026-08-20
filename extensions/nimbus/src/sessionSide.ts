/**
 * 全画面の右半分（tasks.md T-270）。
 *
 * 左が会話（T-269）、右が「いま何が起きているか」。
 *
 * **webview の中に描き直さない。** 端末も差分エディタもワークベンチが本物を持っているので、
 * 右のエディタグループに実物を置いて左右に並べる。写しを作ると、
 * 検索も折り返しも配色も別物になり、「本物のつもりで見て違う」が起きる。
 *
 * 端末は**読み取り専用の写し**（`Pseudoterminal`）— セッションが動かしたコマンドと出力を流す。
 * 打ち込みは受け取らない（ここで打っても、そのセッションには届かないため）。
 *
 * 組み立ては `core/sessionSide.ts`（VS Code 非依存・単体テスト済み）。
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { basename, relative } from 'path';
import * as vscode from 'vscode';
import type { NimbusEvent } from './events';
import { sessionCommands, sessionWrittenFiles, terminalLines } from './core/sessionSide';

const run = promisify(execFile);

/** `git show HEAD:<path>` の中身を差分の左側として読ませるための scheme */
const HEAD_SCHEME = 'nimbus-head';

export type SideMode = 'off' | 'terminal' | 'diff';

export interface SessionSideDeps {
	/** そのセッションの控え（`extension.ts` の archived） */
	events: (sessionId: string) => readonly NimbusEvent[];
	/** そのセッションの作業ディレクトリ（git の基点に使う） */
	cwdOf: (sessionId: string) => string | undefined;
	/** タブに出している名前 */
	titleOf: (sessionId: string) => string;
	log: (message: string) => void;
}

export class SessionSidePane implements vscode.Disposable {
	private mode: SideMode = 'off';
	private shownSessionId?: string;
	private terminal?: vscode.Terminal;
	private readonly writeEmitter = new vscode.EventEmitter<string>();
	/** 端末へ既に流したツール呼び出し。同じものを二度書かない */
	private readonly written = new Set<string>();
	private readonly registration: vscode.Disposable;

	constructor(private readonly deps: SessionSideDeps) {
		this.registration = vscode.workspace.registerTextDocumentContentProvider(HEAD_SCHEME, {
			provideTextDocumentContent: (uri) => this.headContent(uri)
		});
	}

	current(): SideMode {
		return this.mode;
	}

	/**
	 * 差分に出せるものがあるか（T-292）。
	 *
	 * 全画面にしたときに右半分を自動で出すかの判断に使う。
	 * **出るのはそのセッションが書いたファイルだけ**で、読んだだけのファイルは出ない。
	 */
	hasDiff(sessionId: string | undefined): boolean {
		return sessionId !== undefined && sessionWrittenFiles(this.deps.events(sessionId)).length > 0;
	}

	/** 右に出すものを決める。`off` で閉じる（端末は残らない） */
	async show(mode: SideMode, sessionId: string | undefined): Promise<void> {
		this.mode = mode;
		this.shownSessionId = sessionId;
		if (mode === 'off' || !sessionId) {
			this.closeTerminal();
			return;
		}
		if (mode === 'terminal') {
			this.closeTerminal();
			this.openTerminal(sessionId);
			return;
		}
		await this.openDiff(sessionId);
	}

	/** セッションを切り替えたら右側も追従する（T-270 の要） */
	async follow(sessionId: string | undefined): Promise<void> {
		if (this.mode === 'off' || !sessionId || sessionId === this.shownSessionId) {
			return;
		}
		await this.show(this.mode, sessionId);
	}

	/** 出しているセッションのイベントだけ、その場で端末へ書き足す */
	append(event: NimbusEvent): void {
		if (this.mode !== 'terminal' || !this.terminal || event.sessionId !== this.shownSessionId) {
			return;
		}
		if (event.kind !== 'tool-use' && event.kind !== 'tool-result') {
			return;
		}
		this.writeLines(this.pendingLines(event.sessionId));
	}

	dispose(): void {
		this.registration.dispose();
		this.writeEmitter.dispose();
		this.closeTerminal();
	}

	/** まだ端末へ出していないぶんの行 */
	private pendingLines(sessionId: string): string[] {
		const commands = sessionCommands(this.deps.events(sessionId));
		const fresh = commands.filter((entry) => {
			// 出力が返るまでは「実行中」で出し、返ったら書き直したいので、鍵に状態を混ぜる
			const key = `${entry.toolUseId}:${entry.output === undefined ? 'running' : 'done'}`;
			if (this.written.has(key)) {
				return false;
			}
			this.written.add(key);
			return true;
		});
		return terminalLines(fresh);
	}

	private writeLines(lines: readonly string[]): void {
		if (lines.length === 0) {
			return;
		}
		// 端末は \r\n でしか改行しない
		this.writeEmitter.fire(`${lines.join('\r\n')}\r\n`);
	}

	private openTerminal(sessionId: string): void {
		const pty: vscode.Pseudoterminal = {
			onDidWrite: this.writeEmitter.event,
			open: () => {
				this.written.clear();
				this.writeLines([
					`# ${this.deps.titleOf(sessionId)} が動かしたコマンド（写し・打ち込みは届きません）`,
					''
				]);
				this.writeLines(this.pendingLines(sessionId));
			},
			close: () => {
				this.terminal = undefined;
			},
			handleInput: () => undefined
		};
		this.terminal = vscode.window.createTerminal({
			name: `Nimbus: ${this.deps.titleOf(sessionId)}`,
			pty,
			location: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }
		});
		this.terminal.show(true);
		this.deps.log(`[side] ${sessionId.slice(0, 8)} のコマンドを右に出しました`);
	}

	private closeTerminal(): void {
		this.terminal?.dispose();
		this.terminal = undefined;
		this.written.clear();
	}

	private async openDiff(sessionId: string): Promise<void> {
		const files = sessionWrittenFiles(this.deps.events(sessionId));
		if (files.length === 0) {
			void vscode.window.showInformationMessage('Nimbus: このセッションはまだファイルを書いていません。');
			return;
		}
		const file = files[0];
		const cwd = this.deps.cwdOf(sessionId) ?? '';
		const left = vscode.Uri.from({ scheme: HEAD_SCHEME, path: file, query: encodeURIComponent(cwd) });
		await vscode.commands.executeCommand(
			'vscode.diff',
			left,
			vscode.Uri.file(file),
			`Nimbus: ${basename(file)}（このセッションの変更）`,
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: true }
		);
		this.deps.log(`[side] ${basename(file)} の差分を右に出しました`);
	}

	/** 差分の左側。HEAD に無ければ空（＝全部足した差分として出る） */
	private async headContent(uri: vscode.Uri): Promise<string> {
		const cwd = decodeURIComponent(uri.query);
		if (!cwd) {
			return '';
		}
		try {
			const { stdout } = await run('git', ['show', `HEAD:${relative(cwd, uri.path)}`], {
				cwd,
				maxBuffer: 10 * 1024 * 1024
			});
			return stdout;
		} catch {
			return '';
		}
	}
}
