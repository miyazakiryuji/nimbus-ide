/**
 * 承認まわりの画面（f3-f6.md §6 の 1 つめ・T-004）。
 *
 * 実セッションを走らせずに承認モーダルを出すことはできないので、ここで確かめるのは
 * **承認を受け止める側が残っていること** — 承認まわりのコマンドが登録されていること。
 * モーダルと差分が並ぶ様子そのものは `--with-claude` の 07 の経路で見る。
 *
 * 承認待ち「ビュー」は UI から外した（T-267）。会話の中で受ける形に作り替える（T-266）ので、
 * ここでビューの存在を確かめるのはやめた。仕組みが生きていることはコマンドで見る。
 */
import { includesAny, labels, searchCommands } from '../helpers.mjs';

export default {
	name: '承認まわりのコマンドが揃っている',
	async run(page, ctx) {
		const denyAll = labels('command.approvals.denyAll');
		const found = await searchCommands(page, denyAll[0]);
		ctx.expect(
			includesAny(found, denyAll),
			`コマンドパレットに ${denyAll.join(' / ')} が無い:\n${found.slice(0, 400)}`
		);
		await ctx.shot('approvals');
	}
};
