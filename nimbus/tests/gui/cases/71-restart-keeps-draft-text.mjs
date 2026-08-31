/**
 * **打ちかけの本文が、閉じて開き直しても残る**（T-376）。
 *
 * 下書きの「タブ」は残るようになった（T-368・ケース 69）が、**入力欄に打った文字**は
 * どこにも保存されていなかった（Codex の棚卸し A-6）。長い指示を書いている途中で
 * アプリを閉じると、それだけで消えて打ち直すしかない。
 * 「下書きタブ」と「入力欄の下書き」は別物なので、守りも別に要る。
 *
 * **送ったら消える**ところまで見る。残ると、次に開いたとき同じ文が二重に見える。
 */
import { openNimbusSidebar } from '../helpers.mjs';

async function cockpitFrame(page, { attempts = 30 } = {}) {
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			try {
				if (await frame.$('#input')) {
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

const TYPED = 'ここまで書いたところで閉じてしまった長い指示';

export default {
	name: '打ちかけの本文は、閉じて開き直しても残る（T-376）',
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		let frame = await cockpitFrame(page);
		ctx.expect(frame !== undefined, 'コックピットの入力欄が見つからない');

		/*
		 * **押して打つ**（値を代入するだけだと `input` イベントが出ず、
		 * 保存の配線を通らないまま緑になる）。
		 */
		await frame.click('#input');
		await page.keyboard.type(TYPED, { delay: 8 });
		await page.waitForTimeout(600);
		ctx.expect(
			(await frame.$eval('#input', (el) => el.value)) === TYPED,
			'打った文が入力欄に入っていない（この先の判定が何も確かめていない）'
		);

		// 閉じて開き直す
		const reopened = await ctx.restart();
		ctx.expect(await openNimbusSidebar(reopened), '開き直したあと Nimbus のサイドバーを開けない');
		frame = await cockpitFrame(reopened);
		ctx.expect(frame !== undefined, '開き直したあとコックピットの入力欄が見つからない');

		const restored = await frame.$eval('#input', (el) => el.value);
		ctx.expect(
			restored === TYPED,
			`打ちかけの本文が戻らない（閉じただけで消えた）: 「${restored}」`
		);

		await ctx.shot('restart-keeps-draft-text');
	}
};
