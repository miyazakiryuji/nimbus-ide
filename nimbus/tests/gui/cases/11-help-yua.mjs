/**
 * ヘルプ（ゆあ）の会話表示（f3-f6.md §6 の 4 つめ）。
 *
 * ゆあはコックピットと同じ Webview を別設定で使い回している。ここで確かめるのは
 * **入口があること**と、**ゆあ用の見た目になっていること** — 入力欄の案内文が
 * コックピットのものではなく「使い方を聞く」側になっていること。
 * 実際に会話させると課金が発生するので、往復は `--with-claude` の 07 に任せる。
 */
import { expandPane, includesAny, labels, openNimbusSidebar, sidebarText } from '../helpers.mjs';

export default {
	name: 'ヘルプ（ゆあ）が開き、ゆあ用の入力欄になっている',
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');

		const sidebar = await sidebarText(page);
		ctx.expect(
			includesAny(sidebar, labels('view.nimbus.help')),
			`サイドバーにヘルプのビューが無い:\n${sidebar.slice(0, 400)}`
		);

		// 畳まれているので開く。開くと Webview が読み込まれる
		await expandPane(page, labels('view.nimbus.help')[0]);
		await page.waitForTimeout(1500);

		const ok = await findPlaceholder(page, 'Nimbus の使い方を聞く');
		ctx.expect(ok, 'ゆあの入力欄の案内文が見つからない（コックピットと同じ設定で開いている可能性）');
		await ctx.shot('help-yua');
	}
};

/** 全フレームから、指定の案内文を持つ入力欄を探す */
async function findPlaceholder(page, needle) {
	for (let attempt = 0; attempt < 10; attempt++) {
		for (const frame of page.frames()) {
			try {
				const hit = await frame.evaluate((text) => {
					const fields = [...document.querySelectorAll('textarea, input')];
					return fields.some((field) => (field.getAttribute('placeholder') ?? '').includes(text));
				}, needle);
				if (hit) {
					return true;
				}
			} catch {
				continue; // 破棄されたフレームは飛ばす
			}
		}
		await page.waitForTimeout(1000);
	}
	return false;
}
