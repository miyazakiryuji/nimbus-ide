/**
 * Herdr のソケットに 1 往復して、いま動いているものを読む（tasks.md T-279）。
 *
 * **入っていれば使う。同梱しない**（権利の確認結果・`nimbus/docs/history/herdr-license-review.md`）。
 * ソケットが無ければ「Herdr は居ない」だけで、何も起きない。
 *
 * 読むだけ。**操作はしない** — Nimbus 側にも持ち主がいるので、両方から触ると壊れる。
 * 解釈は `core/herdr.ts`（VS Code 非依存・単体テスト済み）。
 */
import { connect } from 'net';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { parseAgents, parseResponse, requestLine, type HerdrPane } from './core/herdr';

/** 1 往復の待ち上限。居ないものを待って画面を止めない */
const TIMEOUT_MS = 1500;

/**
 * ソケットの場所（socket API の実測）。
 * `HERDR_SOCKET_PATH` → `HERDR_SESSION` の名前つき → 既定、の順で見る。
 */
export function socketPath(env: NodeJS.ProcessEnv = process.env): string {
	const explicit = env['HERDR_SOCKET_PATH'];
	if (explicit) {
		return explicit;
	}
	const base = join(env['HOME'] ?? homedir(), '.config', 'herdr');
	const named = env['HERDR_SESSION'];
	return named ? join(base, 'sessions', named, 'herdr.sock') : join(base, 'herdr.sock');
}

/** Herdr が動いているか。ソケットが在るかどうかで見る（プロセスを探しに行かない） */
export function isRunning(env?: NodeJS.ProcessEnv): boolean {
	return existsSync(socketPath(env));
}

/**
 * `agent.list` を 1 回だけ叩く。
 * 居ない・答えない・読めないは、どれも「一覧に出すものが無い」に畳んで返す
 * （Herdr が居ないことで Nimbus の画面が止まってはいけない）。
 */
export async function listAgents(options: { path?: string; timeoutMs?: number } = {}): Promise<HerdrPane[]> {
	const path = options.path ?? socketPath();
	if (!existsSync(path)) {
		return [];
	}
	const line = await request(path, requestLine('nimbus-1', 'agent.list'), options.timeoutMs ?? TIMEOUT_MS);
	if (!line) {
		return [];
	}
	const { result } = parseResponse(line);
	return parseAgents(result);
}

/** 1 行送って 1 行受け取る。改行区切り JSON なので、最初の改行までで足りる */
function request(path: string, payload: string, timeoutMs: number): Promise<string | undefined> {
	return new Promise((resolve) => {
		let buffer = '';
		let settled = false;
		const done = (value: string | undefined): void => {
			if (!settled) {
				settled = true;
				socket.destroy();
				resolve(value);
			}
		};
		const socket = connect(path);
		socket.setTimeout(timeoutMs, () => done(undefined));
		socket.on('connect', () => socket.write(payload));
		socket.on('data', (chunk) => {
			buffer += chunk.toString('utf8');
			const at = buffer.indexOf('\n');
			if (at >= 0) {
				done(buffer.slice(0, at));
			}
		});
		socket.on('error', () => done(undefined));
		socket.on('close', () => done(undefined));
	});
}
