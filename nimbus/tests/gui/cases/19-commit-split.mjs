/**
 * コミットの分けかた（T-114）の通し確認。
 *
 * 守っている修正（T-274）: T-114 / T-240（このケースは**フル実行のときだけ落ちて**いた。
 * 真因は文書を画面に出ている分しか読んでいなかったこと。`activeEditorText` が最後まで読む）
 *
 * 入口（コマンドが引ける）ではなく、**実際の変更に対して束が出るか**を見る。
 * 使い捨てワークスペースは `git init` 済みなので、ここで本物の変更を作れる。
 * 実セッション（課金）は要らない — この機能は git の状態しか読まないため。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { activeEditorText, git, labels, runCommand } from '../helpers.mjs';

export default {
	name: 'コミットの分けかたが、実際の変更から束を出す',
	async run(page, ctx) {
		const ws = ctx.workspace;
		// 最初のコミットを作る（差分の土台）
		writeFileSync(join(ws, 'seed.txt'), 'seed\n');
		git(ws, ['add', '--', 'seed.txt']);
		git(ws, ['commit', '-q', '-m', 'seed']);

		// 意図の違う変更を 2 種類 + 台帳を作る
		mkdirSync(join(ws, 'extensions/nimbus/src/core'), { recursive: true });
		mkdirSync(join(ws, 'extensions/nimbus/src/test'), { recursive: true });
		writeFileSync(join(ws, 'extensions/nimbus/src/core/usage.ts'), 'export const a = 1;\n');
		writeFileSync(join(ws, 'extensions/nimbus/src/test/usage.test.ts'), 'export const b = 1;\n');
		writeFileSync(join(ws, 'extensions/nimbus/src/core/other.ts'), 'export const c = 1;\n');
		writeFileSync(join(ws, 'tasks.md'), '- [ ] T-999 何か\n');

		await runCommand(page, labels('command.proposeCommitSplit')[0]);
		const text = await activeEditorText(page);

		ctx.expect(text.includes('コミットの分けかた'), `提案の一枚が開いていない:\n${text.slice(0, 400)}`);
		// 同じ機能の実装とテストが 1 つの束に寄る
		ctx.expect(text.includes('usage まわり'), `機能ごとの束が出ていない:\n${text.slice(0, 600)}`);
		// 台帳は別の束として出る
		// 落ちたときに原因が分かるように、そのとき git が何を見ていたかも添える
		ctx.expect(
			text.includes('台帳'),
			`台帳の束が出ていない:\n${text.slice(0, 900)}\n--- git status ---\n${git(ws, ['status', '--porcelain'])}`
		);
		// 出すコマンドは必ずパス指定。`-A` は他セッションの変更を巻き込む。
		// ただし本文には「`git add -A` を使わない」という**注意書き**が入るので、
		// 文書全体ではなく「実際に出しているコマンド行」だけを見る
		const commands = text.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('git add'));
		ctx.expect(commands.length > 0, `git add の行が出ていない:\n${text.slice(0, 600)}`);
		ctx.expect(
			commands.every((line) => line.startsWith('git add --')),
			`パス指定でない git add がある: ${commands.join(' / ')}`
		);
		await ctx.shot('commit-split');
	}
};
