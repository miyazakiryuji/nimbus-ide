/**
 * **覚えた幅が、閉じて開き直しても残る**（T-369 の第 2 の穴）。
 *
 * ケース 66 は「面ごとに幅を覚える」（T-361）を見ているが、**同じ起動の中でしか見ていない**。
 * 覚えているのは `sideBar.sizeByView`（`StorageScope.PROFILE`）で、書かれるのは
 * `LayoutStateModel.save()`、読まれるのは起動時 — **どちらも再起動をまたがないと通らない**。
 *
 * `saveKeyToStorage` はオブジェクトを `JSON.stringify` し、`loadKeyFromStorage` は
 * `typeof key.defaultValue === 'object'` のときだけ `JSON.parse` する。既定値を
 * オブジェクト以外で宣言していたら、**保存はできて読み出しだけ静かに壊れる**。
 * 数字の鍵しか無かった upstream に、Nimbus が初めてオブジェクトの鍵を足した（台帳 #29）ので、
 * ここは通しておかないと分からない。
 *
 * T-368 と同じ形の穴 — 「書けているか」ではなく「**開き直して戻るか**」で見る。
 */
import { openNimbusSidebar } from '../helpers.mjs';

function sidebarWidth(page) {
	return page.evaluate(() => {
		const el = document.querySelector('.part.sidebar');
		return el ? Math.round(el.getBoundingClientRect().width) : 0;
	});
}

function sidebarTitle(page) {
	return page.evaluate(() => {
		const side = document.querySelector('.part.sidebar');
		if (!side) {
			return '';
		}
		const label = side.querySelector('.title-label')?.innerText?.trim();
		return label || (side.innerText ?? '').split('\n')[0].trim();
	});
}

// 真っさらなプロファイルの 1 回目は組み込みビューが英語で出る（ケース 66 の実測）
const EXPLORER = ['エクスプローラー', 'Explorer'];

const hasAny = (text, names) => {
	const upper = text.toUpperCase();
	return names.some((name) => upper.includes(name.toUpperCase()));
};

async function openContainerNamed(page, names, { attempts = 8 } = {}) {
	for (let i = 0; i < attempts; i++) {
		if (hasAny(await sidebarTitle(page), names)) {
			return true;
		}
		for (const icon of await page.$$('.activitybar [aria-label], .activitybar [title]')) {
			const name = await icon
				.evaluate((el) => `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`)
				.catch(() => '');
			if (!hasAny(name, names)) {
				continue;
			}
			await icon.click().catch(() => undefined);
			break;
		}
		await page.waitForTimeout(1000);
	}
	return hasAny(await sidebarTitle(page), names);
}

async function settledWidth(page, { attempts = 12 } = {}) {
	let last = -1;
	for (let i = 0; i < attempts; i++) {
		await page.waitForTimeout(400);
		const now = await sidebarWidth(page);
		if (now === last && now > 0) {
			return now;
		}
		last = now;
	}
	return last;
}

export default {
	name: '覚えた幅は、閉じて開き直しても残る（T-361 / T-369）',
	async run(page, ctx) {
		// 1. 両方の面を一度ずつ通り、それぞれの幅を覚えさせる
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		const cockpitBefore = await settledWidth(page);
		ctx.expect(cockpitBefore > 0, `コックピットのサイドバーが測れない: ${cockpitBefore}px`);

		ctx.expect(await openContainerNamed(page, EXPLORER), 'エクスプローラーを開けない');
		const explorerBefore = await settledWidth(page);
		ctx.expect(
			explorerBefore < cockpitBefore - 80,
			`前提が崩れている（面ごとに幅が分かれていない・T-361）: ` +
				`コックピット ${cockpitBefore}px / エクスプローラー ${explorerBefore}px`
		);

		/*
		 * **エクスプローラーを開いたまま閉じる。** 開いていた面はしまう時に控えられるので、
		 * 「閉じる直前の面だけ正しく、もう片方は既定へ戻る」という壊れかたを掴める。
		 */
		const reopened = await ctx.restart();

		// 2. 開き直して、それぞれの幅が戻る
		ctx.expect(await openContainerNamed(reopened, EXPLORER), '開き直したあとエクスプローラーを開けない');
		const explorerAfter = await settledWidth(reopened);
		ctx.expect(
			Math.abs(explorerAfter - explorerBefore) <= 12,
			`開き直したらエクスプローラーの幅が変わった: ${explorerBefore}px → ${explorerAfter}px`
		);

		ctx.expect(await openNimbusSidebar(reopened), '開き直したあと Nimbus のサイドバーを開けない');
		const cockpitAfter = await settledWidth(reopened);
		ctx.expect(
			Math.abs(cockpitAfter - cockpitBefore) <= 12,
			`開き直したらコックピットの幅が変わった（エクスプローラーの ${explorerAfter}px を` +
				`引きずっていないか）: ${cockpitBefore}px → ${cockpitAfter}px`
		);

		await ctx.shot('restart-keeps-widths');
	}
};
