/**
 * 型の変更が壊す場所を洗い出す（tasks.md T-123）。
 *
 * バックエンドの型が変わったとき、フロント側のどこが壊れるかは型エラーが出るまで分からない。
 * **変わった型の名前**さえ分かれば、参照検索で触っている場所は機械的に出せる。
 *
 * 判定と文面は `core/schemaImpact.ts`。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { displayPath } from './core/lsp';
import {
	buildImpactPrompt,
	changedTypes,
	describeImpacts,
	type TypeImpact
} from './core/schemaImpact';
import { pickWorkspaceRoot } from './workspaceRoots';

export interface SchemaImpactDeps {
	send: (text: string) => void;
	log: (message: string) => void;
}

function git(cwd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
			if (error) {
				reject(error);
				return;
			}
			resolve(stdout);
		});
	});
}

/** その型を参照しているファイル（定義元は除く） */
async function referencingFiles(type: string, roots: string[]): Promise<string[]> {
	const symbols =
		(await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
			'vscode.executeWorkspaceSymbolProvider',
			type
		)) ?? [];
	const definition = symbols.find((symbol) => symbol.name === type);
	if (!definition) {
		return [];
	}
	const references =
		(await vscode.commands.executeCommand<vscode.Location[]>(
			'vscode.executeReferenceProvider',
			definition.location.uri,
			definition.location.range.start
		)) ?? [];
	const files = new Set<string>();
	for (const reference of references) {
		if (reference.uri.fsPath !== definition.location.uri.fsPath) {
			files.add(displayPath(roots, reference.uri.fsPath));
		}
	}
	return [...files].sort();
}

/** 変えた型を参照している場所を集め、壊れていないかを確かめさせる */
export async function trackSchemaImpact(deps: SchemaImpactDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const root = folder.uri.fsPath;

	let diff: string;
	try {
		diff = await git(root, ['diff', 'HEAD']);
	} catch (error) {
		deps.log(`[schema] 差分を取れませんでした: ${error instanceof Error ? error.message : String(error)}`);
		void vscode.window.showErrorMessage('Nimbus: git の差分を取得できませんでした。');
		return;
	}

	const types = changedTypes(diff);
	if (types.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 変わった型は見つかりませんでした。');
		return;
	}

	const impacts: TypeImpact[] = [];
	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: 'Nimbus: 参照している場所を探しています' },
		async () => {
			for (const type of types) {
				impacts.push({ type, files: await referencingFiles(type, [root]) });
			}
		}
	);

	const summary = describeImpacts(impacts);
	deps.log(`[schema] ${summary.split('\n')[0]}`);
	const prompt = buildImpactPrompt(impacts);
	if (prompt.length === 0) {
		void vscode.window.showInformationMessage(`Nimbus: ${summary}`);
		return;
	}

	const SEND = '確かめさせる';
	const choice = await vscode.window.showWarningMessage(
		`Nimbus: ${summary.split('\n')[0]}`,
		{ detail: summary, modal: false },
		SEND
	);
	if (choice === SEND) {
		deps.send(prompt);
	}
}
