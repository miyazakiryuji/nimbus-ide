/**
 * レビューの進み具合（T-160）。
 *
 * ビューが出て、コマンドがパレットから引けることを見る。
 * 「印を付けたら残る」ところは実際に変更のあるリポジトリが要るので、
 * ここでは入口の確認までにする（使い捨てワークスペースには git の変更が無い）。
 */
import { openNimbusSidebar, searchCommands, sidebarText } from '../helpers.mjs';

export default {
	name: 'レビュービューと印のコマンドがある',
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');

		const sidebar = await sidebarText(page);
		ctx.expect(sidebar.includes('レビュー'), `サイドバーに「レビュー」が無い:\n${sidebar.slice(0, 400)}`);

		const found = await searchCommands(page, 'Nimbus: レビュー');
		ctx.expect(
			found.includes('レビュー済みにする'),
			`コマンドパレットに「レビュー済みにする」が無い:\n${found.slice(0, 400)}`
		);
		await ctx.shot('review');
	}
};
