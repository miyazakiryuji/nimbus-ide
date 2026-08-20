/**
 * Herdr のセッションを読む（tasks.md T-279）。
 *
 * [Herdr](https://github.com/herdrdev/herdr) は「コーディングエージェントが乗る実行環境」。
 * 常駐サーバが端末を保持するので、ウィンドウを閉じてもセッションが生き残り、
 * エージェントの状態（working / blocked / idle / done）を持っている。
 *
 * **置き換えではなく、並べて置く。** Nimbus は SDK を拡張ホストのプロセス内で直接叩いており
 * （`SessionManager` が `query()` を呼ぶ）、Herdr は端末の中で CLI を走らせる前提なので、
 * そのまま入れると**セッションの持ち主が二重になる**。まずは Herdr 側で起きているものを
 * **読んで一覧に混ぜる**だけにする。
 *
 * **同梱しない**（権利の確認結果・`docs/history/herdr-license-review.md`）。
 * 入っていれば使う。入っていなければ何も起きない。
 *
 * ここは解釈だけ。ソケットとの往復は `src/herdr.ts`。
 */
import type { TabState } from './sessionTabs';

/** Herdr が持っているエージェントの状態（socket API の実測値） */
export type HerdrAgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

export interface HerdrPane {
	/** `w1:p1` の形 */
	paneId: string;
	title: string;
	cwd?: string;
	status: HerdrAgentStatus;
}

/** socket API の 1 往復（改行区切り JSON） */
export interface HerdrRequest {
	id: string;
	method: string;
	params: Record<string, unknown>;
}

export function requestLine(id: string, method: string, params: Record<string, unknown> = {}): string {
	return `${JSON.stringify({ id, method, params })}\n`;
}

/**
 * 返事を読む。**エラーは握り潰さない** — Herdr が居ないことと、
 * 居るのに答えられないことは別の話なので、呼び出し側で分けられるようにする。
 */
export function parseResponse(line: string): { result?: unknown; error?: { code: string; message: string } } {
	try {
		const parsed = JSON.parse(line) as { result?: unknown; error?: { code: string; message: string } };
		return { result: parsed.result, error: parsed.error };
	} catch {
		return { error: { code: 'unreadable', message: '返事を読めませんでした' } };
	}
}

/** `agent.list` の結果を、扱いやすい形に畳む。読めない要素は落とす */
export function parseAgents(result: unknown): HerdrPane[] {
	const rows = Array.isArray(result)
		? result
		: Array.isArray((result as { agents?: unknown[] })?.agents)
			? (result as { agents: unknown[] }).agents
			: [];
	const panes: HerdrPane[] = [];
	for (const row of rows) {
		if (!row || typeof row !== 'object') {
			continue;
		}
		const entry = row as Record<string, unknown>;
		const paneId = typeof entry['pane_id'] === 'string' ? entry['pane_id'] : undefined;
		if (!paneId) {
			continue;
		}
		panes.push({
			paneId,
			// **項目名は Herdr の socket API に合わせる**（T-297）。
			// `title` / `cwd` で読んでいたが、実際に返るのは `terminal_title_stripped`
			// （飾りを落とした OSC タイトル）と `foreground_cwd`。そのままだと本物に繋いだとき
			// **題名が pane_id のまま**（`w1:p1`）になり、作業場所も出ない。
			// 古い名前も残す — 版が違っても落ちないほうがよい
			title: firstString(entry, ['terminal_title_stripped', 'terminal_title', 'title']) ?? paneId,
			cwd: firstString(entry, ['foreground_cwd', 'cwd']),
			status: toStatus(entry['agent_status'])
		});
	}
	return panes;
}

/** 並べた名前のうち、最初に中身のある文字列を返す */
function firstString(entry: Record<string, unknown>, keys: readonly string[]): string | undefined {
	for (const key of keys) {
		const value = entry[key];
		if (typeof value === 'string' && value.length > 0) {
			return value;
		}
	}
	return undefined;
}

function toStatus(value: unknown): HerdrAgentStatus {
	switch (value) {
		case 'idle':
		case 'working':
		case 'blocked':
		case 'done':
			return value;
		default:
			return 'unknown';
	}
}

/**
 * Herdr の状態を、Nimbus のタブの状態（T-269）へ寄せる。
 *
 * `blocked` は「外部の入力を待っている」なので、Nimbus の「許可待ち」と同じ意味になる —
 * **止まっていることに先に気づきたい**、という並べ替えの理由まで一致している。
 */
export function toTabState(status: HerdrAgentStatus): TabState {
	switch (status) {
		case 'blocked':
			return 'waiting-approval';
		case 'working':
			return 'running';
		case 'done':
			return 'done';
		case 'idle':
			return 'asking';
		default:
			return 'stopped';
	}
}

/** 一覧に出す 1 行。どちらの持ちものかが分かる形にする */
export function describePane(pane: HerdrPane): string {
	const where = pane.cwd ? ` · ${pane.cwd}` : '';
	return `Herdr: ${pane.title}（${pane.status}）${where}`;
}
