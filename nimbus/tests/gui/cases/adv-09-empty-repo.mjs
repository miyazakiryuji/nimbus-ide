/**
 * 敵対的試験（T-345）— 空と欠け: コミット 0 件のフォルダで、git を読む機能が黙らず、嘘もつかない。
 *
 * **疑っている壊れかた** — `git init` 直後（unborn HEAD＝まだ 1 度もコミットしていない状態）では
 * `git diff HEAD` が rc=128 で `fatal: ambiguous argument 'HEAD': unknown revision …` を返す。
 * 変更の要約は execFile の reject を**種類で分けずに**受けて、そのまま
 * `Nimbus: 差分を読めませんでした: <生の英語>` の**エラー通知**へ流す
 * （`extensions/nimbus/src/diffSummary.ts:25-35`）。
 * つまり「まだコミットが無い・変更も無い」という**平常の状態が赤いエラーとして出る**うえ、
 * 直しかたの手がかりにならない `fatal` / `ambiguous` が素で貼られる。
 *
 * **対照群** — `コミットの分けかたを提案する` は同じ空っぽを `git status --porcelain` で読む
 * （`extensions/nimbus/src/commitSplit.ts:28-46`）。unborn HEAD でも rc=0・空なので
 * `files.length === 0` から「変更はありません。」の**情報**通知に落ちる。
 * 同じ状態で、経路によって出るものが違う —— そこがこのケースの見どころなので、
 * 判定は本命と対照群の**両方**に同じ 3 本を当てる（節の見出しが「git を読む機能」＝複数形）。
 *
 * **期待する振る舞い** — 0 コミットで変更が無いときに、赤いエラーで止めない。
 * 生の英語（`fatal` / `ambiguous`）を素で貼らない。**文言は決め打ちしない** ——
 * 「変更はありません」でも「まだコミットがありません」でもよい形で判定する。
 *
 * **入れないもの** — `リポジトリの構造要約を作る`。判定がトートロジーになる
 * （`extensions/nimbus/src/core/repoSummary.ts:83-88` の `if (facts.branch)` が行ごと落とすので
 * `undefined` は構造上出ない）うえ、無題エディタを 1 枚増やす危険だけが残る。
 * ブランチ行の有無は `renderRepoSummary` の純関数なので、モジュールテスト側で見る。
 *
 * 根拠: `extensions/nimbus/src/diffSummary.ts:25-35` / `extensions/nimbus/src/commitSplit.ts:28-46` /
 * `extensions/nimbus/src/repoSummary.ts:41-47` / `extensions/nimbus/src/core/repoSummary.ts:83-88` /
 * `nimbus/tests/gui/helpers.mjs:445-455`（`closeAllEditors`）/
 * `src/vs/workbench/browser/parts/notifications/notificationsViewer.ts:234, 593-599`（severity のアイコン）
 */
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { closeAllEditors, git, labels, notificationText, runCommand } from '../helpers.mjs';

/**
 * コア側の「通知をすべて消す」。日本語 UI でも英語の別名で引ける
 * （`commandsQuickAccess.ts:244-250` が `category: 原文` を `commandAlias` にする）。
 * `MenuId.CommandPalette` に `when` 無しで載っているので、通知が 0 件でも引ける
 * （`src/vs/workbench/browser/parts/notifications/notificationsCommands.ts:324`）。
 */
const CLEAR_TOASTS = 'Notifications: Clear All Notifications';

/** run.mjs が使い捨てワークスペースに打っている「素の状態」の印（run.mjs:29） */
const BASELINE_TAG = 'nimbus-gui-baseline';

/** コミットを 1 つも持たない枝の名前。commit しないので ref にはならない＝後始末も要らない */
const ORPHAN = 'nimbus-empty';

