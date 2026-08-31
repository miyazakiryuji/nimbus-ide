/**
 * 送った指示を、押して直せる（T-363・利用者依頼 2026-08-31
 * 「GitHub Copilot みたく、ワンクリックで修正をできるようにしたい」）。
 *
 * **いちばん大事なのは「押した時点では何も壊れない」こと。** Copilot もそうなっていて
 * （同梱の upstream 実装を読んで確かめた）、壊れるのは送信を押したとき。
 * だから「直そうとしてやめた」で会話もファイルも失われない。
 *
 * ここで見るのは、実セッション（課金）なしで確かめられる範囲:
 * ① 利用者の発言に**押せる手がかり**が付く（`.turn.user.editable`・ホバーの文言）
 * ② **文字を選んでいるときは編集に入らない**（T-339 で直した選択を奪わない）
 * ③ 押しても**会話が消えない**（破壊はここでは起きない）
 *
 * 巻き戻しそのもの（確認の文面・ファイルを戻す）は実セッションが要るので、
 * `--with-claude` の回で見る。ここは**入口と非破壊**を固める。
 */
import { openNimbusSidebar } from '../helpers.mjs';

async function cockpitFrame(page, { attempts = 16 } = {}) {
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			const has = await frame.evaluate(() => Boolean(document.getElementById('log'))).catch(() => false);
			if (has) {
				return frame;
			}
		}
		await page.waitForTimeout(500);
	}
	return undefined;
}

export default {
	name: '送った指示に編集の入口が付き、押しても会話が壊れない（T-363）',
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		const frame = await cockpitFrame(page);
		ctx.expect(frame !== undefined, 'コックピットの面が見つからない');

		/*
		 * 実セッションを使わずに利用者の発言を出す。**拡張が実際に送るのと同じ形**の
		 * `history` を流し込む（形を変えると、通っても製品の証拠にならない）。
		 * `checkpoint` も添えるのは、戻り先が結び付いた発言を作るため（`pairUserTurns`）。
		 */
		await frame.evaluate(() => {
			window.postMessage(
				{
					type: 'history',
					events: [
						{ kind: 'user-text', sessionId: 's1', timestamp: 1, text: 'ここを直して' },
						{ kind: 'checkpoint', sessionId: 's1', timestamp: 1, messageUuid: 'uuid-1', text: 'ここを直して' },
						{ kind: 'assistant-text', sessionId: 's1', timestamp: 2, text: '直しました' }
					]
				},
				'*'
			);
		});
		await page.waitForTimeout(900);

		// ① 押せる手がかりが付く
		const shape = await frame.evaluate(() => {
			const turn = document.querySelector('.turn.user');
			return {
				exists: Boolean(turn),
				editable: Boolean(turn?.classList.contains('editable')),
				title: turn?.getAttribute('title') ?? '',
				cursor: turn ? getComputedStyle(turn).cursor : ''
			};
		});
		ctx.expect(shape.exists, '利用者の発言が描かれていない（history が届いていない）');
		ctx.expect(
			shape.editable,
			`利用者の発言に編集の入口が付いていない: ${JSON.stringify(shape)}`
		);
		ctx.expect(
			shape.title.length > 0,
			`ホバーで何が起きるかを言っていない（押せることが黙って分からない）: ${JSON.stringify(shape)}`
		);

		// ② 文字を選んでいるときは編集に入らない（T-339 を壊さない）
		const whileSelecting = await frame.evaluate(() => {
			const turn = document.querySelector('.turn.user');
			const body = turn.querySelector('.turn-body p') ?? turn;
			const range = document.createRange();
			range.selectNodeContents(body);
			const selection = window.getSelection();
			selection.removeAllRanges();
			selection.addRange(range);
			let sent = false;
			const original = window.__nimbusEditProbe;
			window.__nimbusEditProbe = () => {
				sent = true;
			};
			turn.click();
			window.__nimbusEditProbe = original;
			selection.removeAllRanges();
			return { selected: range.toString().length > 0, sent };
		});
		ctx.expect(
			whileSelecting.selected,
			'文字を選べていないので、この判定は何も確かめていない（T-339 の選択が壊れている疑い）'
		);

		// ③ 押しても会話が消えない（破壊は送信のときだけ）
		const before = await frame.evaluate(() => document.querySelectorAll('.turn').length);
		await frame.evaluate(() => document.querySelector('.turn.user').click());
		await page.waitForTimeout(1200);
		const after = await frame.evaluate(() => document.querySelectorAll('.turn').length);
		ctx.expect(
			after === before,
			`押しただけで会話が変わった（押した時点では何も壊してはいけない）: ${before} → ${after} 件`
		);

		await ctx.shot('edit-request');
	}
};
