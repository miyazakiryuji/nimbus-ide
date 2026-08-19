/**
 * コミットの意味単位への分割（T-114）の単体テスト。
 *
 * 出すのは「提案」なので、正しさより**壊れないこと**を押さえる。
 * とくに `git add -- …` は人がそのまま貼るので、パスの引用を間違えないことが要。
 *
 *   node --test extensions/nimbus/out/test
 *
 * 守っている修正（T-274）: T-173
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { addCommandFor, formatPlan, groupChanges, parseStatus } from '../core/commitSplit';

test('git status --porcelain を読む（追跡外・rename・引用符つき）', () => {
	const porcelain = [
		' M extensions/nimbus/src/permissions.ts',
		'?? extensions/nimbus/src/approvalsView.ts',
		'R  old/name.ts -> new/name.ts',
		'MM tasks.md',
		'A  "path with space.ts"',
		''
	].join('\n');
	assert.deepStrictEqual(parseStatus(porcelain), [
		{ path: 'extensions/nimbus/src/permissions.ts', status: ' M' },
		{ path: 'extensions/nimbus/src/approvalsView.ts', status: '??' },
		{ path: 'new/name.ts', status: 'R ' },
		{ path: 'tasks.md', status: 'MM' },
		{ path: 'path with space.ts', status: 'A ' }
	]);
});

test('同じ機能の実装・ビュー・テストが 1 つの束になる', () => {
	const files = [
		{ path: 'extensions/nimbus/src/core/usage.ts', status: ' M' },
		{ path: 'extensions/nimbus/src/usageView.ts', status: ' M' },
		{ path: 'extensions/nimbus/src/test/usage.test.ts', status: '??' }
	];
	const groups = groupChanges(files);
	assert.deepStrictEqual(groups.map((g) => g.title), ['usage まわり']);
	assert.deepStrictEqual(groups[0].files, [
		'extensions/nimbus/src/core/usage.ts',
		'extensions/nimbus/src/test/usage.test.ts',
		'extensions/nimbus/src/usageView.ts'
	]);
});

test('別々の機能は別の束になり、大きい束が先に来る', () => {
	const files = [
		{ path: 'extensions/nimbus/src/core/usage.ts', status: ' M' },
		{ path: 'extensions/nimbus/src/core/approvalRules.ts', status: '??' },
		{ path: 'extensions/nimbus/src/approvalsView.ts', status: '??' },
		{ path: 'extensions/nimbus/src/test/approvals.test.ts', status: '??' }
	];
	assert.deepStrictEqual(
		groupChanges(files).map((g) => [g.title, g.files.length]),
		// approvalsView.ts と test/approvals.test.ts は同じ「approvals」に寄る
		[['approvals まわり', 2], ['approvalrules まわり', 1], ['usage まわり', 1]]
	);
});

test('コア・仕様・台帳は機能とは分けて、最後にまとめる', () => {
	const files = [
		{ path: 'tasks.md', status: ' M' },
		{ path: 'nimbus/docs/specs/usage.md', status: ' M' },
		{ path: 'src/vs/sessions/sessions.common.main.ts', status: ' M' },
		{ path: 'extensions/nimbus/src/core/usage.ts', status: ' M' }
	];
	assert.deepStrictEqual(groupChanges(files).map((g) => g.title), [
		'usage まわり',
		'コア（src/vs）の変更',
		'仕様・確認記録',
		'台帳（tasks.md など）'
	]);
});

test('機能名で束ねられないものは「その他」に落ち、混在の可能性を伝える', () => {
	const groups = groupChanges([
		{ path: 'scripts/foo.sh', status: ' M' },
		{ path: 'package.json', status: ' M' }
	]);
	assert.deepStrictEqual(groups.map((g) => g.title), ['その他の変更']);
	assert.ok(groups[0].reason.includes('混ざっている可能性'), groups[0].reason);
});

test('変更が無ければ束も無い', () => {
	assert.deepStrictEqual(groupChanges([]), []);
	assert.ok(formatPlan([]).includes('変更はありません'));
});

test('git add はパス指定で出す（-A を出さない）', () => {
	const command = addCommandFor({ title: 't', reason: 'r', files: ['a.ts', 'b/c.ts'] });
	assert.strictEqual(command, "git add -- 'a.ts' 'b/c.ts'");
	assert.ok(!command.includes('-A'), '-A を出してはいけない（他セッションの変更を巻き込む）');
});

test('空白や単引用符を含むパスでも壊れない', () => {
	assert.strictEqual(
		addCommandFor({ title: 't', reason: 'r', files: ["it's a/file name.ts"] }),
		`git add -- 'it'\\''s a/file name.ts'`
	);
});

test('一枚の下書きに、束ごとの見出し・理由・コマンドが並ぶ', () => {
	const plan = formatPlan(
		groupChanges([
			{ path: 'extensions/nimbus/src/core/usage.ts', status: ' M' },
			{ path: 'tasks.md', status: ' M' }
		])
	);
	assert.ok(plan.includes('## 1. usage まわり'), plan);
	assert.ok(plan.includes('## 2. 台帳（tasks.md など）'), plan);
	assert.ok(plan.includes("git add -- 'extensions/nimbus/src/core/usage.ts'"), plan);
	// 並行開発の注意を必ず添える（この開発でいちばん事故が起きた場所）
	assert.ok(plan.includes('git add -A'), '`git add -A` を使わない注意が出ていない');
	assert.ok(plan.includes('2 ファイルを 2 束'), plan);
});
