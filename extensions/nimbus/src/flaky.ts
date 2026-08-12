/**
 * テストを何度か回して、揺れているものを見つける（tasks.md T-133）。
 *
 * 「1 回落ちたけど、もう一度やったら通った」で済ませていると、そのうち赤を
 * 読み飛ばすようになる。**回数を決めて回し、結果を突き合わせる**ところを引き受ける。
 *
 * 突き合わせの本体は `core/flaky.ts`（VS Code 非依存・単体テスト済み）。
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { assessStability, formatReport, parseTap, type TestOutcome } from './core/flaky';
import { pickWorkspaceRoot } from './workspaceRoots';

const run = promisify(execFile);

/** 既定の回数。少なすぎると見つからず、多すぎると待てない */
const DEFAULT_RUNS = 5;

export async function findFlakyTests(): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const cwd = folder.uri.fsPath;

	const configured = vscode.workspace.getConfiguration('nimbus').get<string>('tests.command')?.trim();
	const command = configured || (await vscode.window.showInputBox({
		title: 'Nimbus: 何を回しますか',
		prompt: 'テストを走らせるコマンド（TAP を出すものが読めます）',
		value: 'npm test'
	}))?.trim();
	if (!command) {
		return;
	}

	const times = Number(
		(await vscode.window.showQuickPick(['3', '5', '10', '20'], {
			title: 'Nimbus: 何回まわしますか',
			placeHolder: `既定は ${DEFAULT_RUNS} 回。多いほど見つかりますが、そのぶん待ちます`
		})) ?? ''
	);
	if (!Number.isFinite(times) || times <= 0) {
		return;
	}

	const runs: TestOutcome[][] = [];
	const cancelled = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Nimbus: テストを繰り返しています', cancellable: true },
		async (progress, token) => {
			for (let i = 0; i < times; i++) {
				if (token.isCancellationRequested) {
					return true;
				}
				progress.report({ message: `${i + 1} / ${times} 回目`, increment: 100 / times });
				try {
					// 落ちても続ける。落ちること自体が知りたい情報なので
					const { stdout } = await run('sh', ['-c', command], { cwd, maxBuffer: 64 * 1024 * 1024 });
					runs.push(parseTap(stdout));
				} catch (error) {
					const stdout = (error as { stdout?: string }).stdout ?? '';
					runs.push(parseTap(stdout));
				}
			}
			return false;
		}
	);
	if (cancelled) {
		void vscode.window.showInformationMessage('Nimbus: 取りやめました。');
		return;
	}

	const parsedAny = runs.some((outcomes) => outcomes.length > 0);
	if (!parsedAny) {
		void vscode.window.showWarningMessage(
			'Nimbus: テストの結果を読み取れませんでした（TAP 形式の出力が要ります。node --test / tap 系なら読めます）。'
		);
		return;
	}

	const document = await vscode.workspace.openTextDocument({
		content: formatReport(assessStability(runs), runs.length),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
}
