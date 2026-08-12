/**
 * 元を直したら、生成物も作り直す（tasks.md T-141）。
 *
 * `model.dart` の `@freezed` を触ったのに `model.g.dart` を作り直し忘れると、
 * **型エラーではなく「古い実装が静かに動く」**という、いちばん気づきにくい壊れかたをする。
 * 保存した瞬間に「作り直しますか」と聞けるようにする。
 *
 * 対応づけと作り直しかたの本体は `core/generated.ts`（VS Code 非依存・単体テスト済み）。
 */
import * as vscode from 'vscode';
import { generatedSiblingsOf, isGeneratedPath, regenerateCommandFor } from './core/generated';
import { resolveWorkspaceRoot } from './workspaceRoots';

/** そのフォルダで生成物を作り直すコマンドを調べる */
async function commandFor(folder: vscode.WorkspaceFolder): Promise<{ command: string; reason: string } | undefined> {
	let names: string[];
	try {
		names = (await vscode.workspace.fs.readDirectory(folder.uri)).map(([name]) => name);
	} catch {
		return undefined;
	}
	const manifestName = names.includes('pubspec.yaml')
		? 'pubspec.yaml'
		: names.includes('package.json')
			? 'package.json'
			: undefined;
	let manifest = '';
	if (manifestName) {
		try {
			const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, manifestName));
			manifest = Buffer.from(bytes).toString('utf8');
		} catch {
			manifest = '';
		}
	}
	return regenerateCommandFor(names, manifest);
}

/** その元ファイルに、実在する生成物があるか */
async function hasGeneratedSiblings(folder: vscode.WorkspaceFolder, filePath: string): Promise<boolean> {
	const relative = vscode.workspace.asRelativePath(vscode.Uri.file(filePath), false);
	for (const sibling of generatedSiblingsOf(relative)) {
		try {
			await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, sibling));
			return true;
		} catch {
			// 無ければ次を見る
		}
	}
	return false;
}

/** 端末で走らせる。出力を人が見られるように、隠さず開く */
function runInTerminal(folder: vscode.WorkspaceFolder, command: string): void {
	const terminal = vscode.window.createTerminal({ name: 'Nimbus: 生成', cwd: folder.uri });
	terminal.show(true);
	terminal.sendText(command);
}

/** コマンドから明示的に走らせる */
export async function regenerateNow(): Promise<void> {
	const folder = resolveWorkspaceRoot();
	if (!folder) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}
	const found = await commandFor(folder);
	if (!found) {
		void vscode.window.showInformationMessage(
			'Nimbus: 生成ツールが見つかりませんでした（build_runner / prisma / graphql-codegen / go generate を見ています）。'
		);
		return;
	}
	const RUN = '走らせる';
	const choice = await vscode.window.showInformationMessage(
		`Nimbus: ${found.command}`,
		{ modal: true, detail: `${found.reason}。端末を開いて走らせます。` },
		RUN
	);
	if (choice === RUN) {
		runInTerminal(folder, found.command);
	}
}

/**
 * 保存を見張って、生成物のある元ファイルが変わったら声をかける。
 * **黙って走らせない。** 生成は時間がかかるうえ、途中の状態で走らせたくない場面もある。
 */
export function watchForRegeneration(log: (message: string) => void): vscode.Disposable {
	// 一度断られたフォルダでは、そのセッション中は聞き直さない（うるさくしない）
	const declined = new Set<string>();
	return vscode.workspace.onDidSaveTextDocument(async (document) => {
		if (vscode.workspace.getConfiguration('nimbus').get<boolean>('generate.offerAfterSave') !== true) {
			return;
		}
		const filePath = document.uri.fsPath;
		if (isGeneratedPath(filePath)) {
			return;
		}
		const folder = vscode.workspace.getWorkspaceFolder(document.uri);
		if (!folder || declined.has(folder.uri.fsPath)) {
			return;
		}
		if (!(await hasGeneratedSiblings(folder, filePath))) {
			return;
		}
		const found = await commandFor(folder);
		if (!found) {
			return;
		}
		const RUN = '作り直す';
		const NEVER = 'このセッションでは聞かない';
		const choice = await vscode.window.showInformationMessage(
			`Nimbus: ${vscode.workspace.asRelativePath(document.uri, false)} には生成物があります。作り直しますか。`,
			RUN,
			NEVER
		);
		if (choice === RUN) {
			log(`[generate] ${found.command}`);
			runInTerminal(folder, found.command);
		} else if (choice === NEVER) {
			declined.add(folder.uri.fsPath);
		}
	});
}
