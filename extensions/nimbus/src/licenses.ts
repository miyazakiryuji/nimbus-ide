/**
 * 依存のライセンスを見る（tasks.md T-076）。
 *
 * 読むのは各パッケージの `package.json` の `license` だけ
 * （コメントの中に `node_modules` のワイルドカードを書くと、`*` と `/` がコメントを閉じてしまう）。
 * **ライセンス本文は読まない**（同じ物を何百回も読むことになるうえ、判定はどのみち人の仕事）。
 */
import * as vscode from 'vscode';
import { classifyAll, renderLicenses, summarizeLicenses } from './core/licenses';

/** 見るパッケージ数の上限。大きなリポジトリで固まらせない */
const MAX_PACKAGES = 1500;

export async function openLicenses(): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}

	const manifests = await vscode.workspace.findFiles(
		new vscode.RelativePattern(folder, '**/node_modules/*/package.json'),
		undefined,
		MAX_PACKAGES
	);
	if (manifests.length === 0) {
		void vscode.window.showInformationMessage(
			'Nimbus: `node_modules` が見つかりません（いまは npm の依存だけ見ます）。'
		);
		return;
	}

	const packages = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: 'Nimbus: ライセンスを読んでいます' },
		async () => {
			const found: { name: string; license?: string }[] = [];
			for (const uri of manifests) {
				try {
					const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
					const json = JSON.parse(raw) as { name?: string; license?: unknown; licenses?: unknown };
					const license =
						typeof json.license === 'string'
							? json.license
							: Array.isArray(json.licenses)
								? (json.licenses as { type?: string }[]).map((entry) => entry.type).filter(Boolean).join(' OR ')
								: undefined;
					found.push({ name: json.name ?? uri.path, license });
				} catch {
					continue;
				}
			}
			return found;
		}
	);

	const classified = classifyAll(packages);
	const document = await vscode.workspace.openTextDocument({
		content: renderLicenses(classified, summarizeLicenses(classified)),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
}
