/**
 * 私が足したコマンドが登録されているか。
 *
 * `package.json` への追記漏れ・`registerCommand` の書き忘れは、
 * どちらもコンパイルが通ってしまう。コマンドパレットで引けるかどうかが唯一の確認になる。
 */
import { searchCommands } from '../helpers.mjs';

/** 探す語 → 出てほしいコマンド名の一部 */
const COMMANDS = [
	['Nimbus: すべてのセッション', 'すべてのセッションを止める', 'T-057 緊急停止'],
	['Nimbus: 過去セッション', '過去セッションを検索', 'T-034 横断検索'],
	['Nimbus: 完了報告', '完了報告を作る', 'T-081 証跡つき完了報告'],
	['Nimbus: 文脈を圧縮', '文脈を圧縮', 'T-022 手動コンパクション'],
	['Nimbus: チェックポイント', 'チェックポイントまで戻す', 'T-025 巻き戻し'],
	['Nimbus: 常に含める', '常に含めるファイル', 'T-152 ピン留め'],
	['Nimbus: テンプレート', 'テンプレートから始める', 'T-148 テンプレート'],
	['Nimbus: いまの作業を分岐', '分岐', 'T-036 セッションの分岐'],
	['Nimbus: 過去のセッションを再開', '再開', 'T-150 復元'],
	['Nimbus: 使用量', '使用量を取得し直す', 'T-017 使用量']
];

export default {
	name: 'Nimbus のコマンドがコマンドパレットから引ける',
	async run(page, ctx) {
		for (const [query, expected, label] of COMMANDS) {
			const text = await searchCommands(page, query);
			ctx.expect(text.includes(expected), `${label}: 「${expected}」が出ない（検索: ${query}）\n${text.slice(0, 300)}`);
		}
		await ctx.shot('nimbus-commands');
	}
};