/** 読みやすい 1 行にする（通知は改行を含む） */
function oneLine(text, max = 240) {
	return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * いま出ているトーストのうち、**エラーとして描かれている**ものの本文（配列）。
 *
 * severity は本文ではなくアイコンの class に出る
 * （`notificationsViewer.ts:234` が `.notification-list-item-icon.codicon` を作り、
 * `:439-444, 593-599` が `Codicon.error` を足す）。
 * 文言を決め打ちしないための唯一の手掛かりなので、本文ではなくここを見る。
 *
 * **枚数ではなく本文を返す**のは、判定を「エラーが 0 枚」ではなく
 * 「**Nimbus が出した**エラーが無い」で書くため。ワークスペースを空にする副作用で
 * 別の出どころ（git 拡張・ファイル監視）がトーストを出しても、そちらで落ちない。
 */
async function errorToasts(page) {
	return page.evaluate(() =>
		[...document.querySelectorAll('.notifications-toasts .notification-list-item')]
			.filter((item) => item.querySelector('.notification-list-item-icon.codicon-error'))
			.map((item) => item.innerText ?? '')
	);
}

/** そのトーストが Nimbus 自身のものか（両経路とも本文が `Nimbus: ` で始まる） */
function fromNimbus(text) {
	return text.includes('Nimbus');
}

/**
 * トーストが本当に消えるまで待つ（adv-07 と同じ作法）。
 *
 * 「消す命令を打った」ことと「消えた」ことは違う。固定時間で待つと**消え残りの 1 枚を
 * 掴む日と掴まない日**ができ、対照群のエラーが本命の判定に混ざる。
 */
async function toastsGone(page, { attempts = 6 } = {}) {
	for (let i = 0; i < attempts; i++) {
		if ((await notificationText(page)).trim() === '') {
			return true;
		}
		await page.waitForTimeout(250);
	}
	return false;
}

/**
 * トーストが出るまで待つ。出なければ空のまま返す
 * （「黙って終わった」で落とすのは `judge` の仕事なので、ここでは投げない）。
 * 固定待ちだと、遅れて出ただけのものを「黙った」と誤って赤くする。
 */
async function toastAppeared(page, { attempts = 8 } = {}) {
	let text = '';
	for (let i = 0; i < attempts; i++) {
		text = await notificationText(page);
		if (text.trim() !== '') {
			return text;
		}
		await page.waitForTimeout(300);
	}
	return text;
}

/**
 * トーストを空にしてから 1 つ打ち、**そのとき出たものだけ**を読む。
 *
 * 先に消しておかないと、対照群のトーストが残ったまま本命を読むことになり、
 * `/fatal|ambiguous/i` の否定判定も「コミットに触れている」の部分一致も
 * **前のコマンドの文面で決まってしまう**（言っていないのに緑・言っているのに赤の両方が起きる）。
 */
async function invoke(page, title) {
	await runCommand(page, CLEAR_TOASTS);
	if (!(await toastsGone(page))) {
		// 1 度で消えないことがある（消える途中で読んだ場合）。押し直すのは 1 回だけ
		await runCommand(page, CLEAR_TOASTS);
		await toastsGone(page);
	}
	await runCommand(page, title);
	const text = await toastAppeared(page);
	return { title, text, errors: await errorToasts(page) };
}

/** 3 本の判定。実測値（通知の本文・エラーの本文・もう片方の経路の結果）を必ず文面に入れる */
function judge(ctx, seen, other) {
	const shown = oneLine(seen.text) || '（通知なし）';
	// **自分が出したものを名前で探す**（枚数を絶対値で数えない）
	const mine = seen.errors.filter(fromNimbus);
	const otherMine = other.errors.filter(fromNimbus);
	const contrast =
		`対照「${other.title}」→ Nimbus のエラー ${otherMine.length} 枚 / ` +
		`"${oneLine(other.text, 160) || '（通知なし）'}"`;

	// 1. 黙って終わらない。何も出ないと、利用者は押したことすら確かめられない
	ctx.expect(
		seen.text.trim() !== '',
		`0 コミットのフォルダで「${seen.title}」が黙って終わった（トーストが 1 つも出ていない）。${contrast}`
	);
	// 2. git の生の英語を素で貼らない
	ctx.expect(
		!/fatal|ambiguous/i.test(seen.text),
		`「${seen.title}」が git の生の英語をそのまま貼っている。通知: "${shown}"`
	);
	// 3. 平常の空をエラー扱いにしない。赤で出すなら、せめて「コミット」が無いことを説明する
	ctx.expect(
		mine.length === 0 || seen.text.includes('コミット'),
		`「${seen.title}」が、まだコミットが無いだけの平常の状態を赤いエラーで止めている` +
			`（Nimbus のエラーのトースト: "${oneLine(mine.join(' / '), 160)}" / ` +
			`赤いトースト全体 ${seen.errors.length} 枚）。通知: "${shown}" / ${contrast}`
	);
}

export default {
	name: 'コミット 0 件のフォルダで、git を読む機能が黙らず、嘘もつかない',
	adversarial: true,
	async run(page, ctx) {
		const ws = ctx.workspace;
		// 戻す先の枝は**壊す前**に控える（`main` か `master` かは git の設定で変わる）
		const originalBranch = git(ws, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();

		try {
			// 1. 0 コミットの状態を作る。--orphan は HEAD を「まだ無い枝」に向けるだけで
			//    索引と作業ツリーはそのまま残るので、索引から外し（rm --cached）、実体も消す。
			//    ここまでやって初めて `git status --porcelain` が空になる
			git(ws, ['checkout', '-q', '--orphan', ORPHAN]);
			git(ws, ['rm', '-rq', '--cached', '.']);
			for (const entry of readdirSync(ws)) {
				if (entry === '.git') {
					continue;
				}
				rmSync(join(ws, entry), { recursive: true, force: true });
			}

			// 2. 前提が作れたことを先に確かめる。ここが空でないと、以後の判定は
			//    「0 コミットで変更なし」ではなく別の状態を見ていることになる
			const porcelain = git(ws, ['status', '--porcelain']);
			ctx.expect(
				porcelain.trim() === '',
				`前提（0 コミット・変更なし）が作れていない。git status --porcelain: "${oneLine(porcelain)}" / ` +
					// `rev-parse --abbrev-ref HEAD` は unborn HEAD だと rc=128 で**投げる**ので使えない
					// （execFileSync が例外を上げ、判定より先にケースが死ぬ）。`--show-current` は rc=0
					`いる枝: "${oneLine(git(ws, ['branch', '--show-current']), 60)}"`
			);

			// 3. 対照群（git status 経路）→ 本命（git diff HEAD 経路）の順に打つ
			const control = await invoke(page, labels('command.proposeCommitSplit')[0]);
			const target = await invoke(page, labels('command.showDiffSummary')[0]);
			await ctx.shot('adv-09-empty-repo');

			// 本命から判定する。落ちるならここが先に落ちてほしい（対照群は説明のための材料）
			judge(ctx, target, control);
			judge(ctx, control, target);
		} finally {
			// 後始末は必ずここで。ctx.expect の後ろに書いた行は、落ちたときに実行されない。
			// finally の中で ctx.expect は投げない（本来の失敗理由が消える）
			try {
				// 万一 1 枚開いていたら捨てる。無題文書は Revert and Close Editor でないと閉じきれない
				const left = await closeAllEditors(page);
				if (left > 0) {
					console.log(`      ！ adv-09: エディタが ${left} 枚残っています`);
				}
			} catch (error) {
				console.log(
					`      ！ adv-09: エディタを閉じられませんでした: ${error instanceof Error ? error.message : String(error)}`
				);
			}
			try {
				// 素の状態へ。`git()` は execFileSync なので、失敗は例外で飛んでくる。
				// ここで黙ると、後続のケースが「ファイルが 1 つも無い」ワークスペースを拾って全滅する
				git(ws, ['checkout', '-f', '-B', originalBranch, BASELINE_TAG]);
			} catch (error) {
				console.log(
					`      ！ adv-09: 枝を ${originalBranch} へ戻せませんでした（以後のケースが素の状態を拾えません）: ` +
						`${error instanceof Error ? error.message : String(error)}`
				);
			}
		}
	}
};
