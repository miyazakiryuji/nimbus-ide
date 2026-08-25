/**
 * ドクター（`nimbus/scripts/doctor.mjs`）の「ビューにプロバイダが付いているか」の見かた。
 *
 * **T-284 の守り。** 実際に起きたのは、動いているデバッグ面（T-249）を
 * 「プロバイダを登録していない」と言ってしまうこと。
 * **偽の指摘は、直っているものを直させる** — 本物の指摘より質が悪い。
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { settingReadKeys, viewProviderIds } from '../../scripts/doctor.mjs';

test('登録のしかたが違っても、プロバイダが付いていると読む（T-284）', () => {
	const sources = [
		"vscode.window.registerWebviewViewProvider('nimbus.cockpit', provider);",
		"vscode.window.registerTreeDataProvider('nimbus.board', board);",
		// これを見落としていた
		"const debugTree = vscode.window.createTreeView('nimbus.debug', { treeDataProvider: debugView });",
		"static readonly viewType = 'nimbus.help';"
	].join('\n');

	assert.deepEqual(
		[...viewProviderIds(sources)].sort(),
		['nimbus.board', 'nimbus.cockpit', 'nimbus.debug', 'nimbus.help']
	);
});

test('どこにも登録が無ければ空のまま（T-284）', () => {
	assert.deepEqual([...viewProviderIds('const x = 1;\n')], []);
});

/**
 * 「宣言されているが読まれていない設定」の見かた（T-323 の守り）。
 *
 * 実際に起きたのは、読まれている設定 4 つ（claudeMd.templates / agents.models /
 * audit.enabled / managedPolicy）を「読まれていない」と言ってしまうこと。
 * 入れ子のジェネリクス・変数に受けてからの読み・`inspect()` を見られていなかった。
 */
test('入れ子のジェネリクス・inspect・変数受けを、読みとして拾う（T-323）', () => {
	const sources = [
		// 入れ子のジェネリクス（claudeMd.templates で見落とした形）
		"vscode.workspace.getConfiguration('nimbus')",
		"\t.get<Record<string, string>>('claudeMd.templates', {});",
		// inspect() 経由（managedPolicy で見落とした形）
		"const inspected = vscode.workspace.getConfiguration('nimbus').inspect<ManagedPolicy>('managedPolicy');",
		// 変数に受けてから読む（audit.enabled で見落とした形）。
		// 代入と読みの間が 80 字を超えると近接パターンが届かない — そこを変数名の追跡で拾う
		"const auditConfig = vscode.workspace.getConfiguration('nimbus');",
		"const somethingLongEnoughToPushTheReadOutOfTheEightyCharacterProximityWindow = prepare(everything);",
		"const auditOn = auditConfig.get<boolean>('audit.enabled') !== false;",
		// 従来から読めていた形（壊していないことの確認）
		"const plain = config.get('tasks.maxConcurrent');"
	].join('\n');
	const reads = settingReadKeys(sources);
	assert.deepEqual(
		{ strict: [...reads.strict].sort(), loose: [...reads.loose].sort() },
		{
			// strict は変数受けを含まない — 他の名前空間を nimbus と誤認して偽の error を作らないため
			strict: ['nimbus.claudeMd.templates', 'nimbus.managedPolicy', 'nimbus.tasks.maxConcurrent'],
			loose: ['nimbus.audit.enabled', 'nimbus.claudeMd.templates', 'nimbus.managedPolicy', 'nimbus.tasks.maxConcurrent']
		}
	);
});

test('別の名前空間を変数に受けた読みは、nimbus の読みに数えない（T-323）', () => {
	const sources = [
		"const gitConfig = vscode.workspace.getConfiguration('git');",
		"const mode = gitConfig.get<string>('postCommitCommand');"
	].join('\n');
	const reads = settingReadKeys(sources);
	assert.deepEqual({ strict: [...reads.strict], loose: [...reads.loose] }, { strict: [], loose: [] });
});
