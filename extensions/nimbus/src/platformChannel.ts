/**
 * Platform Channel の突き合わせを開く（tasks.md T-200）。
 *
 * Dart は `lib/`、ネイティブは `ios/` と `android/` を見る。
 */
import * as vscode from 'vscode';
import { crossCheck, parseDart, parseNative, renderChannelFindings, type ChannelUsage } from './core/platformChannel';

const MAX_FILES = 300;

async function readAll(pattern: string, exclude: string): Promise<{ path: string; content: string }[]> {
	const uris = await vscode.workspace.findFiles(pattern, exclude, MAX_FILES);
	const files: { path: string; content: string }[] = [];
	for (const uri of uris) {
		try {
			files.push({
				path: vscode.workspace.asRelativePath(uri),
				content: Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')
			});
		} catch {
			continue;
		}
	}
	return files;
}

export async function openPlatformChannels(): Promise<void> {
	if (!vscode.workspace.workspaceFolders?.length) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}

	const { dart, native } = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: 'Nimbus: 橋渡しを突き合わせています' },
		async () => {
			const dartFiles = await readAll('**/lib/**/*.dart', '**/{build,.dart_tool}/**');
			const nativeFiles = [
				...(await readAll('**/ios/**/*.swift', '**/{Pods,build}/**')),
				...(await readAll('**/android/**/*.kt', '**/build/**'))
			];
			const dartUsages: ChannelUsage[] = dartFiles.flatMap((file) => parseDart(file.path, file.content));
			const nativeUsages: ChannelUsage[] = nativeFiles.flatMap((file) => parseNative(file.path, file.content));
			return { dart: dartUsages, native: nativeUsages };
		}
	);

	if (dart.length === 0 && native.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: `MethodChannel` が見つかりません。');
		return;
	}

	const document = await vscode.workspace.openTextDocument({
		content: renderChannelFindings(crossCheck(dart, native)),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
}
