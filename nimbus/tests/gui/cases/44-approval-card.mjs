/**
 * 承認を会話の中で受ける（T-266）の通し確認。
 *
 * **実セッションが要る**（承認は本物のツール呼び出しからしか起きない）ので、
 * `--with-claude` のときだけ走る。指定が無ければ何もしない。
 *
 * 見るのは「カードが出る」ことと「押したら消える（＝答えが届いている）」こと。
 * カードが出るだけで押せないなら、モーダルの置き換えになっていない。
 */
import { webviewText } from '../helpers.mjs';

/** コックピットの入力欄へ打ち込んで送る */
async function sendFromCockpit(page, text) {
	for (const frame of page.frames()) {
		const input = await frame.$('#input, textarea');
		if (!input) {
			continue;
		}
		await input.click();
		await input.type(text, { delay: 10 });
		await page.keyboard.press('Enter');
		return true;
	}
	return false;
}

export default {
	name: '承認が会話の中にカードで出て、その場で答えられる（--with-claude）',
	async run(page, ctx) {
		if (!ctx.withClaude) {
			return; // 指定が無ければ何もしない（成功扱い）
		}
		await page.waitForTimeout(2000);
		// **書き込みを頼む。** `echo` のような無害なコマンドは Claude Code 側が安全と判断して
		// 承認を求めないので、承認そのものが起きない（実測でこれに嵌まった）
		ctx.expect(
			await sendFromCockpit(page, 'Create a file named approval-test.txt with the text hello. Use the Write tool.'),
			'コックピットの入力欄が見つからない'
		);

		const card = await webviewText(page, ['実行してよいか待っています'], { attempts: 60 });
		ctx.expect(card !== undefined, '承認のカードが会話の中に出てこない（モーダルのままかもしれない）');
		ctx.expect(card.includes('許可'), `カードに答えるボタンが無い:\n${card.slice(0, 300)}`);
		await ctx.shot('approval-card');

		// 押したら消えるところまで見る。出るだけで押せないなら置き換えになっていない
		for (const frame of page.frames()) {
			const buttons = await frame.$$('.approval-actions button');
			if (buttons.length === 0) {
				continue;
			}
			await buttons[buttons.length - 1].click(); // いちばん右＝拒否（副作用を残さない）
			break;
		}
		await page.waitForTimeout(2000);
		const after = await webviewText(page, ['Nimbus'], { attempts: 3 });
		ctx.expect(
			after === undefined || !after.includes('実行してよいか待っています'),
			'答えたのにカードが残っている'
		);
	}
};
