/**
 * 設定タブ（T-016）の行を**実際に押して、開くところまで**確かめる（T-244）。
 *
 * ここが無かったせいで、設定タブが丸ごと飾りになっていたのを長く見逃した。
 * 行はコマンドを持っておらず、押しても何も起きない。それでも「行が出ているか」しか
 * 見ていなかったので、GUI テストは通り続けていた。
 *
 * だから確かめるのは**押した結果**にする。
 * - コマンドの行 → 選択肢や入力欄が出る
 * - 値の行 → その設定に絞り込まれた設定画面が開く
 *
 * 「配られた設定を読み込む」だけは押さない。**ネイティブのファイルダイアログが出て、
 * 以後の操作を一切受け付けなくなる**ため。6 行とも同じ `actionNode` から作られるので、
 * 残り 5 行が押せていれば配線は確かめられている。
 */
import {
	clickTreeRow,
	closeAllEditors,
	collapsePane,
	expandPane,
	feedbackText,
	labels,
	openHiddenView,
	openNimbusSettingsSidebar,
	settingsEditor
} from '../helpers.mjs';

/** 押す → 何か出たことを確かめる → Esc で閉じる */
async function pressAndExpect(page, ctx, label, mustInclude) {
	ctx.expect(await clickTreeRow(page, label), `設定タブに「${label}」の行が無い`);
	const shown = await feedbackText(page);
	ctx.expect(
		shown.includes(mustInclude),
		`「${label}」を押しても何も出ない（コマンドを持たない飾りの行になっている）:\n${shown.slice(0, 200)}`
	);
	await page.keyboard.press('Escape');
	await page.waitForTimeout(600);
}

export default {
	name: '設定タブの行が、押すと実際に動く',
	async run(page, ctx) {
		await openHiddenView(page, '設定ビューを開く');
		ctx.expect(await openNimbusSettingsSidebar(page), 'Nimbus 設定のサイドバーを開けない');
		// 同じ部屋にスキル・CLAUDE.md・ヘルプも居るので、畳んで設定に場所を空ける。
		// 段が詰まると下の行が描画されず、「行が無い」で落ちる
		for (const key of ['view.nimbus.skills', 'view.nimbus.claudeMd', 'view.nimbus.help']) {
			await collapsePane(page, labels(key)[0]);
		}
		await expandPane(page, labels('view.nimbus.settings')[0]);
		await page.waitForTimeout(800);

		// --- コマンドを持つ行。押すと選択肢か入力欄が出る ---
		await pressAndExpect(page, ctx, '承認ポリシー', 'いまは');
		await pressAndExpect(page, ctx, 'フック', 'フック');
		await pressAndExpect(page, ctx, '常に含めるファイル', 'ファイル');
		// 定義が 1 つも無いときは選択肢ではなく通知が出る。どちらも「実行された」証拠
		await pressAndExpect(page, ctx, 'サブエージェントのモデル', 'サブエージェント');
		await pressAndExpect(page, ctx, '設定をまとめて配る', '配布物');
		await ctx.shot('settings-actions');

		// --- 値の行。押すと、その設定に絞り込まれた設定画面が開く ---
		// 束は畳まれているので、まず開く（折りたたみの行は押すと開閉する）
		ctx.expect(await clickTreeRow(page, 'その他'), '設定タブに「その他」の束が無い');
		ctx.expect(await clickTreeRow(page, '通知'), '「その他」を開いても「通知」の行が出ない');

		const settings = await settingsEditor(page);
		ctx.expect(
			settings !== undefined,
			'「通知」を押しても設定画面が開かない（値の行が飾りになっている）'
		);
		ctx.expect(
			settings.includes('nimbus.notifications.enabled'),
			`設定画面は開いたが、その設定に絞り込まれていない:\n${settings.slice(0, 300)}`
		);
		await ctx.shot('settings-open-setting');

		// 開いた設定画面を残すと、後のケースが別のエディタを見てしまう
		await closeAllEditors(page);
	}
};
