/**
 * CI を手元で再現する（tasks.md T-132）。
 *
 * ワークフローを選ばせて、打つ順を出す。**実行はしない。**
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { pickWorkspaceRoot } from './workspaceRoots';
import { parseWorkflow, renderCiRepro } from './core/ciRepro';

/** 版を聞くコマンド（環境の突き合わせに使う） */
const VERSION_COMMANDS: Record<string, string[]> = {
	node: ['node', '--version'],
	python: ['python3', '--version'],
	go: ['go', 'version'],
	java: ['java', '-version'],
	dotnet: ['dotnet', '--version']
};

function ask(command: string[], cwd: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile(command[0], command.slice(1), { cwd, timeout: 10_000 }, (error, stdout, stderr) =>
			resolve(error ? undefined : /(\d+\.\d+(?:\.\d+)?)/.exec(`${stdout}\n${stderr}`)?.[1])
		);
	});
}

export async function openCiRepro(): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}

	const found = await vscode.workspace.findFiles(
		new vscode.RelativePattern(folder, '.github/workflows/*.{yml,yaml}'),
		undefined,
		30
	);
	if (found.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: `.github/workflows` にワークフローが見つかりません。');
		return;
	}

	const picked = found.length === 1
		? found[0]
		: (await vscode.window.showQuickPick(
			found.map((uri) => ({ label: vscode.workspace.asRelativePath(uri), uri })),
			{ title: 'Nimbus: どのワークフローを再現しますか' }
		))?.uri;
	if (!picked) {
		return;
	}

	const yaml = Buffer.from(await vscode.workspace.fs.readFile(picked)).toString('utf8');
	const { steps, environment } = parseWorkflow(yaml);

	const local: Record<string, string | undefined> = {};
	for (const version of environment.versions) {
		const command = VERSION_COMMANDS[version.tool];
		local[version.tool] = command ? await ask(command, folder.uri.fsPath) : undefined;
	}

	const document = await vscode.workspace.openTextDocument({
		content: renderCiRepro(steps, environment, local),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
}
