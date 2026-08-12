/**
 * 戻す道と、急ぐ道。
 *
 * ここで守りたいのは 2 つ —
 * **戻らないものを「戻る」と言わない**ことと、
 * **急ぐときに省いてよい段と、絶対に省かない段を取り違えない**こと。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	buildHotfixPlan,
	buildRollbackPlan,
	describeRollback,
	findIrreversible,
	hotfixBranchName,
	renderHotfixChecklist,
	renderRollbackScript,
	rollbackWeight,
	urgentSteps
} from '../core/rollback';

const COMMITS = [
	{ hash: 'aaa1111', subject: 'feat: 支払いを足す' },
	{ hash: 'bbb2222', subject: 'fix: 丸め誤差' }
];

test('DB・データ・外側の変更は「戻らない」と名指しする', () => {
	assert.deepStrictEqual(
		findIrreversible([
			'src/app.ts',
			'db/migrate/20260813_add_column.rb',
			'prisma/migrations/001_init/migration.sql',
			'seeds/users.json',
			'terraform/main.tf',
			'.github/workflows/deploy.yml'
		]).map((entry) => [entry.kind, entry.evidence]),
		[
			['migration', 'db/migrate/20260813_add_column.rb'],
			['migration', 'prisma/migrations/001_init/migration.sql'],
			['data', 'seeds/users.json'],
			['external', 'terraform/main.tf'],
			['external', '.github/workflows/deploy.yml']
		]
	);
});

test('前の版があれば出し直し、無ければ打ち消し', () => {
	const redeploy = buildRollbackPlan({
		current: 'v1.3.0',
		previous: 'v1.2.0',
		commits: COMMITS,
		changedFiles: ['src/app.ts']
	});
	assert.strictEqual(redeploy.kind, 'redeploy');
	assert.strictEqual(rollbackWeight(redeploy), 'light');

	const revert = buildRollbackPlan({ current: 'v1.3.0', commits: COMMITS, changedFiles: ['src/app.ts'] });
	assert.strictEqual(revert.kind, 'revert');
	assert.strictEqual(rollbackWeight(revert), 'careful');
});

test('マイグレーションが混ざったら、コードだけでは戻らないと言う', () => {
	const plan = buildRollbackPlan({
		current: 'v1.3.0',
		previous: 'v1.2.0',
		commits: COMMITS,
		changedFiles: ['db/migrate/001.sql']
	});
	assert.strictEqual(rollbackWeight(plan), 'heavy');
	assert.strictEqual(
		describeRollback(plan),
		[
			'v1.3.0 → v1.2.0 に戻します（コードだけでは戻りません）',
			'  戻すと消える変更: 2 件',
			'  戻らない: db/migrate/001.sql — コードを戻しても DB のスキーマは戻りません。down が書かれているかを先に見てください'
		].join('\n')
	);
});

test('スクリプトは --run が無ければ何もしない', () => {
	const script = renderRollbackScript(
		buildRollbackPlan({
			current: 'v1.3.0',
			previous: 'v1.2.0',
			commits: COMMITS,
			changedFiles: ['db/migrate/001.sql']
		})
	);
	assert.ok(script.includes('if [ "${1:-}" != "--run" ]; then'), script);
	assert.ok(script.includes('git checkout v1.2.0'), script);
	assert.ok(script.includes('# ---- これは戻りません'), script);
	assert.ok(!script.includes('git revert'), script);
});

test('前の版が無いときのスクリプトは打ち消しになる', () => {
	const script = renderRollbackScript(
		buildRollbackPlan({ current: 'abc1234', commits: COMMITS, changedFiles: [] })
	);
	assert.ok(script.includes('git revert --no-edit abc1234'), script);
});

test('枝の名前は本番のタグから作り、記号は落とす', () => {
	assert.strictEqual(hotfixBranchName('v1.2.3', 'ログインで落ちる Crash on Login!'), 'hotfix/v1.2.3-crash-on-login');
	assert.strictEqual(hotfixBranchName('v1.2.3', 'ログイン'), 'hotfix/v1.2.3');
});

const PLAN = buildHotfixPlan({ productionTag: 'v1.2.3', defaultBranch: 'main', summary: 'crash on login' });

test('急ぐ道でも、テストと戻し口と main への戻しは省かない', () => {
	assert.deepStrictEqual(
		urgentSteps(PLAN).map((step) => step.title),
		[
			'戻し口を先に用意する',
			'本番に出ている版から枝を切る',
			'直す（**この障害に関係する変更だけ**）',
			'直った証拠になるテストを 1 つ足す',
			'テストを通す',
			'出す',
			'直ったことを本番で確かめる',
			'main へ戻す'
		]
	);
});

test('枝は main ではなく本番のタグから切る', () => {
	const branch = PLAN.find((step) => step.title === '本番に出ている版から枝を切る');
	assert.strictEqual(branch?.command, 'git fetch --tags && git switch -c hotfix/v1.2.3-crash-on-login v1.2.3');
});

test('急ぐときは、後回しにしてよい段を消さずに畳む', () => {
	const urgent = renderHotfixChecklist(PLAN, true);
	assert.ok(urgent.includes('## ホットフィックス（急ぐ道）'), urgent);
	assert.ok(urgent.includes('### 落ち着いてから'), urgent);
	assert.ok(urgent.includes('- レビューを頼む'), urgent);
	assert.ok(!/^1\. レビューを頼む/m.test(urgent), urgent);

	const normal = renderHotfixChecklist(PLAN, false);
	assert.ok(!normal.includes('### 落ち着いてから'), normal);
	assert.ok(normal.includes('6. レビューを頼む'), normal);
});
