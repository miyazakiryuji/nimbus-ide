/**
 * CI を手元で再現する（T-132）の単体テスト。
 *
 * **CI 専用の行を落とす**、**版の違いを目立たせる**を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { parseWorkflow, renderCiRepro, toLocalScript } from '../core/ciRepro';

const workflow = [
	'name: CI',
	'jobs:',
	'  build:',
	'    runs-on: ubuntu-latest',
	'    steps:',
	'      - uses: actions/checkout@v4',
	'      - uses: actions/setup-node@v4',
	'        with:',
	'          node-version: 24.18.0',
	'      - name: 依存を入れる',
	'        run: npm ci',
	'      - name: テスト',
	'        run: |',
	'          npm run build',
	'          npm test',
	'      - uses: actions/upload-artifact@v4',
	'        run: echo upload',
	''
].join('\n');

const { steps, environment } = parseWorkflow(workflow);

test('run: の行を、ジョブ名つきで取り出す', () => {
	assert.deepStrictEqual(
		steps.map((s) => `${s.job}:${s.name ?? '-'}:${s.run.split('\n')[0]}`),
		['build:依存を入れる:npm ci', 'build:テスト:npm run build', 'build:-:echo upload']
	);
});

test('複数行の run: をまとめて拾う', () => {
	assert.ok(steps.some((s) => s.run.includes('npm run build') && s.run.includes('npm test')));
});

test('runs-on と setup-* の版を拾う', () => {
	assert.deepStrictEqual(
		{ runsOn: environment.runsOn, versions: environment.versions },
		{ runsOn: 'ubuntu-latest', versions: [{ tool: 'node', version: '24.18.0' }] }
	);
});

test('CI 専用の行は手元の手順に入れない', () => {
	assert.ok(!toLocalScript(steps).some((line) => line.includes('upload')));
});

test('手元の手順は打つ順に並ぶ', () => {
	assert.deepStrictEqual(toLocalScript(steps), ['npm ci', 'npm run build', 'npm test']);
});

test('版が違えば目立たせる', () => {
	const text = renderCiRepro(steps, environment, { node: '22.16.0' });
	assert.deepStrictEqual(
		[text.includes('⚠️ node'), text.includes('CI だけ落ちる」の多くはここです')],
		[true, true]
	);
});

test('版が合っていれば ✅ にする', () => {
	assert.ok(renderCiRepro(steps, environment, { node: '24.18.0' }).includes('✅ node'));
});

test('そのまま実行はしないと書く', () => {
	assert.ok(renderCiRepro(steps, environment, {}).includes('そのまま実行はしません'));
});

test('取り出せなければ、どこを見ているかを書く', () => {
	assert.ok(renderCiRepro([], { versions: [] }, {}).includes('.github/workflows'));
});
