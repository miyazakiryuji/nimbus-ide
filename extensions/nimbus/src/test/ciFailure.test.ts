/**
 * CI 失敗の自動調査。
 *
 * **走っている最中の実行を「失敗」と見ない**ことと、
 * **まだ直させない**ことを固定する。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildCiPrompt, describeRun, latestFailure, parseRunList } from '../core/ciFailure';

const JSON_OUT = JSON.stringify([
	{ databaseId: 3, workflowName: 'CI', status: 'in_progress', conclusion: '', headBranch: 'nimbus', createdAt: '2026-08-13T03:00:00Z' },
	{ databaseId: 2, workflowName: 'CI', status: 'completed', conclusion: 'failure', headBranch: 'nimbus', createdAt: '2026-08-13T02:00:00Z' },
	{ databaseId: 1, workflowName: 'CI', status: 'completed', conclusion: 'success', headBranch: 'nimbus', createdAt: '2026-08-13T01:00:00Z' },
	{ notARun: true }
]);

test('gh の出力を読む。想定外の要素は飛ばす', () => {
	const runs = parseRunList(JSON_OUT);
	assert.deepStrictEqual(runs.map((run) => run.id), [3, 2, 1]);
	assert.strictEqual(runs[0].createdAt, '2026-08-13 03:00');
	assert.deepStrictEqual(parseRunList('壊れた'), []);
});

test('走っている最中のものは失敗として拾わない', () => {
	assert.strictEqual(latestFailure(parseRunList(JSON_OUT))?.id, 2);
	assert.strictEqual(latestFailure([]), undefined);
});

test('一覧は結果を記号で出す', () => {
	const runs = parseRunList(JSON_OUT);
	assert.deepStrictEqual(runs.map(describeRun), [
		'… CI  nimbus  2026-08-13 03:00',
		'× CI  nimbus  2026-08-13 02:00',
		'○ CI  nimbus  2026-08-13 01:00'
	]);
});

test('投入する文は「まだ直さない」と切り分けを求める', () => {
	const run = parseRunList(JSON_OUT)[1];
	const prompt = buildCiPrompt(run, Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n'), 5);
	assert.ok(prompt.startsWith('CI が失敗しました（CI / nimbus）。'), prompt);
	assert.ok(prompt.includes('**まだ直さないでください。**'), prompt);
	assert.ok(prompt.includes('**手元で再現するのか、CI 固有なのか**'), prompt);
	assert.ok(prompt.includes('先頭 295 行は省略'), prompt);
});
