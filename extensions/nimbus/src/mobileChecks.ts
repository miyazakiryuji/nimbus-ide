/**
 * モバイルの提出前チェックを開く（tasks.md T-196 / T-197 / T-201）。
 *
 * 権限の差分は HEAD と比べる。プライバシーマニフェストと版はワークスペースを見る。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { checkSubmission, diffPermissions, renderMobileChecks } from './core/mobileChecks';

function git(args: string[], cwd: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => resolve(error ? undefined : stdout));
	});
}

async function readIfExists(uri: vscode.Uri): Promise<string | undefined> {
	try {
		return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
	} catch {
		return undefined;
	}
}

export async function openMobileChecks(): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}
	const root = folder.uri.fsPath;

	const plists = await vscode.workspace.findFiles('**/ios/Runner/Info.plist', '**/{Pods,build}/**', 2);
	const plistUri = plists[0];
	const plist = plistUri ? await readIfExists(plistUri) : undefined;
	if (!plist) {
		void vscode.window.showInformationMessage('Nimbus: `ios/Runner/Info.plist` が見つかりません（Flutter / iOS のプロジェクトで使えます）。');
		return;
	}

	const relative = vscode.workspace.asRelativePath(plistUri);
	const head = (await git(['show', `HEAD:${relative}`], root)) ?? plist;

	const privacy = await vscode.workspace.findFiles('**/PrivacyInfo.xcprivacy', '**/{Pods,build}/**', 1);
	const pubspec = await readIfExists(vscode.Uri.joinPath(folder.uri, 'pubspec.yaml'));
	const version = pubspec ? /^version:\s*(\S+)/m.exec(pubspec)?.[1] : undefined;
	const lastTag = (await git(['describe', '--tags', '--abbrev=0'], root))?.trim().replace(/^v/, '');

	const markdown = renderMobileChecks(
		diffPermissions(head, plist),
		checkSubmission({
			plist,
			hasPrivacyManifest: privacy.length > 0,
			version,
			lastReleasedVersion: lastTag || undefined
		})
	);

	const document = await vscode.workspace.openTextDocument({ content: markdown, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: false });
}
