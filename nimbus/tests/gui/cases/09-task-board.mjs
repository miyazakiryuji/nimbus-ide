/**
 * タスク板（f3-f6.md §6 の 2 つめ・T-004）。
 *
 * §6 には「各列（待機中／実行中／承認待ち／レビュー待ち／完了）」とあるが、
 * **板は 1 件もタスクが無いときは列を描かず、空の案内を出す**（実測）。
 * 列を出すにはタスクが要り、タスクを作ると worktree を切って Claude セッションが走る
 * ＝課金と後片付けが発生するので、既定のテストではそこまでやらない。
 *
 * そこでここは「板が生きていること」と「空のときに黙らないこと」を見る。
 * 列の並び自体は `core/tasks.ts` の `KANBAN_COLUMNS` を単体テストが押さえており、
 * 実タスクでの見え方は F4 の手動確認（f3-f6.md §3）で確認済み。
 */
import { openNimbusTasksSidebar, webviewText } from '../helpers.mjs';

export default {
	name: 'タスク板が描画され、空のときに案内を出す',
	async run(page, ctx) {
		// 板はアクティビティバーの専用アイコンへ独立させた（T-256）
		ctx.expect(await openNimbusTasksSidebar(page), 'Nimbus タスクのサイドバーを開けない');
		await page.waitForTimeout(1500);

		const text = await webviewText(page, ['新しいタスク']);
		ctx.expect(text !== undefined, 'タスク板の Webview が見つからない（板が描画されていない）');
		ctx.expect(
			text.includes('タスクはまだありません'),
			`空のときの案内が出ていない（板が黙っている）:\n${text.slice(0, 400)}`
		);
		ctx.expect(
			text.includes('worktree'),
			`案内に「worktree を切って並列に走らせられる」ことが書かれていない:\n${text.slice(0, 400)}`
		);
		await ctx.shot('task-board');
	}
};
