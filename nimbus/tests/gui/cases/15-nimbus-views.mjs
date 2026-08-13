/**
 * 診断系のビューは下部パネル「Nimbus 診断」にまとめてある（T-239）。
 * サイドバーに 13 段並べると、どれも見なくなるため。
 */
import { openHiddenView, panelText } from '../helpers.mjs';

export default {
	name: 'セッションの中身・使用量・MCP が診断パネルに並んでいる',
	async run(page, ctx) {
		await openHiddenView(page, '診断パネルを開く');
		const panel = await panelText(page);
		for (const name of ['セッションの中身', '使用量', 'MCP サーバー']) {
			ctx.expect(panel.includes(name), `診断パネルに「${name}」が無い:\n${panel.slice(0, 400)}`);
		}
		await ctx.shot('nimbus-diagnostics');
	}
};
