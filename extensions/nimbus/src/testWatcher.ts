/**
 * Test Explorer の結果を拾ってセッションへ渡す（tasks.md T-039）。
 *
 * テストが落ちたとき、人は出力を目で追って「どのテストが」「どこで」「なぜ」を組み立て直している。
 * VS Code はその 3 つを**構造として**持っているので、そのまま渡せば読み解く手間が消える。
 * ターミナル経由（T-169）より正確で短い。テストランナー拡張が何であっても同じ形で取れる。
 *
 * `testObserver` は提案 API。組み込み拡張なので `enabledApiProposals` で使えるが、
 * 将来なくなる可能性があるため**無ければ黙って何もしない**（有効化そのものを壊さない）。
 */
import * as vscode from 'vscode';
import {
	buildTestFailurePrompt,
	collectFailures,
	collectPassed,
	isFailedState,
	testFailureHeadline,
	type TestResultNode
} from './core/testFailures';

/** 既定で投入する失敗の件数 */
const DEFAULT_MAX_FAILURES = 10;

/** 結果が確定するまで少し待つ（実行中にも配列が更新されることがある） */
const SETTLE_MS = 400;

export interface TestWatcherDeps {
	send: (text: string) => void;
	log: (message: string) => void;
}

export class TestWatcher implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private timer: ReturnType<typeof setTimeout> | undefined;
	/** 同じ実行を二度知らせない */
	private lastReportedAt = 0;
	private lastPrompt?: string;
	/** 前回の実行で通っていたテスト（T-108 回帰の検知の基準） */
	private previouslyPassed = new Set<string>();
	/** 直前の実行で落ちていたか（T-107 赤 → 緑の確認） */
	private hadFailures = false;

	constructor(private readonly deps: TestWatcherDeps) {
		const tests = vscode.tests as Partial<typeof vscode.tests>;
		if (typeof tests.onDidChangeTestResults !== 'function') {
			this.deps.log('[test] テスト結果の購読ができません（testObserver が無効）');
			return;
		}
		this.disposables.push(tests.onDidChangeTestResults(() => this.schedule()));
	}

	dispose(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables.length = 0;
	}

	/** 直近の失敗を投入する（`nimbus.sendLastTestFailure`） */
	sendLastFailure(): boolean {
		if (!this.lastPrompt) {
			return false;
		}
		this.deps.send(this.lastPrompt);
		return true;
	}

	private schedule(): void {
		if (this.timer) {
			clearTimeout(this.timer);
		}
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.report();
		}, SETTLE_MS);
	}

	private async report(): Promise<void> {
		const config = vscode.workspace.getConfiguration('nimbus');
		if (config.get<boolean>('tests.captureFailures') === false) {
			return;
		}
		const latest = vscode.tests.testResults?.[0];
		if (!latest || latest.completedAt === this.lastReportedAt) {
			return;
		}
		this.lastReportedAt = latest.completedAt;

		const limit = config.get<number>('tests.maxFailures') ?? DEFAULT_MAX_FAILURES;
		const nodes = latest.results.map(toNode);
		const { failures, total, regressions } = collectFailures(nodes, limit, this.previouslyPassed);
		// 次の実行と比べるための基準を更新する。落ちたぶんは基準から外れる
		this.previouslyPassed = collectPassed(nodes);
		if (total === 0) {
			// 赤 → 緑になった瞬間だけ知らせる（T-107）。毎回「全部通りました」を出しても読まれない
			if (this.hadFailures) {
				this.hadFailures = false;
				void vscode.window.showInformationMessage(
					'Nimbus: 赤 → 緑になりました（落ちていたテストがすべて通りました）。'
				);
			}
			return;
		}
		this.hadFailures = true;
		this.lastPrompt = buildTestFailurePrompt(failures, total);
		const headline = testFailureHeadline(total, regressions);
		this.deps.log(`[test] ${headline}`);

		const SEND = 'セッションに投入';
		const NEVER = '今後は知らせない';
		// 情報通知は数秒で消える。押す前に消えたら「ワンクリック」にならない
		const choice = await vscode.window.showWarningMessage(`Nimbus: ${headline}`, SEND, NEVER);
		if (choice === SEND) {
			this.sendLastFailure();
		} else if (choice === NEVER) {
			await config.update('tests.captureFailures', false, vscode.ConfigurationTarget.Global);
			void vscode.window.showInformationMessage(
				'Nimbus: テストの失敗を知らせません（設定 nimbus.tests.captureFailures で戻せます）。'
			);
		}
	}
}

/** 提案 API の形（`TestResultSnapshot`）を、VS Code に依存しない木へ写す */
function toNode(snapshot: vscode.TestResultSnapshot): TestResultNode {
	const states = snapshot.taskStates ?? [];
	return {
		label: snapshot.label,
		file: snapshot.uri?.fsPath,
		line: snapshot.range?.start.line,
		failed: states.some((state) => isFailedState(state.state)),
		// Passed = 3。「実行されなかった」と「通った」を混ぜない（T-108）
		passed: states.length > 0 && states.every((state) => state.state === 3),
		messages: states.flatMap((state) =>
			state.messages.map((message) =>
				typeof message.message === 'string' ? message.message : message.message.value
			)
		),
		children: (snapshot.children ?? []).map(toNode)
	};
}
