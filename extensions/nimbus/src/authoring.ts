/**
 * スキル・サブエージェント・コマンドを書く支援（tasks.md T-030 / T-031）。
 *
 * frontmatter の補完と検証（T-030）と、保存したものをすぐ試す（T-031）。
 * どちらも「書いたのに動かない、理由も分からない」を無くすためのもの。
 */
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import type { SessionManager } from './session/SessionManager';
import { completionsFor, kindOfPath, isInsideFrontmatter, validate, type AuthoringKind } from './core/frontmatter';

/** frontmatter のキー補完（T-030） */
export function createCompletionProvider(): vscode.CompletionItemProvider {
	return {
		provideCompletionItems(document, position) {
			const kind = kindOfPath(document.uri.fsPath);
			if (!kind) {
				return undefined;
			}
			const text = document.getText();
			if (!isInsideFrontmatter(text, document.offsetAt(position))) {
				return undefined;
			}
			return completionsFor(kind, text).map((field) => {
				const item = new vscode.CompletionItem(field.name, vscode.CompletionItemKind.Property);
				item.detail = field.required ? '必須' : '任意';
				item.documentation = new vscode.MarkdownString(field.description);
				// 値まで入れる。キーだけ出しても、何を書くかで手が止まる
				item.insertText = new vscode.SnippetString(`${field.name}: \${1:${field.example ?? ''}}`);
				// 必須のものを上に出す
				item.sortText = `${field.required ? '0' : '1'}${field.name}`;
				return item;
			});
		}
	};
}

/** 保存時の検証（T-030）。書式ミスをその場で見せる */
export function validateDocument(document: vscode.TextDocument, diagnostics: vscode.DiagnosticCollection): void {
	const kind = kindOfPath(document.uri.fsPath);
	if (!kind) {
		diagnostics.delete(document.uri);
		return;
	}
	const problems = validate(kind, document.getText());
	diagnostics.set(
		document.uri,
		problems.map((problem) => {
			// frontmatter の先頭に出す。どこが悪いかより「何が足りないか」が要るので、位置は先頭で足りる
			const range = new vscode.Range(0, 0, 0, Math.max(1, document.lineAt(0).text.length));
			return new vscode.Diagnostic(
				range,
				problem.message,
				problem.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
			);
		})
	);
}

/** 種類ごとの試しかた（T-031） */
function previewPrompt(kind: AuthoringKind, name: string, input: string): string {
	switch (kind) {
		case 'skill':
			return `/${name} ${input}`.trim();
		case 'command':
			return `/${name} ${input}`.trim();
		case 'agent':
			return `${name} のサブエージェントを使って、次のことをしてください: ${input}`;
	}
}

/**
 * プレビュー実行（T-031）。
 *
 * **書き換えさせない**（`plan` モード）。試し打ちのつもりでファイルが変わるのが一番困る。
 * 使い捨てのセッションで走らせ、応答をそのまま開く。
 */
export async function previewRun(
	sessions: SessionManager,
	cwd: string,
	document: vscode.TextDocument,
	log: (message: string) => void
): Promise<void> {
	const kind = kindOfPath(document.uri.fsPath);
	if (!kind) {
		void vscode.window.showInformationMessage(
			'Nimbus: これはスキル / サブエージェント / コマンドのファイルではありません。'
		);
		return;
	}
	const problems = validate(kind, document.getText());
	const blocking = problems.filter((problem) => problem.severity === 'error');
	if (blocking.length > 0) {
		// 読み込まれない状態で試しても、何も分からない
		void vscode.window.showWarningMessage(
			`Nimbus: このままでは読み込まれません — ${blocking.map((p) => p.message).join(' / ')}`
		);
		return;
	}
	const name = /\/skills\/([^/]+)\/SKILL\.md$/i.exec(document.uri.fsPath)?.[1]
		?? document.uri.fsPath.split('/').pop()?.replace(/\.md$/, '')
		?? '';
	const input = await vscode.window.showInputBox({
		title: `Nimbus: ${name} を試す`,
		prompt: '渡す内容（空でも可）',
		placeHolder: '例: この画面のバリデーションを見て'
	});
	if (input === undefined) {
		return;
	}

	const sessionId = randomUUID();
	let text = '';
	const done = new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, 180_000);
		const onEvent = (event: { sessionId: string; kind: string; text?: string }): void => {
			if (event.sessionId !== sessionId) {
				return;
			}
			if (event.kind === 'assistant-text' && event.text) {
				text += `${event.text}\n`;
			} else if (event.kind === 'turn-result' || event.kind === 'session-error') {
				clearTimeout(timer);
				sessions.off('event', onEvent);
				resolve();
			}
		};
		sessions.on('event', onEvent);
	});

	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `Nimbus: ${name} を試しています` },
		async () => {
			await sessions.createSession({
				cwd,
				firstMessage: previewPrompt(kind, name, input),
				reuseSessionId: sessionId,
				// 試し打ちで書き換えさせない
				extraOptions: { permissionMode: 'plan' }
			});
			await done;
		}
	);
	try {
		sessions.close(sessionId);
	} catch {
		// すでに閉じている
	}
	log(`[preview] ${name} を試しました`);
	const report = [
		`# 試し打ち: ${name}`,
		'',
		`- 種類: ${kind}`,
		`- 渡した内容: ${input || '（なし）'}`,
		'- モード: plan（ファイルは変更していません）',
		'',
		'## 応答',
		'',
		text.trim() || '（応答がありませんでした）'
	].join('\n');
	const preview = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
	await vscode.window.showTextDocument(preview, { preview: true });
}
