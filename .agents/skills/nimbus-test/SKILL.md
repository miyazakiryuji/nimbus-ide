---
name: nimbus-test
description: Nimbus のテストを走らせる。テストコードによるモジュールテストと、実際に GUI を操作するテストの 2 本立て。ケースの足しかたも扱う。実装後の確認やリリース前に使う。
---

# テストを走らせる

```bash
bash nimbus/scripts/test.sh          # モジュールテスト＋ドクター（GUI は含めない）
bash nimbus/scripts/test.sh unit     # モジュールテストだけ
bash nimbus/scripts/test.sh gui      # GUI を実際に操作する（ウィンドウが開く）
bash nimbus/scripts/test.sh all      # 全部
bash nimbus/scripts/test.sh gui --with-claude   # 実セッションの往復も確認（課金が発生する）
```

**GUI テストは既定に含めていない。** ウィンドウが前面に出て利用者の作業を邪魔するため、
意図したときだけ `gui` を指定する。人が作業中かどうか分からないときは、先に確認する。

## 1. モジュールテスト

`extensions/nimbus/src/test/*.test.ts` を `node --test` で走らせる（VS Code は起動しない）。

**ここに置くもの**: 判断を誤ると実害が出る純粋ロジック。
差分の組み立て・課金モードの判定・カンバンの状態機械・worktree の破棄（実 git を使う）・
スキルの検索・ゆあのシステムプロンプト。

**ここに置かないもの**: 拡張ホストや VS Code の API が要るもの。それは GUI テストへ。

ケースの足しかた: `src/test/<対象>.test.ts` に `test('日本語で意図を書く', () => { ... })`。
VS Code に依存しないよう、対象のロジックは `src/core/` に置いてから読む。

**リポジトリの道具**（板を見る `board.mjs`・ドクター）の守りは `nimbus/tests/scripts/*.test.mjs`
（T-283 / T-284）。道具は拡張ではないので `src/test/` には置けないが、
**壊れると「板に書いたのに見えない」のように、いちばん気づけない形で効く**ので守りは要る。
同じ `test.sh unit` で走り、守りの一覧（`regression-guard.mjs`）からも見える。

## 2. GUI テスト

`nimbus/tests/gui/` にある。Playwright で Electron ごと起動し、使い捨てのプロファイルと
ワークスペースで操作する（利用者の設定やデータには触れない）。

```bash
node nimbus/tests/gui/run.mjs --list          # ケース一覧（起動しない）
node nimbus/tests/gui/run.mjs --only theme    # 名前で絞る
node nimbus/tests/gui/run.mjs --packaged      # パッケージ版で確認する
```

初回だけ準備が要る:

```bash
cd nimbus/tests/gui && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install
```

**ケースの足しかた** — `cases/` にファイルを 1 つ増やすだけ。番号は実行順。

```javascript
export default {
	name: '何を確かめるのかを日本語で',
	async run(page, ctx) {
		const text = await page.evaluate(() => document.querySelector('.part.sidebar')?.innerText ?? '');
		ctx.expect(text.includes('コックピット'), `見つからない:\n${text.slice(0, 300)}`);
		await ctx.shot('任意のスクリーンショット名');
	}
};
```

- 失敗は例外で表す。`ctx.expect(条件, '何が起きたか')` を使うと理由が残る
- 失敗すると自動でスクリーンショットが `nimbus/tests/gui/out/` に残る
- `ctx.withClaude` が真のときだけ実セッションを使うケースにする（課金するため）

## 足すべきケースの見つけかた

**画面でしか壊れない**ものを足す。逆に、ロジックで確かめられるものはモジュールテストへ。

- 見た目の前提（既定テーマ、ブランド名、Copilot の露出が無いこと）
- ビューの存在と中身（コックピット・タスク・スキル・文脈）
- 実際に操作しないと起きない経路（承認モーダル、差分エディタ、worktree の別ウィンドウ）

不具合を直したら、**その不具合を再現するケースを 1 つ足してから**直す。
