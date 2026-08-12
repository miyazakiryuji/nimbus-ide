/**
 * 承認まわりの画面（f3-f6.md §6 の 1 つめ）。
 *
 * 実セッションを走らせずに承認モーダルを出すことはできないので、ここで確かめるのは
 * **承認を受け止める側が揃っていること** — 承認待ちビューが存在し、承認まわりのコマンドが
 * 登録されていること。モーダルと差分が並ぶ様子そのものは `--with-claude` の 07 の経路で見る。
 */
import { openNimbusSidebar, searchCommands, sidebarText } from '../helpers.mjs';

export default {
	name: '承認待ちビューと承認コマンドが揃っている',
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');

		const sidebar = await sidebarText(page);
		ctx.expect(sidebar.includes('承認待ち'), `サイドバーに「承認待ち」が無い:\n${sidebar.slice(0, 400)}`);

		const found = await searchCommands(page, 'Nimbus: 承認待ち');
		ctx.expect(
			found.includes('すべて拒否'),
			`コマンドパレットに「承認待ちをすべて拒否」が無い:\n${found.slice(0, 400)}`
		);
		await ctx.shot('approvals');
	}
};
