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
	return page.evaluate(() => {
		const side = document.querySelector('.part.sidebar');
		if (!side) {
			return '';
		}
		// ビューが 1 本しかないコンテナは `.title-label` を持たないことがある
		// （`mergeViewWithContainerWhenSingleView`）。その場合は見出し行を読む
		const label = side.querySelector('.title-label')?.innerText?.trim();
		return label || (side.innerText ?? '').split('\n')[0].trim();
	});
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
	// ビューが 1 本だけのコンテナは見出しが「NIMBUS タスク: タスク」のように連結される。
	// 前方一致にすると「NIMBUS」が「NIMBUS 設定」にも当たってしまうので、
	// **完全一致か、コロンで続く形か**の 2 つだけを認める
	const hit = (title) => wanted.some((name) => {
		const [a, b] = [title.toUpperCase(), name.toUpperCase()];
		return a === b || a.startsWith(`${b}:`);
	});
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
	return openContainer(page, ['Nimbus'], {
		attempts,
		// どちらも見出しに「Nimbus」を含むので、部分一致で掴まないよう名前で除ける
		excluded: [...labels('viewsContainers.nimbusSettings'), ...labels('viewsContainers.nimbusDebug')]
	});
}

/**
 * タスクのほう（一覧雲アイコン）のサイドバーを開く。タスク板が入っている。
 *
 * ビューが 1 本しかないコンテナは、見出しに**ビュー名のほう**が出ることがある
 * （`mergeViewWithContainerWhenSingleView`）。どちらでも通るように両方を候補にする。
 */
export async function openNimbusTasksSidebar(page, { attempts = 6 } = {}) {
	const names = [...labels('viewsContainers.nimbusTasks'), ...labels('view.nimbus.board')];
	return openContainer(page, names, { attempts });
}

/** 設定のほう（歯車雲アイコン）のサイドバーを開く。スキル / CLAUDE.md / 設定 / ヘルプ が入っている */
export async function openNimbusSettingsSidebar(page, { attempts = 6 } = {}) {
	return openContainer(page, labels('viewsContainers.nimbusSettings'), { attempts });
}

/**
 * デバッグのほう（虫雲アイコン）のサイドバーを開く。詰まったときに見るものが入っている（T-249）。
 *
 * ビューが 1 つだけのコンテナは、見出しが **「コンテナ名: ビュー名」** になる。
 * アイコンを探すのはコンテナ名（部分一致）、開けたかを見るのは見出し全体（完全一致）なので、
 * 両方の形を渡す。片方だけだと `openContainer` が開閉を繰り返して閉じたまま終わる。
 */
export async function openNimbusDebugSidebar(page, { attempts = 6 } = {}) {
	const containers = labels('viewsContainers.nimbusDebug');
	const views = labels('view.nimbus.debug');
	const wanted = [...containers, ...containers.flatMap((c) => views.map((v) => `${c}: ${v}`))];
	return openContainer(page, wanted, { attempts });
}

/**
 * サイドバーのツリーの行を、見えている文字で探して**実際に押す**。
 *
 * 「行が出ているか」しか見ていないと、**コマンドを持たない飾りの行**を見逃す。
 * 実際に設定タブが丸ごとその状態（押しても何も起きない）で通っていた（T-244）。
 * 見えかたではなく、押した結果まで確かめるためのもの。
 *
 * 折りたたみの行を押すと開閉するだけなので、束を開くのにも使える。
 */
export async function clickTreeRow(page, label) {
	for (const row of await page.$$('.part.sidebar .monaco-list-row')) {
		const text = await row.evaluate((el) => el.innerText ?? '');
		if (!text.includes(label)) {
			continue;
		}
		await row.click();
		await page.waitForTimeout(1200);
		return true;
	}
	return false;
}

/** クイックピック／入力欄が開いていれば、その中身。開いていなければ空文字 */
export async function quickPickText(page) {
	return page.evaluate(() => {
		const widget = document.querySelector('.quick-input-widget');
		if (!widget || widget.style.display === 'none') {
			return '';
		}
		return widget.innerText ?? '';
	});
}

/** 出ている通知（トースト）の文字列 */
export async function notificationText(page) {
	return page.evaluate(() =>
		[...document.querySelectorAll('.notifications-toasts .notification-list-item')]
			.map((el) => el.innerText ?? '')
			.join('\n')
	);
}

/**
 * 押した結果として画面に出たもの。クイックピックと通知の両方を見る。
 *
 * コマンドによって、選択肢が出ることも「見つかりませんでした」と通知が出ることもある。
 * どちらも**実行された**証拠なので、片方だけ見ると素通りする。
 */
