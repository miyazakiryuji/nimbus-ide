/**
 * コックピットとタスク板をエディタタブで開く（T-258）の通し確認。
 *
 * 「コマンドが引ける」ではなく、**タブが開いて中身が描かれるところ**まで見る。
 * サイドバーと同時に開いても食い違わないことが要なので、
 * タブを開いたあとにサイドバー側の面がまだ生きていることも確かめる。
 */
import { labels, runCommand, webviewText } from '../helpers.mjs';

async function tabTitles(page) {
	return page.evaluate(() =>
		[...document.querySelectorAll('.tabs-container .tab')].map((el) => el.innerText ?? '').join(' | ')
	);
}

export default {
	name: 'コックピットとタスク板がエディタタブで開く',
	async run(page, ctx) {
		await runCommand(page, labels('command.openCockpitTab')[0]);
		await page.waitForTimeout(2500);
		const afterCockpit = await tabTitles(page);
		ctx.expect(
			afterCockpit.includes('コックピット') || afterCockpit.includes('Cockpit'),
			`コックピットのタブが開いていない（タブ: ${afterCockpit}）`
		);

		await runCommand(page, labels('command.openBoardTab')[0]);
		await page.waitForTimeout(2500);
		const afterBoard = await tabTitles(page);
		ctx.expect(
			afterBoard.includes('タスク') || afterBoard.includes('Task'),
			`タスク板のタブが開いていない（タブ: ${afterBoard}）`
		);

		// タブの中身が実際に描かれているか（空のタブが開いただけ、を通さない）
		const board = await webviewText(page, ['新しいタスク'], { attempts: 8 });
		ctx.expect(board !== undefined, 'タブに板の中身が描かれていない');
		await ctx.shot('editor-tabs');

		// 開いたタブは次のケースの邪魔になるので閉じておく。
		//
		// **キーボードでは閉じない。** 和音（Cmd+K W）は待ち状態が残るし、
		// `closeAllEditors` はテキストエディタしか数えないので webview のタブには効かない。
		// さらに、webview に焦点が残ったままだと次のケースのコマンドパレットが開かず、
		// 打った文字が webview の入力欄へ流れ込む（実測でこれに嵌まった）。
		// **タブの ✕ を実際に押す**のがいちばん確実
		for (let i = 0; i < 6; i++) {
			const closers = await page.$$('.tabs-container .tab .codicon-close, .tabs-container .tab .tab-close');
			if (closers.length === 0) {
				break;
			}
			await closers[0].click();
			await page.waitForTimeout(500);
		}
		// 焦点を webview の外へ戻す（次のケースがキーボードで操作できるように）
		await page.click('.part.activitybar');
		await page.waitForTimeout(500);
	}
};
