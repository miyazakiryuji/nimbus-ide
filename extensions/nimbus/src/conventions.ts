/**
 * このリポジトリの書き方を数えて渡す（tasks.md T-103）。
 *
 * 「既存のコードに合わせて」と言っても、何に合わせるのかを知らなければ守れない。
 * インデント・引用符・セミコロン・ファイル名・テストの置き場所は数えれば分かる。
 * **分かるものは推測させない。**
 *
 * 数え方と文面は `core/conventions.ts`。ここはファイルを集める口だけ。
 */
import * as vscode from 'vscode';
import { buildConventionsPrompt, detectConventions, renderConventions, type FileSample } from './core/conventions';
import { pickWorkspaceRoot } from './workspaceRoots';

/** 見るファイル数。多く見ても結論は変わらない */
const SAMPLE_LIMIT = 40;
/** 1 ファイルあたりに読む上限（大きな生成物で時間を使わない） */
const MAX_BYTES = 200 * 1024;

const SOURCE_GLOB = '**/*.{ts,tsx,js,jsx,dart,go,py,rb,swift,kt,java}';
const EXCLUDE = '**/{node_modules,.git,out,dist,build,.dart_tool,target,vendor,.venv}/**';

export interface ConventionsDeps {
	send: (text: string) => void;
	log: (message: string) => void;
}

/** ソースの標本を集める。CLAUDE.md のテンプレート（T-319）も同じ数え方を使う */
export async function collectSamples(folder: vscode.WorkspaceFolder): Promise<FileSample[]> {
	const root = folder.uri;
	const files = await vscode.workspace.findFiles(
		new vscode.RelativePattern(folder, SOURCE_GLOB),
		EXCLUDE,
		SAMPLE_LIMIT
	);
	const samples: FileSample[] = [];
	for (const file of files) {
		try {
			const bytes = await vscode.workspace.fs.readFile(file);
			if (bytes.byteLength > MAX_BYTES) {
				continue;
			}
			samples.push({
				path: file.path.slice(root.path.length + 1),
				text: new TextDecoder().decode(bytes)
			});
		} catch {
			// 読めないファイルは飛ばす（数が減るだけ）
		}
	}
	return samples;
}

/** 既存ファイルを数え、結果を見せてからセッションへ渡せるようにする */
export async function showConventions(deps: ConventionsDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}

	const samples = await collectSamples(folder);
	if (samples.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 数えられるソースファイルが見つかりませんでした。');
		return;
	}

	const conventions = detectConventions(samples);
	const summary = renderConventions(conventions);
	deps.log(`[conventions] ${summary.split('\n')[0]}`);

	const prompt = buildConventionsPrompt(conventions);
	if (prompt.length === 0) {
		void vscode.window.showInformationMessage(`Nimbus: ${summary}`);
		return;
	}

	const SEND = 'セッションに渡す';
	const COPY = 'コピーする';
	const choice = await vscode.window.showInformationMessage(
		`Nimbus: ${summary.split('\n')[0]}`,
		{ detail: summary, modal: false },
		SEND,
		COPY
	);
	if (choice === SEND) {
		deps.send(prompt);
	} else if (choice === COPY) {
		// CLAUDE.md に貼るのは利用者の判断。こちらからは書き換えない
		await vscode.env.clipboard.writeText(summary);
		void vscode.window.showInformationMessage('Nimbus: コピーしました（CLAUDE.md に貼れます）。');
	}
}
