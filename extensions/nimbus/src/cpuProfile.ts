/**
 * 計測結果を渡して、重いところを見つけさせる（tasks.md T-128）。
 *
 * `.cpuprofile` は Chrome DevTools でも `node --cpu-prof` でも出る。
 * どちらも同じ形なので、**取り方は問わない**。
 */
import * as vscode from 'vscode';
import { buildProfilePrompt, ownCode, parseProfile, renderProfile } from './core/cpuProfile';
import { pickWorkspaceRoot } from './workspaceRoots';

export interface CpuProfileDeps {
	send: (text: string) => void;
	log: (message: string) => void;
}

/** ワークスペースの中にある `.cpuprofile` を、新しい順に */
async function findProfiles(folder: vscode.WorkspaceFolder): Promise<vscode.Uri[]> {
	const found = await vscode.workspace.findFiles(
		new vscode.RelativePattern(folder, '**/*.{cpuprofile,heapprofile}'),
		'**/node_modules/**',
		50
	);
	const withTime = await Promise.all(
		found.map(async (file) => ({ file, at: (await vscode.workspace.fs.stat(file)).mtime }))
	);
	return withTime.sort((a, b) => b.at - a.at).map((entry) => entry.file);
}

export async function importCpuProfile(deps: CpuProfileDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}

	const profiles = await findProfiles(folder);
	const picked =
		profiles.length > 0
			? (
				await vscode.window.showQuickPick(
					[
						...profiles.map((file) => ({
							label: vscode.workspace.asRelativePath(file, false),
							file: file as vscode.Uri | undefined
						})),
						{ label: '$(folder-opened) 別の場所から選ぶ…', file: undefined }
					],
					{ title: '計測結果を選ぶ' }
				)
			)?.file
			: undefined;

	let target = picked;
	if (!target) {
		const chosen = await vscode.window.showOpenDialog({
			title: '計測結果を選ぶ',
			filters: { '計測結果': ['cpuprofile', 'heapprofile', 'json'] },
			canSelectMany: false
		});
		target = chosen?.[0];
	}
	if (!target) {
		return;
	}

	const summary = parseProfile(new TextDecoder().decode(await vscode.workspace.fs.readFile(target)));
	if (summary.hotSpots.length === 0) {
		void vscode.window.showWarningMessage('Nimbus: 計測結果を読み取れませんでした（`.cpuprofile` を選んでください）。');
		return;
	}

	const document = await vscode.workspace.openTextDocument({
		language: 'markdown',
		content: renderProfile(summary)
	});
	await vscode.window.showTextDocument(document, { preview: true });

	const own = ownCode(summary.hotSpots);
	deps.log(`[profile] ${summary.totalMs.toFixed(0)} ms / 自分のコード ${own.length} 箇所`);

	const answer = await vscode.window.showInformationMessage(
		own.length > 0
			? `Nimbus: 自分のコードで時間を使っている箇所が ${own.length} 件あります。調べさせますか？`
			: 'Nimbus: 自分のコードには目立つ時間が出ていません。それでも調べさせますか？',
		'調べさせる',
		'閉じる'
	);
	if (answer === '調べさせる') {
		deps.send(buildProfilePrompt(summary));
	}
}
