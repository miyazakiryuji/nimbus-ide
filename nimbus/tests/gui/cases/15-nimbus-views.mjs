/**
 * 私が足したビューが実際に並んでいるか（T-018 / T-022 / T-023 / T-024 / T-027 /
 * T-029 / T-037 / T-042 / T-192）。
 *
 * ビューの登録漏れは、コンパイルもテストも通ってしまう。画面で見るしかない。
 */
import { openNimbusSidebar, sidebarText } from '../helpers.mjs';

export default {
	name: 'セッションの中身・使用量・MCP のビューが並んでいる',
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');

		const sidebar = await sidebarText(page);
		for (const name of ['セッションの中身', '使用量', 'MCP サーバー']) {
			ctx.expect(sidebar.includes(name), `サイドバーに「${name}」が無い:\n${sidebar.slice(0, 400)}`);
		}
		await ctx.shot('nimbus-views');
	}
};
