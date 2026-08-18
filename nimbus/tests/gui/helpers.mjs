/**
 * GUI ケースから使う共通の操作。
 *
 * ここに置いてある理由: `cases/` に置くと run.mjs がテストケースとして読み込もうとする
 * （`{ name, run }` を要求される）ので、ケースではないものは 1 つ上の階層に置く。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// このファイルは nimbus/tests/gui にあるので、リポジトリの根までは 3 つ上がる
const EXT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'extensions', 'nimbus');

function loadNls(name) {
	try {
		return JSON.parse(readFileSync(join(EXT, name), 'utf8'));
	} catch {
		return {};
	}
}

/**
 * 表示文字列は**言語で変わる**（T-091 で `%key%` になった）。
 * ケースが日本語を決め打ちすると、パッケージ版（既定ロケールが en）で全部落ちる。
 *
 * なので**キーで書き、候補の文字列は `package.nls*.json` から引く**。
 * 翻訳が変わってもケースを直さなくて済むし、どの言語で動かしても通る。
 */
// 英語の訳は `nimbus/i18n/` へ移された（出荷物を日本語に保つため・T-091）。
// どちらに置かれていても候補として拾えるように、両方を見る
const NLS = [
	loadNls('package.nls.json'),
	loadNls('package.nls.en.json'),
	loadNls(join('..', '..', 'nimbus', 'i18n', 'package.nls.en.json'))
];

/** そのキーに対して、いずれかの言語で出うる文字列 */
export function labels(key) {
	const found = NLS.map((table) => table[key]).filter((value) => typeof value === 'string' && value);
	if (found.length === 0) {
		throw new Error(`package.nls*.json にキーがありません: ${key}（変換の取りこぼしかもしれません）`);
	}
	return [...new Set(found)];
}

/** どれか 1 つでも含まれていれば true */
export function includesAny(text, candidates) {
	return candidates.some((candidate) => text.includes(candidate));
}

/**
 * いま開いているサイドバーの見出し（＝ビューコンテナ名）。
 *
 * 中身の文字列ではなく**見出しだけ**を見る。アクティビティバーに Nimbus のコンテナが
 * 2 つ並ぶようになったので（雲＝常用 / 歯車雲＝設定・T-243）、
 * サイドバー全体を `/NIMBUS/i` で見ると「NIMBUS 設定」にも当たってしまい、
 * 「常用のほうが開いている」と誤って判定する。
 */
async function sidebarTitle(page) {
	return page.evaluate(() => document.querySelector('.part.sidebar .title-label')?.innerText?.trim() ?? '');
}

/**
 * 見出しが `wanted` のどれかになるまで、アクティビティバーのアイコンを押す。
 * **既にその見出しなら何もしない。**
 *
 * アイコンは**トグル**なので、開いている状態で押すと閉じる。
 * 起動時に NIMBUS_SMOKE が `nimbus.cockpit.focus` を呼んで開いているため、
 * 何も考えずに押すケースは「押した結果、閉じる」ことになる（実測でこれに嵌まった）。
 *
 * セレクタを `.activitybar` の中に限っているのも同じ理由で、
 * 製品名が Nimbus なのでタイトルバーやステータスバーにも "Nimbus" が入っている。
 */
async function openContainer(page, wanted, { attempts = 6, excluded = [] } = {}) {
	const hit = (title) => wanted.some((name) => title.toUpperCase() === name.toUpperCase());
	for (let i = 0; i < attempts; i++) {
		if (hit(await sidebarTitle(page))) {
			return true;
		}
		for (const icon of await page.$$('.activitybar [aria-label], .activitybar [title]')) {
			const name = await icon.evaluate(
				(el) => `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`
			);
			if (!wanted.some((want) => name.includes(want)) || excluded.some((skip) => name.includes(skip))) {
				continue;
			}
			await icon.click();
			break;
		}
		await page.waitForTimeout(1200);
	}
	return hit(await sidebarTitle(page));
}

