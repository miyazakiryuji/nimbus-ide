/**
 * 承認でモーダルを出さない（T-286）。**課金が出るので --with-claude のときだけ走る。**
 *
 * 「いちいち POP が出る」と報告された不具合の番人。承認は会話のカードで受ける作り（T-266）
 * だったのに、**コックピット以外の面を見ているとモーダルへ落ちていた** —
 * `isLive()` が見ているのは面が生成済みかどうかで、開いていなければ false になるため。
 *
 * だから再現条件はここ: **送った直後に別のアクティビティバーへ移る。**
 * コックピットを見たまま試すと通ってしまい、何も確かめたことにならない。
 *
 * 見るのは 2 つ。
 * 1. モーダルが出ないこと
 * 2. 面が無ければ**開き直して**カードを出すこと（出さずに黙って待つと、誰も答えられない）
 */

/** 承認が要る指示。読み取りだけでは承認が起きないので、書き込みを頼む */
const PROMPT = 'memo.txt というファイルを作って、中に「てすと」とだけ書いてください。';

async function typeInCockpit(page, text) {
	for (const frame of page.frames()) {
		const ok = await frame.evaluate(() => Boolean(document.querySelector('#input'))).catch(() => false);
		if (!ok) {
			continue;
		}
		await frame.fill('#input', text).catch(() => undefined);
		await page.waitForTimeout(400);
		await frame.press('#input', 'Enter').catch(() => undefined);
		return true;
	}
	return false;
}

/** アクティビティバーの別の面へ移る（コックピットの面を手放させる） */
async function leaveCockpit(page) {
	return page.evaluate(() => {
		const icon = [...document.querySelectorAll('.activitybar [aria-label]')]
			.find((el) => (el.getAttribute('aria-label') ?? '').includes('タスク'));
		if (!icon) {
			return false;
		}
		/** @type {HTMLElement} */ (icon).click();
		return true;
	});
}

async function modalOpen(page) {
	return page.evaluate(
		() => document.querySelector('.monaco-workbench')?.classList.contains('modal-dialog-visible') ?? false
	);
}

/** 会話の中に承認カードが出ているか */
async function approvalCardShown(page) {
	for (const frame of page.frames()) {
		const shown = await frame
			.evaluate(() => {
				const area = document.getElementById('approvals');
				return Boolean(area && !area.hidden && area.children.length > 0);
			})
			.catch(() => false);
		if (shown) {
			return true;
		}
	}
	return false;
}

export default {
	name: '承認はモーダルではなく会話のカードで受ける（--with-claude）',
	async run(page, ctx) {
		if (!ctx.withClaude) {
			return; // 指定が無ければ何もしない（成功扱い）
		}
		ctx.expect(await typeInCockpit(page, PROMPT), 'コックピットの入力欄が見つからない');

		// ここが再現条件。送った直後に面を手放す
		await page.waitForTimeout(1200);
		ctx.expect(await leaveCockpit(page), 'タスクのアイコンが見つからない');

		const deadline = Date.now() + 120000;
		let carded = false;
		while (Date.now() < deadline) {
			ctx.expect(
				!(await modalOpen(page)),
				'承認でモーダルが出た（会話のカードで受けるはずが、面が無いとモーダルへ落ちている）'
			);
			carded = await approvalCardShown(page);
			if (carded) {
				break;
			}
			await page.waitForTimeout(1000);
		}
		ctx.expect(carded, '承認カードが出ない（面を開き直せていない＝誰も答えられないまま待つ）');
		await ctx.shot('approval-card');
	}
};
