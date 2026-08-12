/**
 * ビルドを計って、前回と比べる（tasks.md T-217 / T-129）。
 *
 * 計測するコマンドは設定で決める（プロジェクトごとに違うため）。
 * 記録はワークスペースに持つ。**成果物の大きさは、指定されたときだけ**見る。
 */
import { execFile } from 'child_process';
import { statSync } from 'fs';
import { join } from 'path';
import * as vscode from 'vscode';
import { pickWorkspaceRoot } from './workspaceRoots';
import { compare, renderComparison, trimHistory, type BuildRecord } from './core/buildMetrics';

const HISTORY_KEY = 'nimbus.buildHistory';

function run(command: string, cwd: string): Promise<{ ok: boolean; seconds: number }> {
	const started = Date.now();
	return new Promise((resolve) => {
		execFile(
			process.platform === 'win32' ? 'cmd' : '/bin/sh',
			process.platform === 'win32' ? ['/c', command] : ['-c', command],
			{ cwd, maxBuffer: 64 * 1024 * 1024 },
			(error) => resolve({ ok: !error, seconds: (Date.now() - started) / 1000 })
		);
	});
}

function sizeOf(root: string, relative: string | undefined): number | undefined {
	if (!relative) {
		return undefined;
	}
	try {
		return statSync(join(root, relative)).size;
	} catch {
		return undefined;
	}
}

export async function measureBuild(context: vscode.ExtensionContext): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const root = folder.uri.fsPath;

	const config = vscode.workspace.getConfiguration('nimbus');
	const command = config.get<string>('build.command');
	if (!command) {
		void vscode.window.showInformationMessage(
			'Nimbus: 設定 `nimbus.build.command` にビルドのコマンドを書いてください（例: `flutter build apk`）。'
		);
		return;
	}

	const result = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `Nimbus: ${command}`, cancellable: false },
		async () => run(command, root)
	);

	if (!result.ok) {
		// 落ちたビルドの時間を記録すると、次の比較が狂う
		void vscode.window.showWarningMessage('Nimbus: ビルドが失敗したので記録しません。');
		return;
	}

	const current: BuildRecord = {
		at: Date.now(),
		seconds: result.seconds,
		bytes: sizeOf(root, config.get<string>('build.artifact')),
		commit: undefined
	};

	const history = context.workspaceState.get<BuildRecord[]>(HISTORY_KEY) ?? [];
	const comparison = compare(current, history);
	await context.workspaceState.update(HISTORY_KEY, trimHistory([current, ...history]));

	const document = await vscode.workspace.openTextDocument({
		content: renderComparison(comparison),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
}
