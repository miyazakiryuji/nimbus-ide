/**
 * サイドバーの幅を、開いている面ごとに覚える（T-361・利用者報告 2026-08-31）。
 *
 * **VS Code のサイドバー幅は全ビュー共有の 1 値**（`sideBar.size`）。T-341 でコックピットの
 * ために既定を 300 → 560px へ広げた（台帳 #28）ので、**エクスプローラーまで 560px になり**、
 * 「ファイルとかのアクティビティバーをクリックしたときも同じサイズだと使いづらい」となった。
 *
 * 直しは `sideBar.sizeByView`（ビューコンテナ id → 幅）を足し、面の出入りで控え／戻す（台帳 #29）。
 * 既定は Nimbus の面（`workbench.view.extension.nimbus*`）が 560px、それ以外が upstream の 300px。
 *
 * **画面でしか壊れない** — 幅はグリッドが決めるので、モジュールテストでは掴めない。
 */
import { openNimbusSidebar } from '../helpers.mjs';

/** サイドバーの実寸。`clientWidth` ではなく矩形で測る（adv-14 と同じ） */
function sidebarWidth(page) {
	return page.evaluate(() => {
		const el = document.querySelector('.part.sidebar');
		return el ? Math.round(el.getBoundingClientRect().width) : 0;
	});
}

/** サイドバーの見出し（helpers.mjs:60-71 と同じ読みかた） */
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

/**
 * 組み込みビューの呼び名。**日本語と英語の両方を受ける。**
 *
 * 真っさらなプロファイルでは**1 回目の起動だけ言語パックが載らない**ので、
 * 組み込みビューは英語で出る（実測: `Explorer (⇧⌘E)`）。Nimbus のビューは
 * 拡張の nls から来るので日本語（`Nimbus タスク`）。ここは片方だけに賭けない。
 */
const EXPLORER = ['エクスプローラー', 'Explorer'];

/*
 * **大文字小文字を無視して比べる。** サイドバーの見出しは CSS の `text-transform: uppercase` で
 * 大文字化され、`innerText` はそれを反映して返す（実測: 見出しが `NIMBUS: コックピット`）。
 * `Explorer` のまま比べると一生当たらない。`helpers.mjs` の `openContainer` も
 * 両辺を `toUpperCase()` してから比べている（`:88-91`）。
 */
const hasAny = (text, names) => {
	const upper = text.toUpperCase();
	return names.some((name) => upper.includes(name.toUpperCase()));
};

/**
 * アクティビティバーのアイコンを名前で押し、**見出しが変わるまで**確かめる。
 *
 * セレクタは `helpers.mjs` の `openContainer`（`:84-108`）と同じ
 * `.activitybar [aria-label], .activitybar [title]` — `.action-label` に絞ると当たらない（実測）。
 * アイコンは**トグル**なので、既にその面なら押さない。押すと閉じてしまう。
 */
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

/** 失敗したときに「何が在ったのか」を出す。無いと原因に辿り着けない */
async function activityBarNames(page) {
	return page.evaluate(() =>
		[...document.querySelectorAll('.activitybar [aria-label], .activitybar [title]')]
			.map((el) => (`${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`).trim())
			.filter(Boolean)
			.join(' / ')
	);
}

/** 幅が動き終わるまで待つ（グリッドのアニメーションぶん） */
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
	name: 'サイドバーの幅は面ごとに覚える（コックピットは広く、エクスプローラーは狭く）',
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		const cockpit = await settledWidth(page);
		/*
		 * 既定は `min(560, 画面幅 * 0.4)` なので、狭い画面では 560 に届かない。
		 * **絶対値で縛らず、「エクスプローラーより明らかに広い」で測る** —
		 * 見たいのは「面ごとに違う」ことであって、560 という数字ではない。
		 */
		ctx.expect(cockpit > 0, `コックピットのサイドバーが測れない: ${cockpit}px`);

		if (!(await openContainerNamed(page, EXPLORER))) {
			ctx.expect(
				false,
				`エクスプローラーを開けない。いまの見出し=「${await sidebarTitle(page)}」/ ` +
					`アクティビティバーに在るもの: ${await activityBarNames(page)}`
			);
		}
		const explorer = await settledWidth(page);
		ctx.expect(
			explorer < cockpit - 80,
			`エクスプローラーがコックピットと同じ幅のまま（面ごとに覚えていない）: ` +
				`コックピット ${cockpit}px / エクスプローラー ${explorer}px`
		);

		// 戻したらコックピットの幅が返ってくる（覚えているのは片道ではない）
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーへ戻れない');
		const back = await settledWidth(page);
		ctx.expect(
			Math.abs(back - cockpit) <= 8,
			`コックピットへ戻したのに幅が変わっている: 行き ${cockpit}px → 戻り ${back}px ` +
				`（エクスプローラーの ${explorer}px を引きずっていないか）`
		);

		// もう一度エクスプローラーへ。狭いほうも覚えている
		ctx.expect(await openContainerNamed(page, EXPLORER), '2 度目のエクスプローラーを開けない');
		const explorerAgain = await settledWidth(page);
		ctx.expect(
			Math.abs(explorerAgain - explorer) <= 8,
			`エクスプローラーの幅が往復で変わっている: 1 度目 ${explorer}px → 2 度目 ${explorerAgain}px`
		);

		await ctx.shot('sidebar-width-per-view');
		// 後始末: Nimbus の面へ戻して終える（後のケースはコックピットが前面である前提で書かれている）
		await openNimbusSidebar(page);
		await page.waitForTimeout(600);
	}
};
