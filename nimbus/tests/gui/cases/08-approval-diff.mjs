/**
 * 承認まわりの画面（f3-f6.md §6 の 1 つめ）。
 *
 * 実セッションを走らせずに承認モーダルを出すことはできないので、ここで確かめるのは
 * **承認を受け止める側が揃っていること** — 承認待ちビューが存在し、承認まわりのコマンドが
 * 登録されていること。モーダルと差分が並ぶ様子そのものは `--with-claude` の 07 の経路で見る。
 */
import { includesAny, labels, openNimbusSidebar, searchCommands, sidebarText } from '../helpers.mjs';

export default {
	name: '承認待ちビューと承認コマンドが揃っている',
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');

		const sidebar = await sidebarText(page);
		const view = labels('view.nimbus.approvals');
		ctx.expect(includesAny(sidebar, view), `サイドバーに ${view.join(' / ')} が無い:\n${sidebar.slice(0, 400)}`);

		const denyAll = labels('command.approvals.denyAll');
		const found = await searchCommands(page, denyAll[0]);
		ctx.expect(
			includesAny(found, denyAll),
			`コマンドパレットに ${denyAll.join(' / ')} が無い:\n${found.slice(0, 400)}`
		);
		await ctx.shot('approvals');
	}
};
