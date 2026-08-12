/**
 * 依存を足す前に見る（tasks.md T-118）。
 *
 * 事実は `npm view` から取る。**ネットに出るのはこのコマンドだけ**で、
 * Nimbus 自身は外へ何も送らない（`npm` に任せる）。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { pickWorkspaceRoot } from './workspaceRoots';
import { audit, findSimilar, renderAudit, type PackageFacts } from './core/depAudit';

function npmView(name: string, cwd: string): Promise<Record<string, unknown> | undefined> {
	return new Promise((resolve) => {
		execFile(
			'npm',
			['view', name, 'name', 'time.modified', 'license', 'deprecated', 'dependencies', '--json'],
			{ cwd, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
			(error, stdout) => {
				if (error) {
					resolve(undefined);
					return;
				}
				try {
					resolve(JSON.parse(stdout) as Record<string, unknown>);
				} catch {
					resolve(undefined);
				}
			}
		);
	});
}

async function installedNames(folder: vscode.WorkspaceFolder): Promise<string[]> {
	try {
		const uri = vscode.Uri.joinPath(folder.uri, 'package.json');
		const json = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		return [...Object.keys(json.dependencies ?? {}), ...Object.keys(json.devDependencies ?? {})];
	} catch {
		return [];
	}
}

export async function auditDependency(): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}

	const name = await vscode.window.showInputBox({
		title: 'Nimbus: 足す前に見る',
		prompt: 'パッケージ名（npm）',
		placeHolder: '例: date-fns',
		validateInput: (value) => (value.trim().length === 0 ? '空にはできません' : undefined)
	});
	if (!name) {
		return;
	}

	const info = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: `Nimbus: ${name} を調べています` },
		async () => npmView(name.trim(), folder.uri.fsPath)
	);
	if (!info) {
		void vscode.window.showInformationMessage(
			`Nimbus: ${name.trim()} の情報を取れませんでした（npm が無い／名前が違う／ネットに出られない）。`
		);
		return;
	}

	const dependencies = info['dependencies'];
	const facts: PackageFacts = {
		name: typeof info['name'] === 'string' ? info['name'] : name.trim(),
		lastPublished: typeof info['time.modified'] === 'string' ? info['time.modified'] : undefined,
		license: typeof info['license'] === 'string' ? info['license'] : undefined,
		deprecated: typeof info['deprecated'] === 'string' ? info['deprecated'] : undefined,
		dependencyCount: dependencies && typeof dependencies === 'object' ? Object.keys(dependencies).length : undefined,
		similarInstalled: findSimilar(name.trim(), await installedNames(folder))
	};

	const document = await vscode.workspace.openTextDocument({
		content: renderAudit(audit(facts, Date.now())),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
}
