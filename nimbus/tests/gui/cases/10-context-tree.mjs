/**
 * 文脈ツリーの表示内容（f3-f6.md §6 の 3 つめ）。
 *
 * セッションを開始していないときは「セッションを開始すると…」の案内が出るのが正で、
 * **空のツリーが黙って出ることが無い**ことを確かめる。案内が出ていれば、
 * ツリー自体は生きていて init を待っている状態だと分かる。
 */
import { expandPane, includesAny, labels, openNimbusSidebar, sidebarText } from '../helpers.mjs';

export default {
	name: '文脈ツリーが未開始の案内を出す',
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		await expandPane(page, labels('view.nimbus.context')[0]);

		const sidebar = await sidebarText(page);
		ctx.expect(
			includesAny(sidebar, labels('view.nimbus.context')),
			`サイドバーに 文脈 のビューが無い:\n${sidebar.slice(0, 400)}`
		);
		ctx.expect(
			sidebar.includes('セッションを開始すると'),
			`文脈ツリーに未開始の案内が出ていない（空のまま黙っている）:\n${sidebar.slice(0, 600)}`
		);
		await ctx.shot('context-tree');
	}
};
