/**
 * 戻す道と、急ぐ道（tasks.md T-216 / T-144）。
 *
 * 障害の最中に「どうやって戻す？」を考えるのがいちばん危ない。
 * **出す前に、戻し方を書き出しておく。**
 *
 * **走らせない。** 出すのはスクリプトの中身と手順書まで。実行は人が読んでから。
 *
 * 判定と文面は `core/rollback.ts`。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { parseCommitLog } from './core/releaseNotes';
import {
	buildHotfixPlan,
	buildRollbackPlan,
	describeRollback,
	renderHotfixChecklist,
	renderRollbackScript,
	type RollbackPlan
} from './core/rollback';
import { pickWorkspaceRoot } from './workspaceRoots';

export interface RollbackDeps {
	log: (message: string) => void;
}

function git(cwd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(stderr.trim() || error.message));
				return;
			}
			resolve(stdout);
		});
	});
}

/** 新しい順のタグ。無ければ空 */
async function releaseTags(cwd: string): Promise<string[]> {
	try {
		const text = await git(cwd, ['tag', '--sort=-creatordate']);
		return text
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	} catch {
		return [];
	}
}

/** 出ている版を選ばせる。タグが無ければ HEAD を使う */
async function pickCurrent(cwd: string): Promise<{ current: string; previous?: string } | undefined> {
	const tags = await releaseTags(cwd);
	if (tags.length === 0) {
		const head = (await git(cwd, ['rev-parse', '--short', 'HEAD'])).trim();
		return { current: head };
	}
	const picked = await vscode.window.showQuickPick(
		tags.slice(0, 20).map((tag, index) => ({
			label: tag,
			description: index === 0 ? 'いちばん新しい' : undefined,
			tag,
			previous: tags[index + 1]
		})),
		{ title: 'いま出ている版はどれですか', placeHolder: '戻す元になる版' }
	);
	if (!picked) {
		return undefined;
	}
	return { current: picked.tag, previous: picked.previous };
}

async function collectPlan(cwd: string): Promise<RollbackPlan | undefined> {
	const picked = await pickCurrent(cwd);
	if (!picked) {
		return undefined;
	}
	const range = picked.previous ? `${picked.previous}..${picked.current}` : `${picked.current}~1..${picked.current}`;
	let commits: ReturnType<typeof parseCommitLog> = [];
	let changedFiles: string[] = [];
	try {
		commits = parseCommitLog(await git(cwd, ['log', '--format=%h%x09%s', range]));
		const names = await git(cwd, ['diff', '--name-only', range.replace('..', '...')]);
		changedFiles = names
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	} catch {
		// 範囲が取れないときは、戻し方だけ出す
	}
	return buildRollbackPlan({ current: picked.current, previous: picked.previous, commits, changedFiles });
}

/** 戻す手順を書き出す。**走らせない** */
export async function prepareRollback(deps: RollbackDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const cwd = folder.uri.fsPath;

	let plan: RollbackPlan | undefined;
	try {
		plan = await collectPlan(cwd);
	} catch (error) {
		deps.log(`[rollback] 組み立てられませんでした: ${error instanceof Error ? error.message : String(error)}`);
		void vscode.window.showErrorMessage('Nimbus: git の情報を取得できませんでした。');
		return;
	}
	if (!plan) {
		return;
	}

	const summary = describeRollback(plan);
	deps.log(`[rollback] ${summary.split('\n')[0]}`);

	const document = await vscode.workspace.openTextDocument({
		language: 'shellscript',
		content: renderRollbackScript(plan)
	});
	await vscode.window.showTextDocument(document, { preview: false });

	if (plan.irreversible.length > 0) {
		void vscode.window.showWarningMessage(`Nimbus: ${summary.split('\n')[0]}`, {
			detail: summary,
			modal: false
		});
	} else {
		void vscode.window.showInformationMessage(`Nimbus: ${summary.split('\n')[0]}`);
	}
}

/** 急ぐときの手順書を出す。**省かない段は省かない** */
export async function planHotfix(deps: RollbackDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const cwd = folder.uri.fsPath;

	const tags = await releaseTags(cwd);
	const productionTag = await vscode.window.showQuickPick(
		tags.length > 0 ? tags.slice(0, 20) : ['HEAD'],
		{ title: 'いま本番に出ている版はどれですか', placeHolder: 'ここから枝を切ります（main からではありません）' }
	);
	if (!productionTag) {
		return;
	}

	const summary = await vscode.window.showInputBox({
		title: '何を直しますか',
		placeHolder: '例: crash on login',
		prompt: '枝の名前に使います'
	});
	if (summary === undefined) {
		return;
	}

	let defaultBranch = 'main';
	try {
		const head = await git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
		defaultBranch = head.trim().replace(/^origin\//, '') || 'main';
	} catch {
		// origin/HEAD が無いリポジトリ。main のままでよい
	}

	const urgent =
		(await vscode.window.showQuickPick(
			[
				{ label: '急ぎます', description: '後回しにしてよい段は末尾へ畳みます', urgent: true },
				{ label: '通常', description: '上から順にすべて', urgent: false }
			],
			{ title: '急ぎますか' }
		)) ?? undefined;
	if (!urgent) {
		return;
	}

	const steps = buildHotfixPlan({ productionTag, defaultBranch, summary });
	deps.log(`[hotfix] ${productionTag} から ${steps.length} 段（急ぐ: ${urgent.urgent}）`);

	const document = await vscode.workspace.openTextDocument({
		language: 'markdown',
		content: renderHotfixChecklist(steps, urgent.urgent)
	});
	await vscode.window.showTextDocument(document, { preview: false });
}
