/**
 * Herdr のセッションを読む（T-279）の単体テスト。
 *
 * Herdr 本体は入れずに確かめる — **文書どおりの受け答えをする偽のソケット**を立てて、
 * こちらの読み手が通るかを見る。居ないとき・答えないときに画面が止まらないことも見る。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { createServer } from 'net';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { test } from 'node:test';
import { parseAgents, requestLine, toTabState } from '../core/herdr';
import { listAgents, socketPath } from '../herdr';

test('ソケットの場所は、環境変数 → 名前つき → 既定の順に決まる', () => {
	assert.deepStrictEqual(
		[
			socketPath({ HERDR_SOCKET_PATH: '/tmp/x.sock' }),
			socketPath({ HOME: '/h', HERDR_SESSION: 'work' }),
			socketPath({ HOME: '/h' })
		],
		['/tmp/x.sock', '/h/.config/herdr/sessions/work/herdr.sock', '/h/.config/herdr/herdr.sock']
	);
});

test('Herdr の状態を、Nimbus のタブの状態へ寄せる（blocked は許可待ち）', () => {
	assert.deepStrictEqual(
		['blocked', 'working', 'done', 'idle', 'unknown'].map((s) => toTabState(s as 'idle')),
		['waiting-approval', 'running', 'done', 'asking', 'stopped']
	);
});

test('読めない要素は落とし、pane_id のあるものだけを拾う', () => {
	assert.deepStrictEqual(
		parseAgents({
			agents: [
				{ pane_id: 'w1:p1', title: 'ログイン修正', cwd: '/w/app', agent_status: 'blocked' },
				{ title: 'pane_id が無い', agent_status: 'working' },
				{ pane_id: 'w1:p2', agent_status: '知らない値' }
			]
		}),
		[
			{ paneId: 'w1:p1', title: 'ログイン修正', cwd: '/w/app', status: 'blocked' },
			{ paneId: 'w1:p2', title: 'w1:p2', cwd: undefined, status: 'unknown' }
		]
	);
});

test('文書どおりの受け答えをするソケットから、動いているものを読める', async () => {
	const path = join(mkdtempSync(join(tmpdir(), 'nimbus-herdr-')), 'herdr.sock');
	const server = createServer((socket) => {
		socket.on('data', (chunk) => {
			const request = JSON.parse(chunk.toString('utf8').trim());
			socket.write(
				`${JSON.stringify({
					id: request.id,
					result: { agents: [{ pane_id: 'w1:p1', title: '直す', agent_status: 'working' }] }
				})}\n`
			);
		});
	});
	await new Promise<void>((done) => server.listen(path, done));
	const panes = await listAgents({ path });
	server.close();
	assert.deepStrictEqual(panes, [{ paneId: 'w1:p1', title: '直す', cwd: undefined, status: 'working' }]);
});

test('居ない・答えないときは、空で返して画面を止めない', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'nimbus-herdr-'));
	const silent = join(dir, 'silent.sock');
	const server = createServer(() => undefined); // 受け取るが答えない
	await new Promise<void>((done) => server.listen(silent, done));
	const [missing, quiet] = await Promise.all([
		listAgents({ path: join(dir, 'nothing.sock') }),
		listAgents({ path: silent, timeoutMs: 300 })
	]);
	server.close();
	assert.deepStrictEqual([missing, quiet, requestLine('a', 'agent.list')], [
		[],
		[],
		'{"id":"a","method":"agent.list","params":{}}\n'
	]);
});
