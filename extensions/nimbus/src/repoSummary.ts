/**
 * リポジトリの構造要約カードを作る（tasks.md T-176）。
 *
 * 「何のプロジェクトで、どこに何があるか」を数えて 1 枚にする。
 * 人には地図、エージェントには**探索の節約**（最初の数ターンを構造調べに使わせない）。
 *
 * 事実の集め方だけをここに置き、文面は `core/repoSummary.ts`。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { pickWorkspaceRoot } from './workspaceRoots';
import {
	buildRepoSummaryPrompt,
	rankDirectories,
	renderRepoSummary,
	type RepoFacts
} from './core/repoSummary';

/** 数えるファイル数の上限。大きなリポジトリで固まらせない */
const MAX_FILES = 4000;
/** 上位ディレクトリを見る数の上限 */
const MAX_DIRECTORIES = 20;

const MANIFESTS = [
	'package.json',
	'pubspec.yaml',
	'go.mod',
	'Cargo.toml',
	'pyproject.toml',
	'requirements.txt',
	'Package.swift',
	'build.gradle',
	'build.gradle.kts',
	'pom.xml',
	'Gemfile',
	'composer.json'
];

const EXCLUDE = '**/{node_modules,.git,out,dist,build,.dart_tool,target,vendor,.venv}/**';

function git(cwd: string, args: string[]): Promise<string> {
	return new Promise((resolve) => {
		execFile('git', args, { cwd, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
			resolve(error ? '' : stdout.trim());
		});
	});
}

async function readJsonName(root: vscode.Uri): Promise<{ name?: string; description?: string }> {
	try {
		const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, 'package.json'));
		const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { name?: string; description?: string };
		return { name: parsed.name, description: parsed.description };
	} catch {
		return {};
	}
}

/** リポジトリの事実を数える */
export async function collectRepoFacts(folder: vscode.WorkspaceFolder): Promise<RepoFacts> {
	const root = folder.uri;
	let entries: [string, vscode.FileType][] = [];
	try {
		entries = await vscode.workspace.fs.readDirectory(root);
	} catch {
		// 読めないルート（権限・リモート）でも、残りの数え上げは続ける
	}
	const manifests = entries
		.filter(([name, type]) => type === vscode.FileType.File && MANIFESTS.includes(name))
		.map(([name]) => name);

	const files = await vscode.workspace.findFiles(
		new vscode.RelativePattern(folder, '**/*'),
		EXCLUDE,
		MAX_FILES
	);

	const perDirectory = new Map<string, number>();
	const perExtension = new Map<string, number>();
	let claudeMd = 0;
	for (const file of files) {
		const relative = file.path.slice(root.path.length + 1);
		const top = relative.includes('/') ? relative.slice(0, relative.indexOf('/')) : '';
		if (top.length > 0) {
			perDirectory.set(top, (perDirectory.get(top) ?? 0) + 1);
		}
		const dot = relative.lastIndexOf('.');
		if (dot > 0) {
			const extension = relative.slice(dot);
			perExtension.set(extension, (perExtension.get(extension) ?? 0) + 1);
		}
		if (relative.endsWith('CLAUDE.md')) {
			claudeMd++;
		}
	}

	const { name, description } = await readJsonName(root);
	const [branch, lastCommit] = await Promise.all([
		git(root.fsPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
		git(root.fsPath, ['log', '-1', '--pretty=%s（%ar）'])
	]);

	return {
		name: name ?? folder.name,
		description,
		manifests,
		directories: rankDirectories(
			[...perDirectory.entries()].map(([directory, count]) => ({ name: directory, files: count })),
			MAX_DIRECTORIES
		),
		languages: [...perExtension.entries()]
			.map(([extension, count]) => ({ extension, files: count }))
			.sort((a, b) => b.files - a.files)
			.slice(0, 8),
		branch: branch || undefined,
		lastCommit: lastCommit || undefined,
		claudeMd
	};
}

export interface RepoSummaryDeps {
	send: (text: string) => void;
	log: (message: string) => void;
}

/** カードを開き、そのままセッションへ渡せるようにする */
export async function showRepoSummary(deps: RepoSummaryDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const facts = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: 'Nimbus: リポジトリを数えています' },
		() => collectRepoFacts(folder)
	);
	deps.log(`[repo] ${facts.name}: ${facts.directories.length} ディレクトリ / manifest ${facts.manifests.length} 件`);

	const document = await vscode.workspace.openTextDocument({
		language: 'markdown',
		content: renderRepoSummary(facts)
	});
	await vscode.window.showTextDocument(document, { preview: false });

	const SEND = 'セッションに渡す';
	const choice = await vscode.window.showInformationMessage(
		'Nimbus: 構造要約を作りました。セッションに渡すと、最初の探索を省けます。',
		SEND
	);
	if (choice === SEND) {
		deps.send(buildRepoSummaryPrompt(facts));
	}
}
