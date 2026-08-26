/**
 * 待ち時間コンパス（T-336）。
 *
 * コックピットのタイトルに入口（コンパスのアイコン）が出て、押すと
 * 「いまのようす」が開き、**頭にコンパスの判定**が出るところまで押して確かめる。
 * 何も走っていない起動直後なので、判定は「人の番」（指示を出す番）になるはず。
 * ついでに rhythm.md の受け入れ条件「画面確認（コマンドから開く）」もここで拾う。
 */

/** コックピットのタイトルのボタンを名前で押す */
async function pressTitleAction(page, needle) {
	return page.evaluate((name) => {
		const found = [
			...document.querySelectorAll(
				'.part.sidebar .composite.title .actions-container a, .part.sidebar .composite.title .action-label'
			)
		].find((el) =>
			`${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`.includes(name)
		);
		if (!found) {
			return false;
		}
		found.click();
		return true;
	}, needle);
}

export default {
	name: 'コンパスの入口がタイトルに出て、押すと判定つきの「いまのようす」が開く（T-336）',
	async run(page, ctx) {
		await page.keyboard.press('Escape');
		await page.waitForTimeout(600);

		ctx.expect(
			await pressTitleAction(page, 'いまのようすを見る'),
			'コックピットのタイトルに「いまのようすを見る」（コンパス）が無い'
		);

		// markdown の下書きがエディタに開く。短い文書なので全行が描画される
		let text = '';
		for (let i = 0; i < 12; i++) {
			await page.waitForTimeout(500);
			text = await page.evaluate(
				() => document.querySelector('.part.editor')?.innerText ?? ''
			);
			if (text.includes('コンパス')) {
				break;
			}
		}
		ctx.expect(text.includes('いまのようす'), `「いまのようす」が開かない:\n${text.slice(0, 300)}`);
		ctx.expect(text.includes('コンパス:'), `頭にコンパスの判定が出ていない:\n${text.slice(0, 300)}`);
		// 起動直後（走行 0・承認待ち 0・失敗 0）なので、指示を出す番
		ctx.expect(
			text.includes('人の番'),
			`何も走っていないのに判定が「人の番」でない:\n${text.slice(0, 300)}`
		);
		ctx.expect(text.includes('失敗:'), '失敗の数が「いまのようす」に出ていない');
		await ctx.shot('60-waiting-compass');
	}
};
