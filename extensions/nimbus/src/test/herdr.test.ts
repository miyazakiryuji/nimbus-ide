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
import { mkdtempSync, writeFileSync } from 'fs';
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

test('`agent.list` の結果を、扱いやすい形に畳む（T-297 / T-299）', () => {
	assert.deepStrictEqual(
		parseAgents({
			agents: [
				// **本物の Herdr 0.8.2 に繋いで写した形**（T-299）。
				// `name` は人が付けた名前、`agent` は種類。`title` 系は OSC が無いと入らない
				{
					terminal_id: 'term_6597312c885531',
					name: 'login-fix',
					agent: 'claude',
					agent_status: 'blocked',
					workspace_id: 'w1',
					tab_id: 'w1:t1',
					pane_id: 'w1:p1',
					focused: true,
					cwd: '/w/app',
					foreground_cwd: '/w/app/packages/api',
					revision: 0
				},
				{ name: 'pane_id が無い', agent_status: 'working' },
				{ pane_id: 'w1:p2', agent_status: '知らない値' }
			]
		}),
		[
			// 前面のプロセスの場所のほうが実態に近いので `foreground_cwd` を採る
			{ paneId: 'w1:p1', title: 'login-fix', cwd: '/w/app/packages/api', status: 'blocked' },
			{ paneId: 'w1:p2', title: 'w1:p2', cwd: undefined, status: 'unknown' }
		]
	);
});

test('名前が無いときは、せめて種類を出す（pane_id より読める）（T-299）', () => {
	// 名前を付けていないエージェントのペインは、実際に `name` も `title` も返ってこない。
	// 文書だけを見て `terminal_title_stripped` を先頭にしていたら、全部 `w1:p1` になっていた
	assert.deepStrictEqual(
		parseAgents({ agents: [{ pane_id: 'w1:p1', agent: 'claude', agent_status: 'working' }] })[0].title,
		'claude'
	);
});

test('古い項目名（title / cwd）でも読める（版が違っても落とさない）（T-297）', () => {
	assert.deepStrictEqual(
		parseAgents({ agents: [{ pane_id: 'w1:p1', title: '古い形', cwd: '/w/old', agent_status: 'done' }] }),
		[{ paneId: 'w1:p1', title: '古い形', cwd: '/w/old', status: 'done' }]
	);
});

test('飾りを落とした題名を優先する（T-297）', () => {
	// `terminal_title` は OSC のまま（シェル名などが付く）。読みやすいのは stripped のほう
	assert.deepStrictEqual(
		parseAgents({
			agents: [{ pane_id: 'w1:p1', terminal_title: 'ログイン修正 — zsh', agent_status: 'idle' }]
		})[0].title,
		'ログイン修正 — zsh'
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

test('古いソケットが残っていても、待たずに空で返す（T-299）', async () => {
	// **本物で確かめた形。** herdr を止めるとソケットは消えるが、落ちかたによっては
	// ファイルだけが残る。`existsSync` は true になるので、繋いでみるまで分からない
	const dir = mkdtempSync(join(tmpdir(), 'nimbus-herdr-'));
	const stale = join(dir, 'stale.sock');
	writeFileSync(stale, '');
	const started = Date.now();
	const panes = await listAgents({ path: stale, timeoutMs: 1500 });
	// 上限まで待ってしまうと、面が 1.5 秒固まる
	assert.deepStrictEqual([panes, Date.now() - started < 500], [[], true]);
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
