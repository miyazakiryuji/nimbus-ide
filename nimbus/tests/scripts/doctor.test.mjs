/**
 * ドクター（`nimbus/scripts/doctor.mjs`）の「ビューにプロバイダが付いているか」の見かた。
 *
 * **T-284 の守り。** 実際に起きたのは、動いているデバッグ面（T-249）を
 * 「プロバイダを登録していない」と言ってしまうこと。
 * **偽の指摘は、直っているものを直させる** — 本物の指摘より質が悪い。
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { viewProviderIds } from '../../scripts/doctor.mjs';

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
