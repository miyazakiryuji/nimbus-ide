/** Nimbus のビューが揃っているか（コックピット / タスク / スキル / 文脈） */
import { includesAny, labels, openNimbusSidebar, sidebarText } from '../helpers.mjs';

export default {
	name: 'Nimbus のビューが揃っている',
	async run(page, ctx) {
		// アイコンはトグルなので、押すのではなく「開いている状態にする」（helpers.mjs 参照）
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');

		const sidebar = await sidebarText(page);
		// ビュー名は翻訳される（T-091）。キーで書き、候補は package.nls*.json から引く
		for (const key of ['view.nimbus.cockpit', 'view.nimbus.board', 'view.nimbus.skills', 'view.nimbus.context']) {
			ctx.expect(
				includesAny(sidebar, labels(key)),
				`サイドバーに ${key}（${labels(key).join(' / ')}）が無い:\n${sidebar.slice(0, 300)}`
			);
		}
		await ctx.shot('views');
	}
};
