/**
 * エラー監視ツールとの連携（T-142）の単体テスト。
 *
 * この機能の値打ちは「**スタックには無いもの**」を出すところにある。
 * 件数・影響人数（＝直す順番）と、足あと（＝再現の入力）を落とさないことを押さえる。
 * 数を読み違えると優先順位が嘘になるので、そこは厳しく見る。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { asCount, describeImpact, fixPrompt, formatIssue, parseMonitoredIssue } from '../core/errorMonitor';

const SENTRY = JSON.stringify({
	title: "TypeError: Cannot read properties of undefined (reading 'name')",
	culprit: 'formatUser(src/user.ts)',
	count: '4021',
	userCount: 137,
	firstSeen: '2026-08-12T10:00:00Z',
	lastSeen: '2026-08-13T02:00:00Z',
	status: 'unresolved',
	permalink: 'https://sentry.io/organizations/x/issues/1/',
	tags: [
		{ key: 'release', value: 'app@1.4.2' },
		{ key: 'environment', value: 'production' }
	],
	breadcrumbs: {
		values: [
			{ category: 'navigation', message: '/home → /users', timestamp: '2026-08-13T01:59:00Z' },
			{ category: 'ui.click', message: 'button#invite' },
			{ category: 'http', data: { url: 'POST /api/invite' } },
			{ type: 'error', level: 'error' }
		]
	}
});

test('数として読めるものだけを数える（Sentry は件数を文字列で返す）', () => {
	assert.deepStrictEqual(
		[asCount('4021'), asCount(12), asCount('x'), asCount(-1), asCount(undefined), asCount(null)],
		[4021, 12, undefined, undefined, undefined, undefined]
	);
});

test('件数・影響人数・リリース・環境を取り出す（直す順番を決める材料）', () => {
	const issue = parseMonitoredIssue(SENTRY)!;
	assert.deepStrictEqual(
		[issue.count, issue.userCount, issue.release, issue.environment, issue.unresolved],
		[4021, 137, 'app@1.4.2', 'production', true]
	);
});

test('足あとを読む。message が無くても data.url や type から拾う', () => {
	const issue = parseMonitoredIssue(SENTRY)!;
	assert.deepStrictEqual(
		issue.breadcrumbs.map((c) => c.message),
		['/home → /users', 'button#invite', 'POST /api/invite', 'error']
	);
});

test('metadata しか無い形でも題名を作る', () => {
	const issue = parseMonitoredIssue(JSON.stringify({ metadata: { type: 'TypeError', value: 'boom' } }));
	assert.strictEqual(issue?.title, 'TypeError: boom');
});

test('読めないものは undefined（中途半端に読むと件数が嘘になる）', () => {
	assert.strictEqual(parseMonitoredIssue('not json'), undefined);
	assert.strictEqual(parseMonitoredIssue('[]'), undefined);
	assert.strictEqual(parseMonitoredIssue('{}'), undefined);
});

test('status が無いものを、解決済みと決めつけない', () => {
	assert.strictEqual(parseMonitoredIssue(JSON.stringify({ title: 'x' }))?.unresolved, true);
	assert.strictEqual(parseMonitoredIssue(JSON.stringify({ title: 'x', status: 'resolved' }))?.unresolved, false);
});

test('影響の大きさは、分からないときに 0 と言わない', () => {
	assert.strictEqual(describeImpact({ title: 'x', breadcrumbs: [], unresolved: true }), '影響の大きさは分かりません');
	assert.strictEqual(
		describeImpact({ title: 'x', count: 4021, userCount: 137, breadcrumbs: [], unresolved: true }),
		'4,021 回 / 137 人'
	);
});

test('まとめは影響を最初に出し、足あとを「再現の入力」として示す', () => {
	const out = formatIssue(parseMonitoredIssue(SENTRY)!);
	// 直す順番を決めるのが先なので、影響が最初
	assert.ok(out.indexOf('影響: 4,021 回 / 137 人') < out.indexOf('## 落ちるまでの足あと'), out);
	assert.ok(out.includes('**再現の入力はここから作れます。**'), out);
	assert.ok(out.includes('POST /api/invite'), out);
	assert.ok(out.includes('app@1.4.2'), out);
});

test('解決済みのものは、直しにいく前に確かめさせる', () => {
	const out = formatIssue(parseMonitoredIssue(JSON.stringify({ title: 'x', status: 'resolved' }))!);
	assert.ok(out.includes('解決済みとして記録されています'), out);
});

test('足あとが無いときも、無いと言う（黙って省かない）', () => {
	const out = formatIssue(parseMonitoredIssue(JSON.stringify({ title: 'x' }))!);
	assert.ok(out.includes('足あと（breadcrumbs）は入っていませんでした'), out);
});

test('足あとが多いときは新しい方を残し、省いたことを言う', () => {
	const many = JSON.stringify({
		title: 'x',
		breadcrumbs: { values: Array.from({ length: 20 }, (_, i) => ({ message: `step ${i}` })) }
	});
	const out = formatIssue(parseMonitoredIssue(many)!);
	assert.ok(out.includes('古い 8 件は省略'), out);
	// 落ちた瞬間に近いものが残る
	assert.ok(out.includes('step 19'), out);
	assert.ok(!out.includes('step 0\n'), out);
});

test('頼みかたは「まず再現」で、推測で埋めさせない', () => {
	const out = fixPrompt(parseMonitoredIssue(SENTRY)!);
	assert.ok(out.includes('**まず再現するテスト**'), out);
	assert.ok(out.includes('推測で埋めずに「分からない」と書いてください'), out);
});
