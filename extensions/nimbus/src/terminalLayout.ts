/**
 * ターミナルを好きな数に並べる（tasks.md T-014）。
 *
 * 分割そのものは VS Code が持っている（`location: { parentTerminal }`）。
 * ここでやるのは **何枚出すかを決めて、その通りに並べる**こと。
 */
import * as vscode from 'vscode';
import { describePlan, planPanes } from './core/terminalLayout';

export interface TerminalLayoutDeps {
	log: (message: string) => void;
}

/** いま見えているターミナルの幅（桁）。分からなければ undefined */
function currentWidth(): number | undefined {
	const dimensions = vscode.window.activeTerminal?.dimensions;
	return dimensions?.columns;
}

/** 何枚にするかを聞く。よく使う数を先に出し、それ以外は打てるようにする */
async function askCount(): Promise<number | undefined> {
	const picked = await vscode.window.showQuickPick(
		[
			{ label: '2 枚', count: 2 },
			{ label: '3 枚', count: 3 },
			{ label: '4 枚', count: 4 },
			{ label: '6 枚', count: 6 },
			{ label: 'その他…', count: 0 }
		],
		{ title: 'ターミナルを何枚並べますか' }
	);
	if (!picked) {
		return undefined;
	}
	if (picked.count > 0) {
		return picked.count;
	}
	const typed = await vscode.window.showInputBox({
		title: 'ターミナルを何枚並べますか',
		value: '8',
		validateInput: (value) => (/^\d+$/.test(value.trim()) ? undefined : '数字を入れてください')
	});
	return typed === undefined ? undefined : Number(typed.trim());
}

/**
 * 並べる。
 *
 * **1 枚目だけ普通に作り、2 枚目からはその隣に割る。**
 * こうすると 1 つのグループに収まり、まとめて閉じられる。
 */
export async function splitTerminals(deps: TerminalLayoutDeps): Promise<void> {
	const count = await askCount();
	if (count === undefined) {
		return;
	}

	const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
		name: folder.name,
		path: folder.uri.fsPath
	}));
	const widthColumns = currentWidth();
	let plan = planPanes({ count, widthColumns, folders });

	if (plan.note) {
		// 減らしたことは、並べる前に言う。**頼んだ枚数のまま並べる道も残す**
		// 減らしていないとき（出ないフォルダがあるだけ）は、同じ枚数の選択肢を 2 つ出さない
		const choices =
			plan.panes.length < count
				? [`${plan.panes.length} 枚で並べる`, `${count} 枚のまま並べる`, 'やめる']
				: ['並べる', 'やめる'];
		const answer = await vscode.window.showWarningMessage(`Nimbus: ${plan.note}`, ...choices);
		if (answer === undefined || answer === 'やめる') {
			return;
		}
		if (answer === `${count} 枚のまま並べる`) {
			plan = planPanes({ count, widthColumns, folders, force: true });
		}
	}

	let parent: vscode.Terminal | undefined;
	for (const pane of plan.panes) {
		const terminal = vscode.window.createTerminal({
			name: pane.name,
			cwd: pane.cwd,
			location: parent ? { parentTerminal: parent } : vscode.TerminalLocation.Panel
		});
		parent ??= terminal;
	}
	parent?.show();
	deps.log(`[terminal] ${describePlan(plan)}`);
}
