/**
 * 使い始めの「準備」がコックピットに出る（T-285）。
 *
 * **実際に利用者が Claude Code の繋ぎかたで迷った**。それまでの案内は
 * *送ろうとして初めて*トーストで出て、中身は「設定 `nimbus.claudeCodeExecutable` に
 * パスを指定してください」── 設定名を告げるだけで、その場では直せなかった。
 * ここはその再発を止める番人。
 *
 * 信頼していないフォルダは、**確実に「準備が足りない」状態を作れる**数少ない経路なので
 * それを使う（Claude Code の有無は実行環境によって変わるので、テストの前提にできない）。
 * このケースだけ `--disable-workspace-trust` を渡さずに起動する（`untrusted: true`）。
 *
 *   node nimbus/tests/gui/run.mjs --untrusted
 */
import { feedbackText, openNimbusSidebar, runCommand, webviewText } from '../helpers.mjs';

/** コックピットの webview フレームを掴む */
async function cockpitFrame(page, { attempts = 20 } = {}) {
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			try {
				if (await frame.$('#composer')) {
					return frame;
				}
			} catch {
				// フレームが入れ替わっている最中。次で拾う
			}
		}
		await page.waitForTimeout(500);
	}
	return undefined;
}

export default {
	name: '足りない準備が、詰まる場所（コックピット）に出て、押せば直せる',
	untrusted: true,
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');

		// 1. 送る前に、足りないものが会話の面に出ている
		const text = await webviewText(page, ['使い始める前に'], { attempts: 20 });
		ctx.expect(
			Boolean(text),
			'コックピットに「使い始める前に」が出ない（送ろうとするまで気づけない状態のままかもしれない）'
		);
		ctx.expect(text.includes('信頼'), `足りない項目（信頼）が出ていない:\n${text.slice(0, 400)}`);

		const frame = await cockpitFrame(page);
		ctx.expect(frame !== undefined, 'コックピットの入力欄まわり（#composer）が見つからない');

		// 2. 「あと何件か」を数字で出している（残りが分からないと、どこまでやればよいか決められない）
		const lead = await frame.$eval('.readiness p', (el) => el.textContent ?? '').catch(() => '');
		ctx.expect(/あと \d+ 件/.test(lead), `残り件数が出ていない: "${lead}"`);

		// 3. ボタンは**押せば直る**ものになっている（見えているだけにしない・T-244）
		const actions = await frame.$$eval('.readiness-action', (nodes) =>
			nodes.map((node) => node.textContent ?? '')
		);
		ctx.expect(
			actions.some((label) => label.includes('信頼')),
			`信頼を直すボタンが無い: ${JSON.stringify(actions)}`
		);

		// 4. 名前で引く経路も答える（場所と名前の両方から辿り着ける・人間工学 E4）
		await runCommand(page, '準備をもう一度さがす');
		const answer = await feedbackText(page);
		ctx.expect(
			answer.includes('準備'),
			`「準備をもう一度さがす」が何も答えない:\n${answer.slice(0, 300)}`
		);

		// 5. 実際に押して、画面が応える（信頼の面が開く）
		const before = await page.evaluate(() => document.querySelectorAll('.editor-instance').length);
		const button = await frame.$('.readiness-action');
		await button.click();
		await page.waitForTimeout(2500);
		const after = await page.evaluate(() => document.querySelectorAll('.editor-instance').length);
		ctx.expect(after > before, `準備のボタンを押しても何も開かない（before=${before} after=${after}）`);

		await ctx.shot('setup-readiness');
	}
};
