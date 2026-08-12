/**
 * レビューの進み具合（T-160）。
 *
 * ビューが出て、コマンドがパレットから引けることを見る。
 * 「印を付けたら残る」ところは実際に変更のあるリポジトリが要るので、
 * ここでは入口の確認までにする（使い捨てワークスペースには git の変更が無い）。
 */
import { includesAny, labels, openNimbusSidebar, searchCommands, sidebarText } from '../helpers.mjs';

export default {
	name: 'レビュービューと印のコマンドがある',
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');

		const sidebar = await sidebarText(page);
		const view = labels('view.nimbus.review');
		ctx.expect(includesAny(sidebar, view), `サイドバーに ${view.join(' / ')} が無い:\n${sidebar.slice(0, 400)}`);

		const mark = labels('command.markReviewed');
		const found = await searchCommands(page, mark[0]);
		ctx.expect(includesAny(found, mark), `コマンドパレットに ${mark.join(' / ')} が無い:\n${found.slice(0, 400)}`);
		await ctx.shot('review');
	}
};
