/**
 * 差分を読む前の見取り図を出す（tasks.md T-157）。
 *
 * `git diff HEAD`（まだコミットが無ければ空ツリー — T-353）を構造として要約し、新しいタブに開く。
 * 「意図」までは機械には分からないので、そこは Claude に投げられるようにしてある。
 *
 * 要約の本体は `core/diffSummary.ts`（VS Code 非依存・単体テスト済み）。
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { pickWorkspaceRoot } from './workspaceRoots';
import { formatSummary, intentPrompt, summarizeDiff } from './core/diffSummary';
import { diffBaseRevision } from './core/gitTools';

const run = promisify(execFile);

/**
 * このフォルダに、コミットが 1 つでもあるか（T-353）。
 *
 * `--verify --quiet` なら、まだ 1 度もコミットしていないフォルダ（unborn HEAD）でも
 * **英文を出さずに** rc=1 で落ちる。git のフォルダでないときも false になるが、
 * その場合は続く `git diff` が本来のエラーを出すので、ここで種類を分ける必要はない。
 */
async function hasCommit(cwd: string): Promise<boolean> {
	try {
		await run('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd });
		return true;
	} catch {
		return false;
	}
}

export async function showDiffSummary(send: (text: string) => void): Promise<void> {
	// マルチルート対応（T-173）。要約はそのフォルダの git diff に対して出す。
	// フォルダが 1 つなら何も聞かない
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	// まだコミットが無いのは平常の状態であって、エラーではない（T-353）。
	// `git diff HEAD` は unborn HEAD で rc=128 になり、生の英語（fatal: ambiguous argument 'HEAD'）が
	// そのまま赤い通知に出ていた。比較先を空ツリーへ倒すと、変更が本当にあるときは出せて、
	// 何も無いときは「変更はありません」の情報通知に落ちる。
	// 画面での見えかたは敵対ケース `nimbus/tests/gui/cases/adv-09-empty-repo.mjs` が守る
	const committed = await hasCommit(folder.uri.fsPath);
	let diff: string;
	try {
		const { stdout } = await run('git', ['diff', diffBaseRevision(committed)], {
			cwd: folder.uri.fsPath,
			maxBuffer: 64 * 1024 * 1024
		});
		diff = stdout;
	} catch (error) {
		void vscode.window.showErrorMessage(
			`Nimbus: 差分を読めませんでした: ${error instanceof Error ? error.message : String(error)}`
		);
		return;
	}

	const files = summarizeDiff(diff);
	if (files.length === 0) {
		void vscode.window.showInformationMessage(
			committed ? 'Nimbus: 変更はありません。' : 'Nimbus: まだコミットがありません（差分に出せる変更もありません）。'
		);
		return;
	}

	const document = await vscode.workspace.openTextDocument({
		content: formatSummary(files),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });

	const ASK = '意図の要約を Claude に頼む';
	const choice = await vscode.window.showInformationMessage(
		`Nimbus: ${files.length} ファイルの変更を要約しました。`,
		ASK
	);
	if (choice === ASK) {
		send(intentPrompt(files));
	}
}
