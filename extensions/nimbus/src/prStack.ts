/**
 * 積み上げた PR を管理する（tasks.md T-135）。
 *
 * 積んだ順を間違えると入らないし、下が入った瞬間に上の PR の差分が別物に見える。
 * **積み方・入れる順・下が入った後の付け替え**を出す。
 *
 * **こちらからは操作しない。** 出すのはコマンドの中身まで。
 * PR の base を書き換えるのは、他人のレビューが載っている場所への変更なので、走らせるのは人。
 *
 * 判定と文面は `core/prStack.ts`。取得は `gh` CLI に任せる。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import {
	afterMerge,
	buildStacks,
	describeStacks,
	orphans,
	parsePrList,
	renderRestackCommands,
	type PullRequest
} from './core/prStack';
import { pickWorkspaceRoot } from './workspaceRoots';

export interface PrStackDeps {
	log: (message: string) => void;
}

function run(cwd: string, command: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(command, args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(stderr.trim() || error.message));
				return;
			}
			resolve(stdout);
		});
	});
}

/** 幹の名前。`origin/HEAD` が無ければ main */
async function trunkName(cwd: string): Promise<string> {
	try {
		const head = await run(cwd, 'git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
		return head.trim().replace(/^origin\//, '') || 'main';
	} catch {
		return 'main';
	}
}

async function loadPrs(cwd: string, deps: PrStackDeps): Promise<PullRequest[] | undefined> {
	try {
		await run(cwd, 'gh', ['--version']);
	} catch {
		void vscode.window.showInformationMessage(
			'Nimbus: gh コマンドが見つかりません（GitHub CLI を入れて `gh auth login` を済ませると使えます）。'
		);
		return undefined;
	}
	try {
		const json = await run(cwd, 'gh', [
			'pr',
			'list',
			'--limit',
			'50',
			'--json',
			'number,title,headRefName,baseRefName,isDraft'
		]);
		return parsePrList(json);
	} catch (error) {
		deps.log(`[stack] PR を取れませんでした: ${error instanceof Error ? error.message : String(error)}`);
		void vscode.window.showErrorMessage('Nimbus: PR の一覧を取得できませんでした。');
		return undefined;
	}
}

/** 積み方と入れる順を見せる */
export async function showPrStack(deps: PrStackDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const cwd = folder.uri.fsPath;
	const prs = await loadPrs(cwd, deps);
	if (!prs) {
		return;
	}
	if (prs.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 開いている PR はありません。');
		return;
	}

	const trunk = await trunkName(cwd);
	const stacks = buildStacks(prs, trunk);
	const lost = orphans(prs, stacks);
	const body = [describeStacks(stacks, trunk)];
	if (lost.length > 0) {
		body.push(
			'',
			'どこにも繋がらなかった PR（下の PR が閉じているか、幹の名前が違います）:',
			...lost.map((pr) => `- #${pr.number} ${pr.title}（${pr.head} → ${pr.base}）`)
		);
	}
	deps.log(`[stack] ${prs.length} 件・積み ${stacks.length} 本・迷子 ${lost.length} 件`);

	const document = await vscode.workspace.openTextDocument({
		language: 'markdown',
		content: `# 積み上げた PR\n\n\`\`\`\n${body.join('\n')}\n\`\`\`\n`
	});
	await vscode.window.showTextDocument(document, { preview: false });
}

/** 下が入った後の付け替えを出す。**走らせない** */
export async function restackAfterMerge(deps: PrStackDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const cwd = folder.uri.fsPath;
	const prs = await loadPrs(cwd, deps);
	if (!prs) {
		return;
	}

	const trunk = await trunkName(cwd);
	const bases = [...new Set(prs.map((pr) => pr.base))].filter((base) => base !== trunk);
	if (bases.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 他の PR の上に乗っている PR はありません。');
		return;
	}

	const merged = await vscode.window.showQuickPick(bases, {
		title: 'どの PR が入りましたか',
		placeHolder: '入ったブランチを選ぶと、その上の PR の付け替えを出します'
	});
	if (!merged) {
		return;
	}

	const mergedPr = prs.find((pr) => pr.head === merged);
	const restacks = afterMerge(prs, merged, mergedPr?.base ?? trunk);
	if (restacks.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 付け替えが要る PR はありません。');
		return;
	}
	deps.log(`[stack] 付け替え ${restacks.length} 件（${merged} が入った後）`);

	const document = await vscode.workspace.openTextDocument({
		language: 'shellscript',
		content: renderRestackCommands(restacks)
	});
	await vscode.window.showTextDocument(document, { preview: false });
	void vscode.window.showInformationMessage(
		`Nimbus: ${restacks.length} 件の PR を向け直す手順を出しました（走らせるのは人です）。`
	);
}
