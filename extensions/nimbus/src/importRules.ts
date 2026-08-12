/**
 * Cursor / Copilot などの設定を CLAUDE.md へ取り込む（tasks.md T-068）。
 *
 * 書き溜めた指示を書き直させるのは移行の壁でしかないし、書き直す過程で必ず抜ける。
 * **出どころを添えて、そのまま並べる。**
 *
 * 変換と文面は `core/importRules.ts`。ここは探索と追記だけ。
 */
import * as vscode from 'vscode';
import { convertToClaudeMd, describeImport, type RuleSource } from './core/importRules';
import { pickWorkspaceRoot } from './workspaceRoots';

const RULE_GLOB = '{.cursorrules,.windsurfrules,.cursor/rules/*.mdc,.github/copilot-instructions.md,.github/instructions/*.instructions.md}';

export interface ImportRulesDeps {
	log: (message: string) => void;
	/** 日付（テストで差し替えられるように） */
	today?: () => string;
}

/** 他のツールの設定を見つけて、CLAUDE.md の末尾へ足す */
export async function importOtherToolRules(deps: ImportRulesDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, RULE_GLOB), undefined, 50);
	const sources: RuleSource[] = [];
	for (const file of found) {
		try {
			sources.push({
				path: file.path.slice(folder.uri.path.length + 1),
				text: new TextDecoder().decode(await vscode.workspace.fs.readFile(file))
			});
		} catch {
			// 読めないものは飛ばす
		}
	}

	const summary = describeImport(sources);
	deps.log(`[import] ${summary.split('\n')[0]}`);
	if (sources.length === 0) {
		void vscode.window.showInformationMessage(`Nimbus: ${summary}`);
		return;
	}

	const today = (deps.today ?? (() => new Date().toISOString().slice(0, 10)))();
	const addition = convertToClaudeMd(sources, today);
	if (addition.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 取り込める中身がありませんでした（frontmatter だけの設定など）。');
		return;
	}

	const CONFIRM = 'CLAUDE.md に足す';
	const choice = await vscode.window.showWarningMessage(
		`Nimbus: ${summary.split('\n')[0]}。CLAUDE.md の末尾に足します。`,
		{ modal: true, detail: `${summary}\n\n中身は変換しません。出どころを見出しにして、そのまま並べます。` },
		CONFIRM
	);
	if (choice !== CONFIRM) {
		return;
	}

	const target = vscode.Uri.joinPath(folder.uri, 'CLAUDE.md');
	let existing = '';
	try {
		existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(target));
	} catch {
		// 無ければ新規作成
	}
	const separator = existing.length === 0 ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
	await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(`${existing}${separator}${addition}`));
	await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
	deps.log(`[import] CLAUDE.md へ ${sources.length} 件を追記しました`);
}
