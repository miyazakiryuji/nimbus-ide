/** Nimbus のビューが揃っているか（コックピット / タスク / スキル / 文脈） */
import { openNimbusSidebar, sidebarText } from '../helpers.mjs';

export default {
	name: 'Nimbus のビューが揃っている',
	async run(page, ctx) {
		// アイコンはトグルなので、押すのではなく「開いている状態にする」（helpers.mjs 参照）
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');

		const sidebar = await sidebarText(page);
		for (const name of ['コックピット', 'タスク', 'スキル', '文脈']) {
			ctx.expect(sidebar.includes(name), `サイドバーに「${name}」が無い:\n${sidebar.slice(0, 300)}`);
		}
		await ctx.shot('views');
	}
};
