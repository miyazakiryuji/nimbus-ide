/**
 * 生成直後に型を当てて、増えたエラーだけを差し戻す（tasks.md T-101）。
 *
 * 「書いた → 言語サーバーが赤くする → 人が気づいて指摘する」の真ん中を機械がやる。
 * 素の Claude Code はビルドを回すまで気づけないが、フォークの中では**編集した瞬間に**
 * 診断が出ている。[lsp-tools](../../../nimbus/docs/specs/lsp-tools.md) と同じ土台。
 *
 * 差分の判断は `core/verifyEdits.ts` に置き、ここは VS Code の口と待ち合わせだけを持つ。
 */
import * as vscode from 'vscode';
import {
	buildVerifyPrompt,
	editedFilePath,
	newErrors,
	verifyHeadline,
	type DiagnosticLike
} from './core/verifyEdits';
import { displayPath } from './core/lsp';

/** 編集後、言語サーバーが診断を出し直すまでの待ち */
const SETTLE_MS = 1200;
/** 診断が落ち着くまでの追加の待ち（変化が止まるまで最大この回数だけ見る） */
const MAX_SETTLE_ROUNDS = 4;

export interface EditVerifierDeps {
	/** セッションへ差し戻す */
	send: (text: string) => void;
	log: (message: string) => void;
}

export class EditVerifier {
	/** 編集前の診断。ファイルごとに 1 回だけ取る（同じターンで何度も書き換えるため） */
	private readonly baseline = new Map<string, DiagnosticLike[]>();
	private lastPrompt?: string;
	/** そのターンで自動差し戻しを行った回数。無限ループを閉じる */
	private autoSends = 0;

	constructor(private readonly deps: EditVerifierDeps) { }

	/** ツール呼び出しを見て、書き換え対象のファイルの「編集前」を控える */
	noteToolUse(toolName: string, input: unknown): void {
		if (this.mode() === 'off') {
			return;
		}
		const path = editedFilePath(toolName, input);
		if (!path || this.baseline.has(path)) {
			return;
		}
		this.baseline.set(path, this.diagnosticsOf(path));
	}

	/** 新しいセッション・新しい指示のたびに数え直す */
	reset(): void {
		this.baseline.clear();
		this.autoSends = 0;
	}

	/** 直近の結果をもう一度差し戻す（`nimbus.verifyEdits`） */
	sendLast(): boolean {
		if (!this.lastPrompt) {
			return false;
		}
		this.deps.send(this.lastPrompt);
		return true;
	}

	/**
	 * ターンが終わった時点で確かめる。
	 * 途中で割り込むと編集の途中経過を叩くことになるので、区切りまで待つ。
	 */
	async verifyAfterTurn(): Promise<void> {
		const mode = this.mode();
		if (mode === 'off' || this.baseline.size === 0) {
			return;
		}
		const files = [...this.baseline.keys()];
		const before = new Map(this.baseline);
		this.baseline.clear();

		const after = await this.waitForDiagnostics(files);
		const errors = newErrors(
			files.flatMap((file) => before.get(file) ?? []),
			after
		);
		if (errors.length === 0) {
			return;
		}

		const roots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
		this.lastPrompt = buildVerifyPrompt(errors, (file) => displayPath(roots, file));
		const touched = new Set(errors.map((error) => error.file)).size;
		const headline = verifyHeadline(errors.length, touched);
		this.deps.log(`[verify] ${headline}`);

		if (mode === 'auto') {
			const limit = vscode.workspace.getConfiguration('nimbus').get<number>('lsp.maxAutoFixes') ?? 2;
			if (this.autoSends >= limit) {
				// 直らないまま回り続けるのが一番高くつく。上限で人に戻す
				this.deps.log(`[verify] 自動の差し戻しは上限（${limit} 回）に達しました`);
				void vscode.window.showWarningMessage(
					`Nimbus: ${headline}。自動の差し戻しは上限に達したので止めました（コマンド「型エラーを差し戻す」で再開できます）。`
				);
				return;
			}
			this.autoSends++;
			this.deps.send(this.lastPrompt);
			return;
		}

		const SEND = '差し戻す';
		const choice = await vscode.window.showWarningMessage(`Nimbus: ${headline}`, SEND);
		if (choice === SEND) {
			this.sendLast();
		}
	}

	private mode(): 'off' | 'ask' | 'auto' {
		const value = vscode.workspace.getConfiguration('nimbus').get<string>('lsp.verifyEdits');
		return value === 'off' || value === 'auto' ? value : 'ask';
	}

	/**
	 * 診断が落ち着くまで待つ。
	 * 編集直後は言語サーバーがまだ古い結果を持っているので、**変化が止まるまで**見る。
	 */
	private async waitForDiagnostics(files: readonly string[]): Promise<DiagnosticLike[]> {
		let previous = '';
		let current: DiagnosticLike[] = [];
		for (let round = 0; round < MAX_SETTLE_ROUNDS; round++) {
			await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
			current = files.flatMap((file) => this.diagnosticsOf(file));
			const snapshot = JSON.stringify(current);
			if (snapshot === previous) {
				break;
			}
			previous = snapshot;
		}
		return current;
	}

	private diagnosticsOf(file: string): DiagnosticLike[] {
		try {
			return vscode.languages.getDiagnostics(vscode.Uri.file(file)).map((diagnostic) => ({
				file,
				line: diagnostic.range.start.line,
				character: diagnostic.range.start.character,
				severity: diagnostic.severity,
				message: diagnostic.message,
				source: diagnostic.source
			}));
		} catch {
			// 開けないパス（削除された・別スキーム）は「診断なし」として扱う
			return [];
		}
	}
}
