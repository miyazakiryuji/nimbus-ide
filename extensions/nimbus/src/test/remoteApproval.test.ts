/**
 * 手元の端末から承認だけする。
 *
 * ここは**エージェントに何かをさせる口**なので、緩いと事故る。
 * 守るのは「合言葉が合わなければ何も返さない」と「承認以外の道が無い」の 2 つ。
 *
 * 守っている修正（T-274）: T-054 / T-086
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	describeServer,
	matchRoute,
	orderItems,
	pairingUrl,
	renderList,
	renderPage,
	shouldClose,
	waitingLabel,
	type RemoteItem
} from '../core/remoteApproval';

const TOKEN = 'abc123';

test('合言葉が合わなければ、どの道も通さない', () => {
	assert.deepStrictEqual(matchRoute('/', TOKEN), { kind: 'unauthorized' });
	assert.deepStrictEqual(matchRoute('/other/api/list', TOKEN), { kind: 'unauthorized' });
	assert.deepStrictEqual(matchRoute('/api/list', TOKEN), { kind: 'unauthorized' });
	assert.deepStrictEqual(matchRoute('/abc123x/', TOKEN), { kind: 'unauthorized' });
});

test('通るのは画面・一覧・答えるの 3 つだけ', () => {
	assert.deepStrictEqual(matchRoute('/abc123/', TOKEN), { kind: 'page' });
	assert.deepStrictEqual(matchRoute('/abc123/api/list', TOKEN), { kind: 'list' });
	assert.deepStrictEqual(matchRoute('/abc123/api/allow/x-1', TOKEN), { kind: 'decide', id: 'x-1', allow: true });
	assert.deepStrictEqual(matchRoute('/abc123/api/deny/x-1', TOKEN), { kind: 'decide', id: 'x-1', allow: false });
	// 承認以外の道は無い
	assert.deepStrictEqual(matchRoute('/abc123/api/send', TOKEN), { kind: 'notfound' });
	assert.deepStrictEqual(matchRoute('/abc123/api/transcript', TOKEN), { kind: 'notfound' });
	assert.deepStrictEqual(matchRoute('/abc123/files/x', TOKEN), { kind: 'notfound' });
	assert.deepStrictEqual(matchRoute('/abc123/api/allow', TOKEN), { kind: 'notfound' });
});

const ITEMS: RemoteItem[] = [
	{ id: '1', toolName: 'Read', summary: 'a.ts を読む', risk: 'low', waitingSeconds: 3600, canApprove: true },
	{ id: '2', toolName: 'Bash', summary: 'rm -rf', risk: 'high', waitingSeconds: 10, canApprove: false },
	{ id: '3', toolName: 'Write', summary: 'b.ts を書く', risk: 'medium', waitingSeconds: 120, canApprove: true }
];

test('危ないものを先に、同じ危なさなら待っている順に', () => {
	assert.deepStrictEqual(
		orderItems(ITEMS).map((item) => item.id),
		['2', '3', '1']
	);
});

test('待ち時間に秒は見せない', () => {
	assert.strictEqual(waitingLabel(3), 'たった今');
	assert.strictEqual(waitingLabel(120), '2 分待ち');
	assert.strictEqual(waitingLabel(7200), '2 時間待ち');
});

test('一覧に入る文は escape してから渡す', () => {
	const list = JSON.parse(
		renderList([
			{ id: '1', toolName: 'Bash', summary: '<img onerror=x>', risk: 'high', waitingSeconds: 0, canApprove: false }
		])
	);
	assert.strictEqual(list[0].summary, '&lt;img onerror=x&gt;');
	assert.strictEqual(list[0].riskLabel, '要注意');
	assert.strictEqual(list[0].waiting, 'たった今');
	assert.strictEqual(list[0].canApprove, false);
});

test('差分を見ないと決められないものは、一覧に出すが許可ボタンを出さない', () => {
	const page = renderPage('x');
	// 画面側は canApprove を見て出し分ける
	assert.ok(page.includes('item.canApprove'), page);
	assert.ok(page.includes('ここでは断るだけです'), page);
	// 隠さない — 何で止まっているかは知りたい
	const list = JSON.parse(renderList(ITEMS));
	assert.deepStrictEqual(list.map((item: { id: string; canApprove: boolean }) => [item.id, item.canApprove]), [['2', false], ['3', true], ['1', true]]);
});

test('画面は外に何も取りに行かない', () => {
	const page = renderPage('Nimbus の承認待ち');
	assert.ok(!/https?:\/\//.test(page.replace(/<html lang="ja">/, '')), page.slice(0, 400));
	assert.ok(page.includes('name="referrer" content="no-referrer"'), page);
	assert.ok(page.includes('Nimbus の承認待ち'), page);
});

test('使われないまま時間が経ったら閉じる', () => {
	assert.strictEqual(shouldClose(1000, 1000 + 10 * 60_000, 10 * 60_000), true);
	assert.strictEqual(shouldClose(1000, 1000 + 60_000, 10 * 60_000), false);
});

test('伝える文に閉じ方が入っている', () => {
	const url = pairingUrl('192.168.1.4', 7391, TOKEN);
	assert.strictEqual(url, 'http://192.168.1.4:7391/abc123/');
	const text = describeServer(url, 10);
	assert.ok(text.includes('指示は送れません'), text);
	assert.ok(text.includes('10 分使われなければ自動で閉じます'), text);
	assert.ok(text.includes('前の URL は効きません'), text);
	assert.ok(text.includes('ここからは断ることしかできません'), text);
});