/**
 * 常用のほう（雲アイコン）のサイドバーを開く。
 *
 * 見出しの `Nimbus` は製品名なので翻訳されない（`%key%` にしていない）。
 * 「Nimbus 設定」のほうは翻訳されるので、そちらを掴まないように名前で除ける。
 */
export async function openNimbusSidebar(page, { attempts = 6 } = {}) {
	return openContainer(page, ['Nimbus'], { attempts, excluded: labels('viewsContainers.nimbusSettings') });
}

/** 設定のほう（歯車雲アイコン）のサイドバーを開く。スキル / CLAUDE.md / 設定 が入っている */
export async function openNimbusSettingsSidebar(page, { attempts = 6 } = {}) {
	return openContainer(page, labels('viewsContainers.nimbusSettings'), { attempts });
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

/**
 * 使い捨てワークスペースで git を動かす。
 *
 * 入口だけの確認（ビューが出る・コマンドが引ける）から一歩進めて、
 * **実際の変更に対して機能が動くこと**を見るために使う。
 * 実セッション（課金）が要るのは承認モーダルまわりだけで、
 * git を読む機能はここまで確認できる。
 */
export function git(cwd, args) {
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 'nimbus-gui',
			GIT_AUTHOR_EMAIL: 'gui@example.invalid',
			GIT_COMMITTER_NAME: 'nimbus-gui',
			GIT_COMMITTER_EMAIL: 'gui@example.invalid'
		}
	});
}

/**
 * 新しく開いたタブ（コマンドが出した一枚）の中身を読む。
 *
 * **空白を普通の空白に直してから返す。** VS Code のエディタは行の描画で
 * ノーブレークスペース（U+00A0）を使うので、素の `includes(' ')` が当たらない。
 * 画面上は同じに見えるのに一致しない、といういちばん分かりにくい壊れかたをする（実測）。
 */
export async function activeEditorText(page) {
	// エディタ本体は仮想化されているので、見えている行をつなぐ。
	//
	// **いま開いているグループの中から探す。** 単に最初の `.editor-instance` を読むと、
	// 前のケースが開いたままの文書を読んでしまう（無題文書は保存を聞かれるので閉じきれず、
	// 実際に別のケースを落とした）。見つからないときだけ従来どおり先頭に落とす。
	const text = await page.evaluate(() => {
		const active = document.querySelector('.editor-group-container.active .editor-instance .view-lines')
			?? document.querySelector('.monaco-editor.focused .view-lines')
			?? document.querySelector('.editor-instance .view-lines');
		return active ? active.innerText : '';
	});
	return text.replace(/\u00a0/g, ' ');
}

/**
 * 開いている文書を全部閉じる。**残った数を返す**。
 *
 * ケースはアプリを共有しているので、**開きっぱなしは次のケースに効く**
 * （前のケースの文書を読んで、通るはずのものが落ちる）。
 *
 * `openTextDocument({ content })` で作った無題文書は普通に閉じると保存を聞かれるため、
 * **「Revert and Close Editor」で捨てる**。`Close All Editors` では閉じきれない。
 */
export async function closeAllEditors(page, { attempts = 10 } = {}) {
	const count = () => page.evaluate(() => document.querySelectorAll('.editor-instance .view-lines').length);
	for (let i = 0; i < attempts; i++) {
		if ((await count()) === 0) {
			return 0;
		}
		await runCommand(page, 'Revert and Close Editor');
		await page.waitForTimeout(600);
	}
	return count();
}

/**
 * 下部パネル（Nimbus 診断）の中身を読む。
 * サイドバーに 13 段並べると、どれも見なくなる。診断系はパネルへ移した（T-239）。
 */
export async function panelText(page) {
	return page.evaluate(() => document.querySelector('.part.panel')?.innerText ?? '');
}

/** 既定では出していないビューを、コマンドから開く（`nimbus.showXxx`） */
export async function openHiddenView(page, commandTitle) {
	await runCommand(page, commandTitle);
	await page.waitForTimeout(1500);
}