export async function feedbackText(page) {
	return `${await quickPickText(page)}\n${await notificationText(page)}`;
}

/**
 * 設定画面（Settings エディタ）が開いていれば、その表示文字列。開いていなければ `undefined`。
 *
 * 検索欄は `<input>` ではなく Monaco で描かれているので、`value` では取れない。
 * 表示されている文字ごと見るのが確実（絞り込みの語も、そこに出ている）。
 */
export async function settingsEditor(page) {
	return page.evaluate(() => {
		const editor = document.querySelector('.settings-editor');
		return editor ? (editor.innerText ?? '') : undefined;
	});
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

/**
 * 開いているセクションを畳む。既に畳まれていれば何もしない。
 *
 * 段が増えると下のほうの行は**描画されず**、押すどころか見つからない
 * （リストが仮想化されているため）。見たい段だけ残すのに使う。
 */
export async function collapsePane(page, label) {
	for (const header of await page.$$('.pane-header')) {
		const text = await header.evaluate((el) => el.innerText ?? '');
		if (!text.includes(label)) {
			continue;
		}
		if ((await header.getAttribute('aria-expanded')) === 'true') {
			await header.click();
			await page.waitForTimeout(800);
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
/** コマンドパレットが開いているか */
async function paletteOpen(page) {
	return page.evaluate(() => {
		const widget = document.querySelector('.quick-input-widget');
		return Boolean(widget) && widget.style.display !== 'none';
	});
}

/**
 * 焦点をワークベンチへ戻す。
 *
 * **webview（コックピットや板をタブで開いたもの）に焦点があると、キーはそちらへ流れる。**
 * パレットが開かないまま打った文字が入力欄に入り、以降のケースが**全部**空振りする
 * （実測: 41 でタブを開いたあと、42 と 43 が続けて落ちた）。
 */
async function returnFocusToWorkbench(page) {
	await page.evaluate(() => {
		const active = document.activeElement;
		if (active && active.tagName === 'IFRAME') {
			active.blur();
		}
		window.focus();
	});
	await page.waitForTimeout(200);
	// blur で戻らないときのために、押しても何も起きないところを 1 回押す
	if (!(await paletteOpen(page))) {
		await page.click('.part.statusbar', { position: { x: 400, y: 10 } }).catch(() => undefined);
		await page.waitForTimeout(200);
	}
}

export async function runCommand(page, title) {
	for (let attempt = 0; attempt < 3; attempt++) {
		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
		await page.waitForTimeout(1000);
		if (await paletteOpen(page)) {
			break;
		}
		await returnFocusToWorkbench(page);
	}
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
/** いま見えている行だけを読む（仮想化されているので、これが 1 画面ぶん） */
async function visibleEditorText(page) {
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

/** 重なっているところで継ぎ足す（同じ行が 2 度出てこないように） */
function stitch(lines, chunk) {
	const next = chunk.split('\n');
	for (let overlap = Math.min(lines.length, next.length); overlap > 0; overlap--) {
		if (lines.slice(lines.length - overlap).join('\n') === next.slice(0, overlap).join('\n')) {
			return lines.concat(next.slice(overlap));
		}
	}
	return lines.concat(next);
}

/**
 * いま開いている文書の中身。
 *
 * Monaco は**見えている行しか DOM に置かない**。1 画面に収まらない文書を 1 回読むだけだと、
 * 下のほうが「無かったこと」になる。**単独では通るのにフル実行では落ちる**の正体がこれだった
 * （T-240）— 前のケースが下部パネルを開いていると、その分だけ見える行が減り、
 * 文書の後半が読めなくなる。
 *
 * なので先頭へ戻してから、**行が増えなくなるまで読み進めて継ぎ足す**。
 */
export async function activeEditorText(page) {
	const top = process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home';
	await page.keyboard.press(top);
	await page.waitForTimeout(250);
	let lines = [];
	let previous = '';
	for (let i = 0; i < 20; i++) {
		const chunk = await visibleEditorText(page);
		if (chunk === previous) {
			break; // これ以上スクロールしない＝末尾まで来た
		}
		previous = chunk;
		lines = i === 0 ? chunk.split('\n') : stitch(lines, chunk);
		await page.keyboard.press('PageDown');
		await page.waitForTimeout(200);
	}
	// 読み終わったら先頭へ戻す。次のケースが同じ文書を見るとき、位置で結果が変わらないように
	await page.keyboard.press(top);
	return lines.join('\n');
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
