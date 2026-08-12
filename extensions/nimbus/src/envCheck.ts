/**
 * 環境の食い違いを見る（tasks.md T-205）。
 *
 * 手元の版は、実際にコマンドを叩いて取る。**入っていないことも情報**なので、
 * 失敗しても止めずに「見つかりません」として扱う。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { collectRequirements, compareEnvironment, renderEnvironment } from './core/envCheck';

/** 道具ごとの、版を聞くコマンド */
const VERSION_COMMANDS: Record<string, string[]> = {
	node: ['node', '--version'],
	npm: ['npm', '--version'],
	dart: ['dart', '--version'],
	flutter: ['flutter', '--version'],
	golang: ['go', 'version'],
	go: ['go', 'version'],
	python: ['python3', '--version'],
	ruby: ['ruby', '--version']
};

function firstVersion(text: string): string | undefined {
	return /(\d+\.\d+(?:\.\d+)?)/.exec(text)?.[1];
}

function ask(command: string[], cwd: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile(command[0], command.slice(1), { cwd, timeout: 10_000 }, (error, stdout, stderr) =>
			// dart や go は stderr に出すことがある
			resolve(error ? undefined : firstVersion(`${stdout}\n${stderr}`))
		);
	});
}

export async function openEnvCheck(): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}

	const uris = await vscode.workspace.findFiles(
		new vscode.RelativePattern(folder, '{.nvmrc,package.json,pubspec.yaml,.tool-versions}'),
		'**/node_modules/**',
		8
	);
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

	const requirements = collectRequirements(files);
	const installed: Record<string, string | undefined> = {};
	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: 'Nimbus: 手元の版を確かめています' },
		async () => {
			for (const tool of new Set(requirements.map((requirement) => requirement.tool))) {
				const command = VERSION_COMMANDS[tool];
				installed[tool] = command ? await ask(command, folder.uri.fsPath) : undefined;
			}
		}
	);

	const document = await vscode.workspace.openTextDocument({
		content: renderEnvironment(compareEnvironment(requirements, installed)),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
}
