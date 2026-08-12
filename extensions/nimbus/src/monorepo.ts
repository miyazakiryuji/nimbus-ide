/**
 * 作業対象のパッケージだけを見せる（tasks.md T-078）。
 *
 * 選んだパッケージを**これから始めるセッションの作業ディレクトリ**にする。
 * 既に走っているセッションには効かない — 途中で足元を変える方が危ない。
 *
 * 割り出しは `core/monorepo.ts`。ここは探索と保存だけ。
 */
import * as vscode from 'vscode';
import { buildScopeNote, describeScope, findPackages } from './core/monorepo';
import { pickWorkspaceRoot } from './workspaceRoots';

const STORAGE_KEY = 'nimbus.scope';

/** 探すマニフェストの上限。大きなモノレポでも待たせない */
const MAX_MANIFESTS = 400;
const MANIFEST_GLOB = '**/{package.json,pubspec.yaml,go.mod,Cargo.toml,pyproject.toml,build.gradle,build.gradle.kts,pom.xml,Package.swift,composer.json,Gemfile}';
const EXCLUDE = '**/{node_modules,.git,out,dist,build,.dart_tool,target,vendor,.venv}/**';

/** いま絞っている作業ディレクトリ（絶対パス）。絞っていなければ `undefined` */
export function currentScope(storage: vscode.Memento): string | undefined {
	return storage.get<string>(STORAGE_KEY);
}

export interface MonorepoDeps {
	storage: vscode.Memento;
	log: (message: string) => void;
	/** 絞り込みが変わったことを画面に反映する */
	onChanged?: () => void;
}

/** 作業対象のパッケージを選ぶ（「全体に戻す」も同じ入口） */
export async function chooseScope(deps: MonorepoDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const found = await vscode.workspace.findFiles(
		new vscode.RelativePattern(folder, MANIFEST_GLOB),
		EXCLUDE,
		MAX_MANIFESTS
	);
	const packages = findPackages(
		found.map((uri) => uri.path.slice(folder.uri.path.length + 1)).filter((path) => path.length > 0)
	);
	if (packages.length <= 1) {
		void vscode.window.showInformationMessage(
			'Nimbus: パッケージが 1 つしかありません（絞り込む意味がありません）。'
		);
		return;
	}

	const current = currentScope(deps.storage);
	const items: (vscode.QuickPickItem & { scope?: string })[] = [
		{ label: '$(root-folder) リポジトリ全体', description: current ? undefined : '（いま）' },
		...packages.map((entry) => ({
			label: entry.path === '.' ? '$(package) （根）' : `$(package) ${entry.path}`,
			description: entry.manifest,
			detail: current === vscode.Uri.joinPath(folder.uri, entry.path).fsPath ? '（いま）' : undefined,
			scope: vscode.Uri.joinPath(folder.uri, entry.path).fsPath
		}))
	];

	const picked = await vscode.window.showQuickPick(items, {
		title: `Nimbus: ${describeScope(current)}`,
		placeHolder: 'これから始めるセッションが見る範囲を選ぶ'
	});
	if (!picked) {
		return;
	}
	await deps.storage.update(STORAGE_KEY, picked.scope);
	deps.log(`[scope] ${picked.scope ?? 'リポジトリ全体'}`);
	deps.onChanged?.();
	void vscode.window.showInformationMessage(`Nimbus: ${buildScopeNote(picked.scope)}`);
}
