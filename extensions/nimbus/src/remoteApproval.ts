/**
 * 手元の端末から承認だけする（tasks.md T-054 / T-086）。
 *
 * 席を立った 1 時間、エージェントは最初の承認待ちで止まっていた — を無くす。
 * **同じ Wi-Fi の中でだけ**開く小さな画面を出して、「許す・断る」だけを押せるようにする。
 *
 * 判定と画面は `core/remoteApproval.ts`。
 */
import { randomBytes } from 'crypto';
import { createServer, type Server } from 'http';
import { networkInterfaces } from 'os';
import * as vscode from 'vscode';
import {
	describeServer,
	matchRoute,
	pairingUrl,
	renderList,
	renderPage,
	shouldClose,
	type RemoteItem
} from './core/remoteApproval';
import type { ApprovalDecision, PendingApproval } from './permissions';

/** 使われないまま閉じるまで */
const IDLE_MS = 10 * 60 * 1000;
const IDLE_CHECK_MS = 30 * 1000;

export interface RemoteApprovalDeps {
	pending: () => PendingApproval[];
	decide: (id: string, decision: ApprovalDecision) => boolean;
	log: (message: string) => void;
}

/** 同じ Wi-Fi の中で見えるアドレス。**外向きには開かない** */
function lanAddress(): string | undefined {
	for (const entries of Object.values(networkInterfaces())) {
		for (const entry of entries ?? []) {
			if (entry.family === 'IPv4' && !entry.internal) {
				return entry.address;
			}
		}
	}
	return undefined;
}

/** 手元の端末には 3 段で見せる（`core/risk.ts` の言い方をそのまま持ち込まない） */
const RISK: Record<string, RemoteItem['risk']> = { danger: 'high', caution: 'medium', normal: 'low' };

function toItems(pending: readonly PendingApproval[], now: number): RemoteItem[] {
	return pending.map((entry) => ({
		id: entry.id,
		toolName: entry.toolName,
		summary: entry.summary,
		risk: RISK[entry.risk] ?? 'low',
		waitingSeconds: Math.max(0, Math.round((now - entry.since) / 1000)),
		canApprove: canApproveRemotely(entry)
	}));
}

/**
 * この画面から許可してよいか。
 *
 * **`danger` は許可させない。** この層は `danger` の自動許可の経路を
 * すべて塞いである（`autoApproveReadOnly` も、セッション内の「常に許可」も、
 * 保存済みルールも）。遠隔だけが抜け道になると、その一貫性が崩れる。
 *
 * 一覧からは**隠さない** — 何で止まっているかは知りたい（それがこの機能の目的）。
 */
function canApproveRemotely(entry: PendingApproval): boolean {
	return entry.risk !== 'danger';
}

/**
 * 承認だけの画面を開く。返り値で閉じられる。
 *
 * **開くのは明示的に呼ばれたときだけ。** 常駐させない。
 */
export async function startRemoteApproval(deps: RemoteApprovalDeps): Promise<
	{ url: string; dispose: () => void } | undefined
> {
	const host = lanAddress();
	if (!host) {
		void vscode.window.showInformationMessage(
			'Nimbus: 同じ Wi-Fi の中で見えるアドレスがありません（ネットワークに繋がっていないようです）。'
		);
		return undefined;
	}

	// 開くたびに作り直す。前に開いた URL は次には効かない
	const token = randomBytes(16).toString('base64url');
	let lastSeen = Date.now();

	const server: Server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', `http://${host}`);
		const route = matchRoute(url.pathname, token);
		// 合言葉が合わないものには、何があるかも教えない
		if (route.kind === 'unauthorized' || route.kind === 'notfound') {
			response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
			response.end('not found');
			return;
		}
		lastSeen = Date.now();
		if (route.kind === 'page') {
			response.writeHead(200, {
				'content-type': 'text/html; charset=utf-8',
				'cache-control': 'no-store',
				'referrer-policy': 'no-referrer',
				'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'"
			});
			response.end(renderPage('Nimbus の承認待ち'));
			return;
		}
		if (route.kind === 'list') {
			response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
			response.end(renderList(toItems(deps.pending(), Date.now())));
			return;
		}
		// 答える。GET では変えない（先読みで勝手に承認されないように）
		if (request.method !== 'POST') {
			response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
			response.end('method not allowed');
			return;
		}
		// 画面でボタンを出さないだけでは守りにならない。**通す側でも断る**
		if (route.allow) {
			const target = deps.pending().find((entry) => entry.id === route.id);
			if (target && !canApproveRemotely(target)) {
				deps.log(`[remote] 許可を断りました（差分を見ないと決められないもの）: ${route.id}`);
				response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
				response.end(JSON.stringify({ settled: false, reason: 'needs-diff' }));
				return;
			}
		}
		// 遠隔から渡すのは `allow` と `deny` だけ。
		// `allow-session` / `always-allow` は「以後聞かない」を作るので、
		// 差分を見られない場所から設定を永続化させない
		const settled = deps.decide(route.id, route.allow ? 'allow' : 'deny');
		deps.log(`[remote] ${route.allow ? '許可' : '拒否'}: ${route.id}（${settled ? '通りました' : 'もう待っていません'}）`);
		response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
		response.end(JSON.stringify({ settled }));
	});

	const idle = setInterval(() => {
		if (shouldClose(lastSeen, Date.now(), IDLE_MS)) {
			deps.log('[remote] 使われないので閉じました');
			close();
		}
	}, IDLE_CHECK_MS);

	let closed = false;
	function close(): void {
		if (closed) {
			return;
		}
		closed = true;
		clearInterval(idle);
		server.close();
	}

	// 明示したアドレスにだけ結ぶ（0.0.0.0 では開かない）。
	// ポートが決まるのは listening のあとなので、そこまで待ってから URL を作る
	const port = await new Promise<number | undefined>((resolve) => {
		server.once('error', () => resolve(undefined));
		server.listen(0, host, () => {
			const address = server.address();
			resolve(typeof address === 'object' && address !== null ? address.port : undefined);
		});
	});
	if (port === undefined) {
		close();
		void vscode.window.showErrorMessage('Nimbus: 承認だけの画面を開けませんでした。');
		return undefined;
	}
	return { url: pairingUrl(host, port, token), dispose: close };
}

/** 画面を開いて URL を見せる。もう開いていれば閉じる */
export function createRemoteApproval(deps: RemoteApprovalDeps): vscode.Disposable & { toggle: () => void } {
	let current: { url: string; dispose: () => void } | undefined;

	async function toggle(): Promise<void> {
		if (current) {
			current.dispose();
			current = undefined;
			deps.log('[remote] 閉じました');
			void vscode.window.showInformationMessage('Nimbus: 承認だけの画面を閉じました。');
			return;
		}
		const started = await startRemoteApproval(deps);
		if (!started) {
			return;
		}
		current = started;
		const text = describeServer(started.url, IDLE_MS / 60_000);
		deps.log(`[remote] ${started.url}`);
		const COPY = 'URL を写す';
		const choice = await vscode.window.showInformationMessage(
			'Nimbus: 承認だけの画面を開きました。',
			{ detail: text, modal: false },
			COPY
		);
		if (choice === COPY) {
			await vscode.env.clipboard.writeText(started.url);
		}
	}

	return {
		toggle: () => void toggle(),
		dispose: () => {
			current?.dispose();
			current = undefined;
		}
	};
}
