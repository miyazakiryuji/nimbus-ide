/** 常用サイドバーの段が揃っていて、外に出した 3 本が戻っていないか */
import { includesAny, labels, openNimbusSidebar, sidebarText } from '../helpers.mjs';

export default {
	name: 'Nimbus のビューが揃っている',
	async run(page, ctx) {
		// アイコンはトグルなので、押すのではなく「開いている状態にする」（helpers.mjs 参照）
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');

		const sidebar = await sidebarText(page);
		// ビュー名は翻訳される（T-091）。キーで書き、候補は package.nls*.json から引く
		// 既定で出すのは常用の 5 段だけ（T-239）
		for (const key of ['view.nimbus.cockpit', 'view.nimbus.board', 'view.nimbus.approvals', 'view.nimbus.review', 'view.nimbus.context']) {
			ctx.expect(
				includesAny(sidebar, labels(key)),
				`サイドバーに ${key}（${labels(key).join(' / ')}）が無い:\n${sidebar.slice(0, 300)}`
			);
		}

		// スキル / CLAUDE.md / 設定 は「Nimbus 設定」へ出した（T-243）。段として戻っていないこと。
		// 見るのは**見出しだけ**。文脈ビューは中身に CLAUDE.md を並べるので、
		// サイドバー全体の文字列で見ると必ず当たってしまう
		const headers = await page.evaluate(() =>
			[...document.querySelectorAll('.part.sidebar .pane-header')].map((el) => el.innerText ?? '')
		);
		// 見出しが 1 つも取れないと、下の確認が素通りしてしまう
		ctx.expect(headers.length > 0, 'サイドバーの見出しが 1 つも取れない（セレクタが変わった可能性）');
		for (const key of ['view.nimbus.skills', 'view.nimbus.claudeMd', 'view.nimbus.settings']) {
			ctx.expect(
				!headers.some((header) => includesAny(header, labels(key))),
				`常用サイドバーに ${key}（${labels(key).join(' / ')}）が段として戻っている:\n${headers.join(' / ')}`
			);
		}
		await ctx.shot('views');
	}
};
