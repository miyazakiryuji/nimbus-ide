/**
 * ローカル完結モード（T-077）と設定タブ（T-089）の通し確認。
 *
 * 仕様の「画面確認: ローカル完結の確認に『止まらないもの』が出る」と
 * 「画面確認: 設定タブにいまの値が並ぶ」がこれ。
 * **実セッション（課金）は要らない** — 設定を読むだけなので。
 *
 * ## 確認の文言そのものは、ここでは読めない
 *
 * `showWarningMessage({ modal: true })` はデスクトップでは**OS のネイティブダイアログ**になる。
 * ワークベンチに `modal-dialog-visible` が付くだけで、**中身は DOM に入らない**（実測）。
 * なので文言（止まるもの／止まらないもの）は `core/recovery.ts` の単体テストで押さえてある。
 *
 * ここで確かめるのは、単体テストでは絶対に分からない 2 つ:
 *
 * 1. **そもそも確認が出るか**（出さずに有効化していないか）
 * 2. **承諾しなければ有効にならないか**（「外に出ない」と思い込ませないための関門）
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { labels, openHiddenView, openNimbusSidebar, runCommand, sidebarText } from '../helpers.mjs';

/** モーダルが開いているか（ネイティブなので、ワークベンチ側の印で見る） */
async function modalOpen(page) {
	return page.evaluate(() => document.querySelector('.monaco-workbench')?.classList.contains('modal-dialog-visible') ?? false);
}

export default {
	name: 'ローカル完結は必ず確認を出し、承諾しなければ有効にならない',
	async run(page, ctx) {
		// --- ローカル完結モード ---
		await runCommand(page, labels('command.localOnly')[0]);

		let opened = false;
		for (let i = 0; i < 12; i++) {
			await page.waitForTimeout(600);
			opened = await modalOpen(page);
			if (opened) {
				break;
			}
		}
		ctx.expect(opened, '確認を出さずに切り替えようとしている（ローカル完結は黙って有効にしてはいけない）');
		await ctx.shot('local-only-dialog');

		// 承諾せずに閉じる
		await page.keyboard.press('Escape');
		await page.waitForTimeout(1500);

		// **承諾しなかったのだから、有効になっていてはいけない**
		const settingsPath = join(ctx.workspace, '.vscode', 'settings.json');
		const written = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : '';
		ctx.expect(
			!/"nimbus\.localOnly"\s*:\s*true/.test(written),
			`確認を閉じたのにローカル完結が有効になっている:\n${written}`
		);

		// --- 設定タブ ---
		// 設定ビューは既定で出していない（T-239）。コマンドから開く
		await openHiddenView(page, '設定ビューを開く');
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		const sidebar = await sidebarText(page);
		ctx.expect(sidebar.includes('設定'), `サイドバーに「設定」が無い:\n${sidebar.slice(0, 400)}`);
		await ctx.shot('settings-view');
	}
};
