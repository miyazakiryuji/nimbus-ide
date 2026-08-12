/**
 * 別のエージェントの結果と並べて比べる（tasks.md T-069）。
 *
 * Claude Code をメインに据えたうえで、別のツールにも同じ課題をやらせたとき、
 * **どこが違うのか**を出す。差分ビューはフォークの中にあるので、
 * ファイルを 1 つずつ左右に並べるところまで機械にやらせる。
 *
 * **どちらが良いかは言わない。** 良し悪しはその課題で何を大事にしているかで決まる。
 *
 * 判定と文面は `core/agentCompare.ts`。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import {
	buildComparePrompt,
	compareChanges,
	conflicting,
	describeComparison,
	overlappingLines,
	parseNameStatus
} from './core/agentCompare';
import { pickWorkspaceRoot } from './workspaceRoots';

export interface AgentCompareDeps {
	send: (text: string) => void;
	log: (message: string) => void;
}

/** 比べる相手。手元の変更か、別の枝か */
interface Source {
	label: string;
	/** git の指定。`WORKTREE` は「まだコミットしていない手元の変更」 */
	ref: string;
}

const WORKTREE = 'WORKTREE';

function git(cwd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(stderr.trim() || error.message));
				return;
			}
			resolve(stdout);
		});
	});
}

/** その変更の中身。`base` からの差分として見る */
function diffArgs(source: Source, base: string, extra: string[]): string[] {
	return source.ref === WORKTREE ? ['diff', ...extra, base] : ['diff', ...extra, `${base}...${source.ref}`];
}

async function pickSource(cwd: string, title: string, exclude?: string): Promise<Source | undefined> {
	let branches: string[] = [];
	try {
		const text = await git(cwd, ['for-each-ref', '--format=%(refname:short)', '--sort=-committerdate', 'refs/heads']);
		branches = text
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && line !== exclude)
			.slice(0, 20);
	} catch {
		// 枝が取れなくても手元の変更は比べられる
	}
	const items: (vscode.QuickPickItem & { source: Source })[] = [];
	if (exclude !== WORKTREE) {
		items.push({
			label: 'まだコミットしていない手元の変更',
			description: 'いまの作業ツリー',
			source: { label: '手元の変更', ref: WORKTREE }
		});
	}
	for (const branch of branches) {
		items.push({ label: branch, description: 'ブランチ', source: { label: branch, ref: branch } });
	}
	const picked = await vscode.window.showQuickPick(items, { title });
	return picked?.source;
}

/** 2 つの変更を並べ、違うところを開く */
export async function compareAgentWork(deps: AgentCompareDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const cwd = folder.uri.fsPath;

	const a = await pickSource(cwd, 'ひとつめの変更（Claude 側）');
	if (!a) {
		return;
	}
	const b = await pickSource(cwd, 'ふたつめの変更（比べる相手）', a.ref);
	if (!b) {
		return;
	}

	// 共通の起点。両方がここから伸びていると見なす
	let base = 'HEAD';
	if (a.ref !== WORKTREE && b.ref !== WORKTREE) {
		try {
			base = (await git(cwd, ['merge-base', a.ref, b.ref])).trim();
		} catch {
			base = 'HEAD';
		}
	}

	let filesA: ReturnType<typeof parseNameStatus>;
	let filesB: ReturnType<typeof parseNameStatus>;
	let diffA: string;
	let diffB: string;
	try {
		filesA = parseNameStatus(await git(cwd, diffArgs(a, base, ['--name-status'])));
		filesB = parseNameStatus(await git(cwd, diffArgs(b, base, ['--name-status'])));
		diffA = await git(cwd, diffArgs(a, base, ['-U0']));
		diffB = await git(cwd, diffArgs(b, base, ['-U0']));
	} catch (error) {
		deps.log(`[compare] 差分を取れませんでした: ${error instanceof Error ? error.message : String(error)}`);
		void vscode.window.showErrorMessage('Nimbus: git の差分を取得できませんでした。');
		return;
	}

	const comparison = compareChanges(filesA, filesB);
	const overlaps = overlappingLines(diffA, diffB);
	const summary = describeComparison(comparison, overlaps, a.label, b.label);
	deps.log(`[compare] ${a.label} と ${b.label}: ${summary.split('\n')[0]}`);

	if (comparison.both.length + comparison.onlyA.length + comparison.onlyB.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 2 つの変更に違いはありません。');
		return;
	}

	const OPEN = '同じ行を触った場所を開く';
	const SEND = '違いを整理させる';
	const shared = conflicting(overlaps);
	const actions = shared.length > 0 ? [OPEN, SEND] : [SEND];
	const choice = await vscode.window.showInformationMessage(
		`Nimbus: ${summary.split('\n')[0]}`,
		{ detail: summary, modal: false },
		...actions
	);

	if (choice === OPEN) {
		for (const overlap of shared.slice(0, 5)) {
			const left = vscode.Uri.parse(
				`${a.ref === WORKTREE ? 'file' : 'git'}:${vscode.Uri.joinPath(folder.uri, overlap.file).fsPath}`
			);
			const right = vscode.Uri.joinPath(folder.uri, overlap.file);
			await vscode.commands.executeCommand(
				'vscode.diff',
				left,
				right,
				`${overlap.file}: ${a.label} ↔ ${b.label}`,
				{ preview: false }
			);
		}
		return;
	}
	if (choice === SEND) {
		deps.send(buildComparePrompt(comparison, overlaps, a.label, b.label));
	}
}
