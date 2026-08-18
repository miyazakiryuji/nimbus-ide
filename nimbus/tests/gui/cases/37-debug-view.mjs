/**
 * デバッグ面（T-249）。アクティビティバーの独立した入口。
 *
 * **存在確認で止めない。** 行やコマンドが「在る」ことだけを見ると、
 * 押しても何も起きないものを本物として通す（実際に設定タブがその状態だった・T-244）。
 * ここでは、アイコンを**実際に押して**面が出るところと、
 * コマンドを**実際に走らせて**答えが返るところまでを見る。
 *
 * 失敗やツール呼び出しが**並んだ状態**は実セッションが要るので、そこは 07（`--with-claude`）の担当。
 * このケースでは「まだ無い」と答えることを確かめる — 黙って何も起きないのと、
 * 無いと答えるのは別物なので。
 */
import { closeAllEditors, feedbackText, labels, openNimbusDebugSidebar, runCommand, sidebarText } from '../helpers.mjs';

export default {
	name: 'デバッグ面がアクティビティバーから開き、コマンドが答えを返す',
	async run(page, ctx) {
		await closeAllEditors(page);

		// 1. アクティビティバーのアイコンを実際に押して、面が出る
		const opened = await openNimbusDebugSidebar(page);
		const seen = await page.evaluate(() => ({
			title: document.querySelector('.part.sidebar .title-label')?.innerText ?? '(なし)',
			sidebar: (document.querySelector('.part.sidebar')?.innerText ?? '').slice(0, 200),
			icons: [...document.querySelectorAll('.activitybar [aria-label]')].map((el) => el.getAttribute('aria-label'))
		}));
		ctx.expect(opened, `Nimbus デバッグのサイドバーを開けない: ${JSON.stringify(seen, null, 1)}`);

		const sidebar = await sidebarText(page);
		const view = labels('view.nimbus.debug');
		ctx.expect(
			view.some((name) => sidebar.includes(name)) || sidebar.includes('セッションが動き出すと'),
			`デバッグ面に ${view.join(' / ')} が無い:\n${sidebar.slice(0, 400)}`
		);

		// 2. 更新を押しても壊れない（ビューが消えない）
		await runCommand(page, 'デバッグを更新');
		ctx.expect((await sidebarText(page)).length > 0, 'デバッグを更新したらサイドバーが空になった');

		// 3. コマンドを実際に走らせて、答えが返る
		await runCommand(page, '失敗の中身を開く');
		const failureAnswer = await feedbackText(page);
		ctx.expect(
			failureAnswer.includes('失敗はありません'),
			`「失敗の中身を開く」が何も答えない:\n${failureAnswer.slice(0, 300)}`
		);

		await runCommand(page, 'ツール呼び出しの中身を開く');
		const callAnswer = await feedbackText(page);
		ctx.expect(
			callAnswer.includes('ツール呼び出しがありません'),
			`「ツール呼び出しの中身を開く」が何も答えない:\n${callAnswer.slice(0, 300)}`
		);

		await ctx.shot('nimbus-debug');
	}
};
