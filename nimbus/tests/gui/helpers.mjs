/**
 * GUI ケースから使う共通の操作。
 *
 * ここに置いてある理由: `cases/` に置くと run.mjs がテストケースとして読み込もうとする
 * （`{ name, run }` を要求される）ので、ケースではないものは 1 つ上の階層に置く。
 */

/** サイドバーに Nimbus のビューが出ているか。コックピットは畳んでも見出しが残るので目印にする */
async function sidebarShowsNimbus(page) {
	const text = await page.evaluate(() => document.querySelector('.part.sidebar')?.innerText ?? '');
	return text.includes('コックピット');
}

/**
 * Nimbus のサイドバーを開く。**既に開いていれば何もしない。**
 *
 * アクティビティバーのアイコンは**トグル**なので、開いている状態で押すと閉じる。
 * 起動時に NIMBUS_SMOKE が `nimbus.cockpit.focus` を呼んで開いているため、
 * 何も考えずに押すケースは「押した結果、閉じる」ことになる（実測でこれに嵌まった）。
 *
 * セレクタを `.activitybar` の中に限っているのも同じ理由で、
 * 製品名が Nimbus なのでタイトルバーやステータスバーにも "Nimbus" が入っている。
 */
export async function openNimbusSidebar(page, { attempts = 6 } = {}) {
	for (let i = 0; i < attempts; i++) {
		if (await sidebarShowsNimbus(page)) {
			return true;
		}
		const icon = await page.$('.activitybar [aria-label*="Nimbus"], .activitybar [title*="Nimbus"]');
		if (icon) {
			await icon.click();
		}
		await page.waitForTimeout(1200);
	}
	return sidebarShowsNimbus(page);
}

/** 畳まれているセクションを開く。既に開いていれば何もしない */
export async function expandPane(page, label) {
	const headers = await page.$$('.pane-header');
	for (const header of headers) {
		const text = await header.evaluate((el) => el.innerText ?? '');
		if (!text.includes(label)) {
			continue;
		}
		if ((await header.getAttribute('aria-expanded')) === 'false') {
			await header.click();
			await page.waitForTimeout(1200);
		}
		return true;
	}
	return false;
}

/** サイドバー全体の文字列 */
export async function sidebarText(page) {
	return page.evaluate(() => document.querySelector('.part.sidebar')?.innerText ?? '');
}

/**
 * コマンドパレットを開いて絞り込み、候補の文字列を返して閉じる。
 * コマンドの登録漏れを捕まえるのに使う。
 */
export async function searchCommands(page, query) {
	await page.keyboard.press('Escape');
	await page.waitForTimeout(300);
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
	await page.waitForTimeout(1000);
	await page.keyboard.type(query, { delay: 20 });
	await page.waitForTimeout(1200);
	const text = await page.evaluate(() => document.querySelector('.quick-input-widget')?.innerText ?? '');
	await page.keyboard.press('Escape');
	await page.waitForTimeout(400);
	return text;
}

/** コマンドパレットからコマンドを 1 つ実行する */
export async function runCommand(page, title) {
	await page.keyboard.press('Escape');
	await page.waitForTimeout(300);
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
	await page.waitForTimeout(1000);
	await page.keyboard.type(title, { delay: 20 });
	await page.waitForTimeout(1200);
	await page.keyboard.press('Enter');
	await page.waitForTimeout(1500);
}

/**
 * Webview（iframe の入れ子）の中身を読む。
 * 指定した語がすべて入っているフレームが見つかるまで待つ。
 */
export async function webviewText(page, mustInclude, { attempts = 10 } = {}) {
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			let text = '';
			try {
				text = await frame.evaluate(() => document.body?.innerText ?? '');
			} catch {
				continue; // 破棄されたフレームは飛ばす
			}
			if (mustInclude.every((needle) => text.includes(needle))) {
				return text;
			}
		}
		await page.waitForTimeout(1000);
	}
	return undefined;
}
