/**
 * どのコミットで壊れたかを絞り込む（tasks.md T-183）。
 *
 * 状態はワークスペースに持たせる（セッションをまたいでも続きから絞れるように）。
 * git を勝手に動かさない — チェックアウトは利用者が自分でやる。
 * **走っているセッションの作業ツリーを黙って動かすのは危ない**ため。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { pickWorkspaceRoot } from './workspaceRoots';
import { culprit, narrow, nextIndex, renderBisect, type BisectState } from './core/bisect';

const STATE_KEY = 'nimbus.bisect';

function git(args: string[], cwd: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) =>
			resolve(error ? undefined : stdout.trim())
		);
	});
}

async function show(state: BisectState): Promise<void> {
	const document = await vscode.workspace.openTextDocument({
		content: renderBisect(state),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
}

export async function bisect(context: vscode.ExtensionContext): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const root = folder.uri.fsPath;

	const saved = context.workspaceState.get<BisectState>(STATE_KEY);
	if (saved && nextIndex(saved) !== undefined) {
		const index = nextIndex(saved) as number;
		const verdict = await vscode.window.showQuickPick(
			[
				{ label: '再現しなかった（good）', value: 'good' as const },
				{ label: '再現した（bad）', value: 'bad' as const },
				{ label: 'やめる', value: 'stop' as const }
			],
			{ title: `Nimbus: ${saved.commits[index]} はどうでしたか` }
		);
		if (!verdict || verdict.value === 'stop') {
			await context.workspaceState.update(STATE_KEY, undefined);
			return;
		}
		const next = narrow(saved, index, verdict.value);
		await context.workspaceState.update(STATE_KEY, culprit(next) ? undefined : next);
		await show(next);
		return;
	}

	const range = await vscode.window.showInputBox({
		title: 'Nimbus: どこから探しますか',
		prompt: '壊れていないと分かっている地点（タグ・コミット）。ここから HEAD までを探します',
		value: 'HEAD~20',
		validateInput: (value) => (value.trim().length === 0 ? '空にはできません' : undefined)
	});
	if (!range) {
		return;
	}

	const log = await git(['log', '--reverse', '--format=%h', `${range.trim()}..HEAD`], root);
	const commits = (log ?? '').split('\n').filter(Boolean);
	if (commits.length < 2) {
		void vscode.window.showInformationMessage('Nimbus: 探せるコミットが足りません（2 つ以上必要です）。');
		return;
	}

	const state: BisectState = { commits, goodIndex: 0, badIndex: commits.length - 1 };
	await context.workspaceState.update(STATE_KEY, state);
	await show(state);
}
