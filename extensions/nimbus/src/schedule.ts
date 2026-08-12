/**
 * 寝る前に仕込む（tasks.md T-051）。
 *
 * 仕込みはワークスペースに持ち、**Nimbus が開いている間だけ**見張る。
 * 閉じているときに動かす仕組み（常駐）は持たない — 気づかないところで動くものは怖い。
 */
import * as vscode from 'vscode';
import { dueRuns, parseWhen, renderSchedule, warningFor, type ScheduledRun } from './core/schedule';

const KEY = 'nimbus.scheduledRuns';

/** 見張る間隔。仕込みは分単位なので、1 分で足りる */
const TICK = 60_000;

function load(context: vscode.ExtensionContext): ScheduledRun[] {
	return context.workspaceState.get<ScheduledRun[]>(KEY) ?? [];
}

async function save(context: vscode.ExtensionContext, runs: ScheduledRun[]): Promise<void> {
	await context.workspaceState.update(KEY, runs);
}

export async function scheduleRun(context: vscode.ExtensionContext): Promise<void> {
	const prompt = await vscode.window.showInputBox({
		title: 'Nimbus: 寝る前に仕込む',
		prompt: '朝までにやっておいてほしいこと（調べもの向きです）',
		placeHolder: '例: この依存の最新版で何が変わったか調べておいて',
		validateInput: (value) => (value.trim().length === 0 ? '空にはできません' : undefined)
	});
	if (!prompt) {
		return;
	}

	const when = await vscode.window.showInputBox({
		title: 'Nimbus: いつ動かしますか',
		prompt: '`07:30` のような時刻か、`30分後` `2時間後`',
		value: '07:00',
		validateInput: (value) => (parseWhen(value, Date.now()) === undefined ? '`07:30` か `30分後` の形で入れてください' : undefined)
	});
	if (!when) {
		return;
	}

	const approval = await vscode.window.showQuickPick(
		[
			{ label: '承認は求める（止まってもよい）', value: false },
			{ label: '承認を自動で通す（調べもの以外には使わない）', value: true }
		],
		{ title: 'Nimbus: 寝ている間の承認をどうしますか' }
	);
	if (!approval) {
		return;
	}

	const run: ScheduledRun = {
		id: `${Date.now()}`,
		at: parseWhen(when, Date.now()) as number,
		prompt,
		autoApprove: approval.value,
		state: 'waiting'
	};
	await save(context, [...load(context), run]);

	void vscode.window.showInformationMessage(`Nimbus: 仕込みました。${warningFor(run)}`);
}

export async function showSchedule(context: vscode.ExtensionContext): Promise<void> {
	const document = await vscode.workspace.openTextDocument({
		content: renderSchedule(load(context), Date.now()),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
}

/**
 * 時刻が来たものを動かす。
 * **見張るのは Nimbus が開いている間だけ。** 常駐はしない。
 */
export function watchSchedule(
	context: vscode.ExtensionContext,
	start: (prompt: string, autoApprove: boolean) => void
): vscode.Disposable {
	const timer = setInterval(() => {
		const runs = load(context);
		const due = dueRuns(runs, Date.now());
		if (due.length === 0) {
			return;
		}
		for (const run of due) {
			start(run.prompt, run.autoApprove);
		}
		const ids = new Set(due.map((run) => run.id));
		void save(
			context,
			runs.map((run) => (ids.has(run.id) ? { ...run, state: 'done' as const } : run))
		);
	}, TICK);
	return new vscode.Disposable(() => clearInterval(timer));
}
