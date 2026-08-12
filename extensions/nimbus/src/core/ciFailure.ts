/**
 * CI が落ちたときの自動調査（tasks.md T-131）。
 *
 * 赤くなってから人がログを開くまでの間が、いちばん無駄な時間。
 * **ログを取りに行って、原因の当たりをつけるところまで**を先にやっておく。
 *
 * ログの整形は [terminal-capture](../../../nimbus/docs/specs/terminal-capture.md) と同じものを使う
 * （落ちた理由は末尾にある、という性質は CI でも変わらない）。
 *
 * VS Code に依存しない。
 */
import { tailLines } from './terminalCapture';

export interface CiRun {
	id: number;
	workflow: string;
	status: string;
	conclusion: string;
	branch: string;
	createdAt: string;
}

/** `gh run list --json ...` の出力を読む。想定外の形は落とさず飛ばす */
export function parseRunList(json: string): CiRun[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) {
		return [];
	}
	const runs: CiRun[] = [];
	for (const entry of parsed as Record<string, unknown>[]) {
		const id = entry['databaseId'];
		if (typeof id !== 'number') {
			continue;
		}
		runs.push({
			id,
			workflow: typeof entry['workflowName'] === 'string' ? entry['workflowName'] : '(不明なワークフロー)',
			status: typeof entry['status'] === 'string' ? entry['status'] : '',
			conclusion: typeof entry['conclusion'] === 'string' ? entry['conclusion'] : '',
			branch: typeof entry['headBranch'] === 'string' ? entry['headBranch'] : '',
			createdAt: typeof entry['createdAt'] === 'string' ? entry['createdAt'].slice(0, 16).replace('T', ' ') : ''
		});
	}
	return runs;
}

/** 落ちた実行のうち、いちばん新しいもの。走っている最中のものは対象にしない */
export function latestFailure(runs: readonly CiRun[]): CiRun | undefined {
	return runs.find((run) => run.status === 'completed' && (run.conclusion === 'failure' || run.conclusion === 'timed_out'));
}

/** 一覧に出す 1 行 */
export function describeRun(run: CiRun): string {
	const mark = run.conclusion === 'success' ? '○' : run.conclusion === '' ? '…' : '×';
	return `${mark} ${run.workflow}  ${run.branch}  ${run.createdAt}`;
}

/**
 * セッションへ投入する文。
 * **まだ直させない。** CI のログは環境の違いを含むので、
 * 手元で再現するのか、CI 固有なのかを先に切り分ける必要がある。
 */
export function buildCiPrompt(run: CiRun, log: string, maxLines = 200): string {
	const { text, omittedLines } = tailLines(log, maxLines);
	return [
		`CI が失敗しました（${run.workflow} / ${run.branch}）。`,
		'',
		omittedLines > 0 ? `失敗ログの末尾（先頭 ${omittedLines} 行は省略）:` : '失敗ログ:',
		'````',
		text.length > 0 ? text : '（ログを取得できませんでした）',
		'````',
		'',
		'**まだ直さないでください。** まず次の 2 つに答えてください:',
		'1. 何が失敗したのか（テストか、ビルドか、lint か。どの段階か）',
		'2. **手元で再現するのか、CI 固有なのか**（環境変数・OS・キャッシュ・並列度の違いに心当たりはあるか）',
		'',
		'そのうえで、直す前に方針を書いてください。'
	].join('\n');
}
