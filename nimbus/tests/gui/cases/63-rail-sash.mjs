/**
 * セッションの列と会話の**境目をドラッグで動かせる**（T-342・利用者依頼 2026-08-29）。
 *
 * 既定の分け前が誰にとっても正しいことはないので、掴んで決められるようにした。
 * **本物のマウスで引いて測る** — 掴み代が「在る」ことと「動く」ことは別。
 * 4px の帯は当たり判定を外しやすく、CSS や DOM の確認では捕まらない。
 */
import { openNimbusSidebar, runCommand } from '../helpers.mjs';

async function cockpit(page, { attempts = 20 } = {}) {
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			try {
				if (await frame.$('#railSash')) {
					const box = (await (await frame.frameElement()).boundingBox()) ?? { x: 0, y: 0 };
					return { frame, origin: box };
				}
			} catch {
				// フレームが入れ替わっている最中。次で拾う
			}
		}
		await page.waitForTimeout(500);
	}
	return undefined;
}

/** 列・会話・掴み代の寸法。掴み代は中心の座標まで返す（そこを掴む） */
async function measure(frame) {
	return frame.evaluate(() => {
		const sash = document.getElementById('railSash');
		const box = sash.getBoundingClientRect();
		return {
			rail: Math.round(document.querySelector('.session-tabs').getBoundingClientRect().width),
			chat: Math.round(document.querySelector('.chat-list').getBoundingClientRect().width),
			visible: !sash.hidden && box.width > 0,
			cursor: getComputedStyle(sash).cursor,
			x: box.x + box.width / 2,
			y: box.y + box.height / 2
		};
	});
}

export default {
	name: 'セッションの列と会話の境目を、ドラッグで動かせる',
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');

		// 境目は列があるときだけ出る。前のケースの持ち越しに頼らず、足りなければ自分で足す
		let view = await cockpit(page);
		ctx.expect(view !== undefined, 'コックピットの境目（#railSash）が見つからない');
		for (let i = 0; i < 3; i++) {
			const tabs = await view.frame.evaluate(() => document.querySelectorAll('.session-tab').length);
			if (tabs >= 2) {
				break;
			}
			await runCommand(page, '新しいセッション');
			await page.waitForTimeout(1200);
			view = (await cockpit(page)) ?? view;
		}

		const start = await measure(view.frame);
		ctx.expect(start.visible, '列が出ているのに境目が見えない');
		ctx.expect(start.cursor === 'col-resize', `境目が掴めるように見えない: cursor=${start.cursor}`);

		/** 掴み代を本物のマウスで引く */
		const drag = async (dx) => {
			const before = await measure(view.frame);
			await page.mouse.move(view.origin.x + before.x, view.origin.y + before.y);
			await page.mouse.down();
			await page.mouse.move(view.origin.x + before.x + dx, view.origin.y + before.y, { steps: 12 });
			await page.mouse.up();
			await page.waitForTimeout(400);
			return measure(view.frame);
		};

		// 1. 右へ引けば列が広がる（**ここが本丸**）
		const wider = await drag(120);
		ctx.expect(
			wider.rail > start.rail + 60,
			`境目を右へ引いても列が広がらない: ${start.rail} → ${wider.rail}`
		);

		// 2. 左へ引けば狭まる
		const narrower = await drag(-160);
		ctx.expect(
			narrower.rail < wider.rail - 60,
			`境目を左へ引いても列が狭まらない: ${wider.rail} → ${narrower.rail}`
		);

		// 3. どこまで引いても、**列も会話も消えない**。
		//    覚えた幅のまま押し込むと、読む場所が無くなる
		const squeezed = await drag(-600);
		ctx.expect(squeezed.rail >= 100, `左へ引き切ると列が潰れる: ${squeezed.rail}px`);
		const stretched = await drag(2000);
		ctx.expect(stretched.chat >= 150, `右へ引き切ると会話が潰れる: ${stretched.chat}px`);

		// 4. ダブルクリックで既定へ戻る（引きすぎたときの戻り道）
		const at = await measure(view.frame);
		await page.mouse.dblclick(view.origin.x + at.x, view.origin.y + at.y);
		await page.waitForTimeout(600);
		const reset = await measure(view.frame);
		ctx.expect(
			reset.rail !== stretched.rail,
			`境目のダブルクリックで既定へ戻らない: ${stretched.rail} → ${reset.rail}`
		);
		await ctx.shot('rail-sash');
	}
};
