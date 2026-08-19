/**
 * 会話の中のコードブロックに付ける操作（tasks.md T-271）。
 *
 * VS Code のチャットと同じ 4 つ ── **写す / エディタへ入れる / 新しいファイルにする / ターミナルへ送る**。
 * 出てきたコードを手で選び直して貼るのは、1 日に何十回もやると効いてくる（人間工学 E1）。
 *
 * **ターミナルへは「送るだけ」で、実行はしない。** 改行を付けて送ると、
 * 押した瞬間に走る。何が走るかを見てから Enter を押せるほうが、取り返しがつく（人間工学 E3）。
 */
import * as vscode from 'vscode';

/** コードブロックの操作。webview から来る `action` と 1 対 1 */
export type CodeAction = 'copy' | 'insert' | 'newFile' | 'terminal';

/**
 * 言語名を VS Code の言語 ID に寄せる。
 * 応答は `ts` `sh` のような短い名前で返ってくるが、エディタは `typescript` `shellscript` で持っている。
 */
const LANGUAGE_ALIAS: Readonly<Record<string, string>> = {
	ts: 'typescript',
	tsx: 'typescriptreact',
	js: 'javascript',
	jsx: 'javascriptreact',
	py: 'python',
	rb: 'ruby',
	rs: 'rust',
	kt: 'kotlin',
	sh: 'shellscript',
	bash: 'shellscript',
	zsh: 'shellscript',
	yml: 'yaml',
	md: 'markdown'
};

export function toLanguageId(language: string): string | undefined {
	const name = language.trim().toLowerCase();
	if (name.length === 0) {
		return undefined;
	}
	return LANGUAGE_ALIAS[name] ?? name;
}

/**
 * 押されたコードブロックの操作を実行する。
 *
 * どれも**その場で結果が見える**ようにしてある。押したのに何も起きないと、
 * 効いたのか分からないまま同じボタンを押し直すことになる（T-244）。
 */
export async function runCodeAction(
	action: CodeAction,
	text: string,
	language: string,
	notify: (message: string) => void
): Promise<void> {
	switch (action) {
		case 'copy':
			await vscode.env.clipboard.writeText(text);
			notify('コードを写しました。');
			return;

		case 'insert': {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				// 入れ先が無いのに黙って何もしないと、押せていないように見える
				notify('入れ先のエディタが開いていません。ファイルを開いてから押してください。');
				return;
			}
			await editor.edit((builder) => {
				for (const selection of editor.selections) {
					builder.replace(selection, text);
				}
			});
			return;
		}

		case 'newFile': {
			const document = await vscode.workspace.openTextDocument({
				content: text,
				language: toLanguageId(language)
			});
			await vscode.window.showTextDocument(document, { preview: false });
			return;
		}

		case 'terminal': {
			const terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal('Nimbus');
			terminal.show(true);
			// 改行は付けない。走らせるかどうかは利用者が決める
			terminal.sendText(text, false);
			return;
		}
	}
}
