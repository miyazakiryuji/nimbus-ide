/**
 * メモリの増え方と、起動時間（tasks.md T-222）。
 *
 * リークは 1 枚のスナップショットでは分からず、起動の遅さは一度に来ない。
 * どちらも**前と比べて初めて言えること**なので、前回を覚えておく。
 *
 * 起動時間の基準は `workspaceState` に置く（ワークスペースごとに違う値なので）。
 *
 * 判定と文面は `core/memoryTrend.ts` と `core/startupTiming.ts`。
 * CPU の計測結果は別（`core/cpuProfile.ts` / T-128）。
 */
import * as vscode from 'vscode';
import {
	buildLeakPrompt,
	describeTrend,
	judgeLeak,
	measureTrend,
	parseSamples
} from './core/memoryTrend';
import {
	buildStartupPrompt,
	compareStartup,
	describeComparison,
	describeStartup,
	parseStartupInfo,
	regressions,
	type StartupMeasure
} from './core/startupTiming';
import { pickWorkspaceRoot } from './workspaceRoots';

/** 起動の基準を覚えておく鍵 */
const BASELINE_KEY = 'nimbus.startupBaseline';

export interface PerfWatchDeps {
	send: (text: string) => void;
	log: (message: string) => void;
	state: vscode.Memento;
}

/** Flutter が `--trace-startup` で置く場所 */
const STARTUP_PATHS = ['build/start_up_info.json', 'start_up_info.json'];

/** メモリの計測列を読み込み、増え続けていないかを見る */
export async function trackMemory(deps: PerfWatchDeps): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	const fromEditor = editor?.document.getText(editor.selection.isEmpty ? undefined : editor.selection) ?? '';
	const text =
		parseSamples(fromEditor).length >= 3
			? fromEditor
			: ((await vscode.window.showInputBox({
					title: 'メモリの計測値を貼ってください',
					placeHolder: '1 行 1 回。`heapUsed=120 MB` のような形でも読めます',
					prompt: '同じ操作を繰り返しながら 3 回以上測った値'
				})) ?? '');
	const samples = parseSamples(text);
	const trend = measureTrend(samples);
	if (!trend) {
		void vscode.window.showInformationMessage(
			'Nimbus: 3 回以上の計測が要ります（1 枚のスナップショットでは、漏れているかは分かりません）。'
		);
		return;
	}

	const summary = describeTrend(trend);
	deps.log(`[memory] ${summary.split('\n')[0]}`);
	if (judgeLeak(trend) === 'stable') {
		void vscode.window.showInformationMessage(`Nimbus: ${summary.split('\n')[0]}`);
		return;
	}

	const context = await vscode.window.showInputBox({
		title: '何を繰り返しましたか',
		placeHolder: '例: 一覧を開いて閉じる',
		prompt: '分かる範囲で構いません（空でも進めます）'
	});
	const SEND = '調べさせる';
	const choice = await vscode.window.showWarningMessage(
		`Nimbus: ${summary.split('\n')[0]}`,
		{ detail: summary, modal: false },
		SEND
	);
	if (choice === SEND) {
		deps.send(buildLeakPrompt(trend, context || undefined));
	}
}

async function readStartupInfo(root: vscode.Uri): Promise<StartupMeasure[] | undefined> {
	for (const candidate of STARTUP_PATHS) {
		try {
			const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, candidate));
			const measures = parseStartupInfo(new TextDecoder().decode(bytes));
			if (measures.length > 0) {
				return measures;
			}
		} catch {
			// 次の候補へ
		}
	}
	return undefined;
}

/** 起動時間を測り、前回と比べる */
export async function measureStartup(deps: PerfWatchDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const measures = await readStartupInfo(folder.uri);
	if (!measures) {
		void vscode.window.showInformationMessage(
			'Nimbus: 起動の計測結果がありません（`flutter run --trace-startup` を一度走らせてください）。'
		);
		return;
	}

	const key = `${BASELINE_KEY}:${folder.uri.toString()}`;
	const baseline = deps.state.get<StartupMeasure[]>(key);
	deps.log(`[startup] ${measures.length} 件（基準: ${baseline ? 'あり' : 'なし'}）`);

	if (!baseline) {
		await deps.state.update(key, measures);
		void vscode.window.showInformationMessage(`Nimbus: ${describeStartup(measures).split('\n')[0]}`, {
			detail: `${describeStartup(measures)}\n\nこれを基準として覚えました。次からは前回と比べます。`,
			modal: false
		});
		return;
	}

	const changes = compareStartup(baseline, measures);
	const summary = describeComparison(changes);
	const slower = regressions(changes);

	const UPDATE = '基準を今の値にする';
	const SEND = '調べさせる';
	const actions = slower.length > 0 ? [SEND, UPDATE] : [UPDATE];
	const choice =
		slower.length > 0
			? await vscode.window.showWarningMessage(
					`Nimbus: ${summary.split('\n')[0]}`,
					{ detail: summary, modal: false },
					...actions
				)
			: await vscode.window.showInformationMessage(
					`Nimbus: ${summary.split('\n')[0]}`,
					{ detail: summary, modal: false },
					...actions
				);

	if (choice === UPDATE) {
		await deps.state.update(key, measures);
		void vscode.window.showInformationMessage('Nimbus: 今の値を基準にしました。');
		return;
	}
	if (choice === SEND) {
		deps.send(buildStartupPrompt(changes, '前回測ったとき'));
	}
}
