/**
 * 依存の食い違いを開く（tasks.md T-198）。
 *
 * ネイティブ側を持つパッケージ（プラグイン）は `pubspec.lock` からは分からないので、
 * **`.flutter-plugins-dependencies` があればそこから取る**。無ければ pod 側は見ない
 * （分からないものを推測して指摘しない）。
 */
import * as vscode from 'vscode';
import { checkConsistency, renderConsistency } from './core/depConsistency';
import { parsePubspecLock } from './core/lockDiff';

async function read(uri: vscode.Uri): Promise<string | undefined> {
	try {
		return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
	} catch {
		return undefined;
	}
}

/** `.flutter-plugins-dependencies`（`flutter pub get` が作る）からプラグイン名を取る */
function pluginNames(json: string | undefined): string[] {
	if (!json) {
		return [];
	}
	try {
		const parsed = JSON.parse(json) as { plugins?: { ios?: { name?: string }[] } };
		return (parsed.plugins?.ios ?? []).map((plugin) => plugin.name ?? '').filter(Boolean);
	} catch {
		return [];
	}
}

export async function openDepConsistency(): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}

	const pubspec = await read(vscode.Uri.joinPath(folder.uri, 'pubspec.yaml'));
	if (!pubspec) {
		void vscode.window.showInformationMessage('Nimbus: `pubspec.yaml` が見つかりません（Flutter / Dart のプロジェクトで使えます）。');
		return;
	}

	const lock = await read(vscode.Uri.joinPath(folder.uri, 'pubspec.lock'));
	const podfileLock = await read(vscode.Uri.joinPath(folder.uri, 'ios', 'Podfile.lock'));
	const plugins = pluginNames(await read(vscode.Uri.joinPath(folder.uri, '.flutter-plugins-dependencies')));

	const findings = checkConsistency({
		pubspec,
		pubspecLockNames: lock ? [...parsePubspecLock(lock).keys()] : undefined,
		podfileLock,
		knownPlugins: plugins
	});

	const document = await vscode.workspace.openTextDocument({
		content: renderConsistency(findings),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
}
