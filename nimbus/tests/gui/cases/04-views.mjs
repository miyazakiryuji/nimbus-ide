/** 常用サイドバーの段が揃っていて、外に出した 3 本が戻っていないか */
import { includesAny, labels, openNimbusSidebar, sidebarText } from '../helpers.mjs';

export default {
	name: 'Nimbus のビューが揃っている',
	async run(page, ctx) {
		// アイコンはトグルなので、押すのではなく「開いている状態にする」（helpers.mjs 参照）
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');

		const sidebar = await sidebarText(page);
		// ビュー名は翻訳される（T-091）。キーで書き、候補は package.nls*.json から引く
		// 常用サイドバーに残すのは会話だけ。板は専用アイコン（T-256）、
		// 承認待ち・レビュー・文脈は UI から外し（T-267）、ヘルプは設定側へ（T-265）
		for (const key of ['view.nimbus.cockpit']) {
			ctx.expect(
				includesAny(sidebar, labels(key)),
				`サイドバーに ${key}（${labels(key).join(' / ')}）が無い:\n${sidebar.slice(0, 300)}`
			);
		}

		// 外へ出したものが段として戻っていないこと。
		// 見るのは**見出しだけ**。文脈ビューは中身に CLAUDE.md を並べるので、
		// サイドバー全体の文字列で見ると必ず当たってしまう
		const headers = await page.evaluate(() =>
			[...document.querySelectorAll('.part.sidebar .pane-header')].map((el) => el.innerText ?? '')
		);
		// 見出しが 1 つも取れないと、下の確認が素通りしてしまう
		ctx.expect(headers.length > 0, 'サイドバーの見出しが 1 つも取れない（セレクタが変わった可能性）');
		for (const key of [
			'view.nimbus.skills', 'view.nimbus.claudeMd', 'view.nimbus.settings',
			'view.nimbus.board', 'view.nimbus.review', 'view.nimbus.context', 'view.nimbus.help',
			'view.nimbus.approvals'
		]) {
			ctx.expect(
				!headers.some((header) => includesAny(header, labels(key))),
				`常用サイドバーに ${key}（${labels(key).join(' / ')}）が段として戻っている:\n${headers.join(' / ')}`
			);
		}
		await ctx.shot('views');
	}
};
