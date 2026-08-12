/**
 * 障害のログから、まず落ちるテストを起こす（tasks.md T-143）。
 *
 * 障害を直しにいくときにいちばんやってはいけないのが、**再現しないまま直したつもりになる**こと。
 * 直ったかどうかを確かめる手立てが無いままコードだけ変わり、次に同じものが来たときに
 * また最初から調べ直すことになる。
 *
 * 判断の本体は `core/reproTest.ts`（VS Code 非依存・単体テスト済み）。
 */
import * as vscode from 'vscode';
import { buildReproTest, detectFramework, formatReport, parseErrorReport, reproTestPath } from './core/reproTest';
import { pickWorkspaceRoot } from './workspaceRoots';

export async function reproduceFromLog(send: (text: string) => void): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}

	const document = await vscode.workspace.openTextDocument({
		content: '# 障害のログ\n\nここに例外・クラッシュログを貼って、タブを閉じずに「貼りました」を押してください。\n',
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
	const OK = '貼りました';
	if ((await vscode.window.showInformationMessage('Nimbus: ログを貼ったら押してください。', { modal: true }, OK)) !== OK) {
		return;
	}

	const report = parseErrorReport(document.getText());
	if (!report) {
		void vscode.window.showWarningMessage('Nimbus: ログから例外を読み取れませんでした。');
		return;
	}

	let names: string[] = [];
	let manifest = '';
	try {
		names = (await vscode.workspace.fs.readDirectory(folder.uri)).map(([name]) => name);
		const which = names.includes('pubspec.yaml') ? 'pubspec.yaml' : names.includes('package.json') ? 'package.json' : undefined;
		if (which) {
			manifest = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, which))).toString('utf8');
		}
	} catch {
		// 読めなくても、まとめだけは出せる
	}
	const framework = detectFramework(names, manifest);

	// まず状況のまとめを出す。ここを読んでから手を動かしてほしい
	const summary = await vscode.workspace.openTextDocument({ content: formatReport(report), language: 'markdown' });
	await vscode.window.showTextDocument(summary, { preview: false });

	const MAKE = framework ? '落ちるテストの雛形を作る' : undefined;
	const ASK = 'Claude に再現を頼む';
	const choice = await vscode.window.showInformationMessage(
		'Nimbus: 再現するテストを先に書きます。',
		...[MAKE, ASK].filter((label): label is string => Boolean(label))
	);

	if (choice === MAKE && framework) {
		const relative = reproTestPath(report.origin, framework);
		const content = buildReproTest(report, framework);
		if (relative) {
			const target = vscode.Uri.joinPath(folder.uri, relative);
			try {
				await vscode.workspace.fs.stat(target);
				// 既にあるものは潰さない
				void vscode.window.showWarningMessage(`Nimbus: ${relative} は既にあります。開くだけにします。`);
				await vscode.window.showTextDocument(target, { preview: false });
				return;
			} catch {
				await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
				await vscode.window.showTextDocument(target, { preview: false });
				void vscode.window.showInformationMessage(
					`Nimbus: ${relative} を作りました。**いまは落ちます** — TODO を埋めて再現してから直してください。`
				);
				return;
			}
		}
		// 置き場所が決まらないときは、開くだけにする（適当な場所に置かない）
		const scratch = await vscode.workspace.openTextDocument({ content, language: framework === 'dart' ? 'dart' : 'typescript' });
		await vscode.window.showTextDocument(scratch, { preview: false });
		return;
	}
	if (choice === ASK) {
		send(`${formatReport(report)}\n\n---\n\n上のログについて、**まず落ちるテスト**を書いてください。直すのはその後です。`);
	}
}
