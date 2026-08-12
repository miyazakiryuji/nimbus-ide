/**
 * 出す前に見る（tasks.md T-215）。
 *
 * 集めるのは**確かめずに分かること**だけ（Git の状態と、変更した行）。
 * テストとビルドは走らせるかどうかを聞く — 黙って重いものを走らせない。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { addedLinesFromDiff, findLeftovers, renderPreflight, runPreflight, type PreflightInput } from './core/preflight';

function git(args: string[], cwd: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) =>
			resolve(error ? undefined : stdout.trim())
		);
	});
}

function run(command: string, cwd: string): Promise<boolean> {
	return new Promise((resolve) => {
		execFile(command, { cwd, shell: true, maxBuffer: 32 * 1024 * 1024 }, (error) => resolve(!error));
	});
}

/** 前回の出荷（いちばん新しいタグ）から版が上がっているか */
async function versionBumped(root: string): Promise<boolean | undefined> {
	const tag = await git(['describe', '--tags', '--abbrev=0'], root);
	if (!tag) {
		return undefined;
	}
	const current = await git(['show', 'HEAD:package.json'], root);
	const previous = await git(['show', `${tag}:package.json`], root);
	if (!current || !previous) {
		return undefined;
	}
	const read = (json: string): string | undefined => {
		try {
			return (JSON.parse(json) as { version?: string }).version;
		} catch {
			return undefined;
		}
	};
	const before = read(previous);
	const after = read(current);
	return before === undefined || after === undefined ? undefined : before !== after;
}

export async function openPreflight(): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}

	const choice = await vscode.window.showQuickPick(
		[
			{ label: '確かめずに分かることだけ見る', description: 'Git の状態と、変更した行。すぐ終わります', run: false },
			{ label: 'テストとビルドも走らせる', description: '時間がかかります', run: true }
		],
		{ title: '出す前に何を見ますか' }
	);
	if (!choice) {
		return;
	}

	const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], root)) ?? '(不明)';
	const releaseBranch =
		vscode.workspace.getConfiguration('nimbus').get<string>('git.baseBranch') ??
		((await git(['rev-parse', '--verify', 'main'], root)) ? 'main' : 'master');

	const status = (await git(['status', '--porcelain'], root)) ?? '';
	const dirtyFiles = status
		.split('\n')
		.map((line) => line.slice(3).trim())
		.filter((path) => path.length > 0);

	const unpushed = await git(['rev-list', '--count', '@{u}..HEAD'], root);
	const diff = (await git(['diff', `${releaseBranch}...HEAD`, '--unified=0'], root)) ?? '';

	const input: PreflightInput = {
		branch,
		releaseBranch,
		dirtyFiles,
		unpushedCommits: unpushed === undefined ? 0 : Number(unpushed),
		leftovers: findLeftovers(addedLinesFromDiff(diff)),
		versionBumped: await versionBumped(root)
	};

	if (choice.run) {
		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: 'Nimbus: テストとビルドを走らせています' },
			async () => {
				input.testsPassed = await run('npm test', root);
				input.buildPassed = await run('npm run build --if-present', root);
			}
		);
	}

	const document = await vscode.workspace.openTextDocument({
		language: 'markdown',
		content: renderPreflight(runPreflight(input))
	});
	await vscode.window.showTextDocument(document, { preview: true });
}
