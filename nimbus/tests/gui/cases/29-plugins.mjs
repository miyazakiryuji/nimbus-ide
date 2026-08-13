/**
 * プラグインの一覧が、実際の `~/.claude` を読んで出るか。
 *
 * 仕様側の「画面確認（未実施）」を閉じる: [plugins](../../../docs/specs/plugins.md)。
 *
 * **実セッション（課金）は要らない。** 読むだけで、`claude plugin` は走らせない
 * （走らせると実際に有効／無効が変わってしまう）。
 *
 * ## ここで名前を確かめない
 *
 * 一覧に出るのは**利用者が実際に入れているプラグイン**なので、
 * 名前を期待値に書くと、そのまま個人の環境が公開リポジトリに残る。
 * **形（一覧が出ること・入れる導線があること）だけ**を見る。
 */
import { closeAllEditors, labels, runCommand } from '../helpers.mjs';

export default {
	name: 'プラグインの一覧が出て、入れる導線がある',
	async run(page, ctx) {
		await closeAllEditors(page);

		await runCommand(page, labels('command.managePlugins')[0]);

		let picker = '';
		for (let i = 0; i < 10; i++) {
			await page.waitForTimeout(700);
			picker = await page.evaluate(() => document.querySelector('.quick-input-widget')?.innerText ?? '');
			if (picker.includes('プラグイン') || picker.includes('読めませんでした')) {
				break;
			}
		}

		// `~/.claude` が無い環境では、そう言って終わるのが仕様どおり
		if (picker.includes('読めませんでした')) {
			ctx.expect(true, '');
			await ctx.shot('plugins-none');
			return;
		}

		ctx.expect(
			picker.includes('プラグイン'),
			`プラグインの一覧が出ない（実際: ${picker.slice(0, 160).replace(/\n/g, ' ')}）`
		);
		// 入れるのは別導線。切り替えたいものが目録に埋もれないための分け方。
		// **先頭に無いと、入っているものが多いときに画面の下へ隠れる**（この確認で分かった）
		ctx.expect(picker.includes('入れる'), '「入れる…」の導線が出ていない（下に隠れていないか）');
		// 状態が読めること（どれか 1 つは出ているはず）
		ctx.expect(
			['有効', '無効', '未取得', '設定だけ残っている'].some((state) => picker.includes(state)),
			`状態が出ていない（実際: ${picker.slice(0, 160).replace(/\n/g, ' ')}）`
		);

		await ctx.shot('plugins');
		// 何も変えずに閉じる
		await page.keyboard.press('Escape');
	}
};
