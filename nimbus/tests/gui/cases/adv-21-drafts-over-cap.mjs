/**
 * 敵対的試験（T-379 / adv-21）— 下書きが上限を超えていたら、黙って捨てずに数を言う。
 *
 * ## 何を疑っているか（観点: 量 — 上限そのものの件数）
 *
 * 下書きの復元には上限 `MAX_RESTORED_DRAFTS = 20` がある（`extension.ts`）。コードのコメントは
 * 「あふれたぶんは**黙って捨てずに数を言う**」と宣言しているが、実装は `sound.slice(-20)` で
 * **黙って切っている**。T-364（「会話だけが戻ります」と言いながら戻していなかった）と同じ
 * 「コメントが嘘をつく」形。捨てられるのは古い 5 本で、番号（名札・T-316）も一緒に消える —
 * 利用者から見れば「開いたらタブが減っていた」であり、T-368 の再発と区別が付かない。
 *
 * ## 期待する振る舞い
 *
 * 25 本あったなら、25 本戻るか、**20 本に畳んだことと捨てた本数を言う**（コメントの宣言どおり）。
 * 黙って 20 本だけ出すのは不可。
 *
 * ## 手順の要点
 *
 * コマンドパレットは 1 回 4 秒かかるので、列が出たあとは `+`（`.session-tab-add`）を直接押す。
 * 関門: 閉じる前に 25 本あること。
 */
import { notificationText, openNimbusSidebar, runCommand } from '../helpers.mjs';

const CAP = 20;
const WANT = 25;

async function cockpit(page, { attempts = 30 } = {}) {
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			try {
				if (await frame.$('#sessionTabs')) {
					return frame;
				}
			} catch {
				// フレームが入れ替わっている最中
			}
		}
		await page.waitForTimeout(500);
	}
	return undefined;
}

const tabCount = (frame) => frame.evaluate(() => document.querySelectorAll('.session-tab').length);

export default {
	name: '下書きが上限を超えていたら、黙って捨てずに数を言う',
	adversarial: true,
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		await runCommand(page, '新しいセッション');
		await runCommand(page, '新しいセッション');
		let frame = await cockpit(page);
		ctx.expect(frame !== undefined, 'コックピットのタブ列が見つからない');
		for (let i = 0; i < 40 && (await tabCount(frame)) < WANT; i++) {
			await frame.click('.session-tab-add').catch(() => undefined);
			await page.waitForTimeout(250);
		}
		await page.waitForTimeout(800);
		const before = await tabCount(frame);
		ctx.expect(before === WANT, `下書きを ${WANT} 本作れなかった（${before} 本）。この先は何も確かめていない`);

		const reopened = await ctx.restart();
		const notice = await notificationText(reopened);
		ctx.expect(await openNimbusSidebar(reopened), '開き直したあと Nimbus のサイドバーを開けない');
		frame = await cockpit(reopened);
		ctx.expect(frame !== undefined, '開き直したあとタブ列が見つからない');
		let after = 0;
		for (let i = 0; i < 10; i++) {
			after = await tabCount(frame);
			if (after >= CAP) {
				break;
			}
			await reopened.waitForTimeout(500);
		}
		const dropped = WANT - after;
		// 「25 件」にも「5 件」が含まれるので、捨てた側の言い回しで探す
		const said = notice.includes(`古い ${dropped} 件`) && /下書き/.test(notice);
		ctx.expect(
			after === WANT || (after === CAP && said),
			`下書き ${WANT} 本が ${after} 本になり、${dropped} 本を捨てたことを${said ? '言った' : '言っていない'}。通知:\n${notice.slice(0, 400)}`
		);
		await ctx.shot('adv-21-drafts-over-cap');
	}
};
