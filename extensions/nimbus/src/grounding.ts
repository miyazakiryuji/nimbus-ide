/**
 * 指示に、実際に使っているライブラリのバージョンを添える（tasks.md T-083）。
 *
 * ハルシネーションでいちばん多いのは「そのバージョンには無い API」を書くこと。
 * マニフェストには**実際のバージョン**が書いてあるので、名前が出たものだけ添える。
 *
 * [signature-attachment](../../../nimbus/docs/specs/signature-attachment.md) と同じ場所
 * （送信の直前）で効かせる。読み取りと文面は `core/dependencies.ts`。
 */
import * as vscode from 'vscode';
import {
	buildGroundingNote,
	mentionedDependencies,
	parseGoMod,
	parsePackageJson,
	parsePubspec,
	type Dependency
} from './core/dependencies';
import { resolveWorkspaceRoot } from './workspaceRoots';

/** マニフェストは変わらないので、ウィンドウを開いている間は覚えておく */
let cached: { key: string; dependencies: Dependency[] } | undefined;

const MANIFESTS: { file: string; parse: (text: string) => Dependency[] }[] = [
	{ file: 'package.json', parse: parsePackageJson },
	{ file: 'pubspec.yaml', parse: parsePubspec },
	{ file: 'go.mod', parse: parseGoMod }
];

async function readDependencies(folder: vscode.WorkspaceFolder): Promise<Dependency[]> {
	if (cached?.key === folder.uri.fsPath) {
		return cached.dependencies;
	}
	const dependencies: Dependency[] = [];
	for (const manifest of MANIFESTS) {
		try {
			const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, manifest.file));
			dependencies.push(...manifest.parse(new TextDecoder().decode(bytes)));
		} catch {
			// 無いマニフェストは飛ばす
		}
	}
	cached = { key: folder.uri.fsPath, dependencies };
	return dependencies;
}

/** マニフェストが変わったら覚え直す */
export function clearDependencyCache(): void {
	cached = undefined;
}

/**
 * 指示に添える文。名前が出ていなければ何も足さない。
 * **黙って毎回付けない** — 関係ないバージョン情報は、指示を読みにくくするだけ。
 */
export async function buildGroundingForPrompt(text: string): Promise<string | undefined> {
	const config = vscode.workspace.getConfiguration('nimbus');
	if (config.get<boolean>('lsp.groundLibraryVersions') === false) {
		return undefined;
	}
	const folder = resolveWorkspaceRoot();
	if (!folder) {
		return undefined;
	}
	const matched = mentionedDependencies(text, await readDependencies(folder));
	const note = buildGroundingNote(matched);
	return note.length > 0 ? note : undefined;
}
