---
name: nimbus-test
description: Nimbus のテストを走らせる。テストコードによるモジュールテストと、実際に GUI を操作するテストの 2 本立て。実装後の確認は該当機能のケースだけを --only で絞って走らせ、全ケースは利用者が「総合試験」と言ったときとリリース前だけ回す。ケースの足しかたも扱う。わざと壊しにいく試験は adversarial-test スキルへ。
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

**実装後の確認は、実装した機能のケースだけに絞る**（T-325・利用者指示）。毎回の修正で
全ケースを回すと 1 修正が重すぎる。`--only` はケース名・ファイル名の部分一致で 1 回に 1 語 —
複数のケースは共通の語で当てるか、コマンドを分けて走らせる。関係が疑わしいケースは含める。
**全ケースを回すのは、利用者が「総合試験を実施して」と言ったときと、リリース前だけ**
（下の「総合試験」の節）。

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
node nimbus/tests/gui/run.mjs --only theme    # 名前で絞る（実装後の確認はこれが既定）
node nimbus/tests/gui/run.mjs --packaged      # パッケージ版で確認する
bash nimbus/scripts/test.sh gui --only theme  # test.sh 経由でも引数は届く
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

## 総合試験（全部を回す）

**利用者が「総合試験を実施して」と言ったとき、またはリリース前**に、全体を順に回す。
普段の実装後にこれを挟まない（該当ケースの絞り込みで足りる・T-325）。

```bash
bash nimbus/scripts/package-app.sh --copy /tmp/nimbus-gui-app        # 固めて写しを作る
bash nimbus/branding/smoke-packaged.sh                               # 身元・起動・webview のスモーク
bash nimbus/scripts/test.sh unit                                     # モジュール＋スクリプトのテスト
NIMBUS_APP=/tmp/nimbus-gui-app/Nimbus.app node nimbus/tests/gui/run.mjs --packaged              # GUI 全件
NIMBUS_APP=/tmp/nimbus-gui-app/Nimbus.app node nimbus/tests/gui/run.mjs --packaged --untrusted  # 信頼なしの見え方
NIMBUS_APP=/tmp/nimbus-gui-app/Nimbus.app node nimbus/tests/gui/run.mjs --packaged --adversarial # わざと壊しにいく束（T-345）
node nimbus/scripts/doctor.mjs                                       # 不要ファイル・仕様ズレ
node nimbus/scripts/degrade.mjs check --full                         # 締め: 基準より減っていないか（T-335）
```

- 落ちたものがあれば、**次の段へ進む前に**そこで直す
- **敵対束（`--adversarial`）の赤は「調査対象」であって停止理由ではない。**
  切り分けかたと設計の作法は [`adversarial-test` スキル](../adversarial-test/SKILL.md)。
  2026-08-31 は総合試験が 63/63 緑のビルドで **16 本中 11 本が落ち、全部が本物の不具合だった**
- 実セッションの往復まで見るときは GUI の 2 行に `--with-claude` を足す（課金が発生する —
  利用者に確認してから）
- 結果は件数まで板に残す（例: `パッケージ版 GUI 55/55`）。「通った」だけでは、後から
  何件の時点だったのかが分からない

## デグレチェック（基準との突き合わせ・T-335）

**ある程度実装したら走らせる。** CLAUDE.md の「Before を控えて After で同じだけ通る」の控え帳。

```bash
bash nimbus/scripts/test.sh degrade              # いつもの確認（unit＋目録＋ドクター）
node nimbus/scripts/degrade.mjs check --full     # 総合試験の締め（GUI 全件の通過数まで）
node nimbus/scripts/degrade.mjs record           # 基準を進める（意図した増減のとき）
```

見るのは**減り**だけ（増えるのは自由）: 落ちるテストの数 / テスト・GUI ケース・仕様書の総数 /
入口（コマンド・ビュー・設定）/ `core/` の export / ドクター要対応。基準は
`nimbus/tests/baseline.json`（コミットされる＝全セッション共有）。

**意図して消したときは、変更と同じコミットで `record`。** 赤を握りつぶさない —
基準の diff に削減が残るのが、板の「消す理由を 1 行残す」の数字版。

## 足すべきケースの見つけかた

**画面でしか壊れない**ものを足す。逆に、ロジックで確かめられるものはモジュールテストへ。

- 見た目の前提（既定テーマ、ブランド名、Copilot の露出が無いこと）
- ビューの存在と中身（コックピット・タスク・スキル・文脈）
- 実際に操作しないと起きない経路（承認モーダル、差分エディタ、worktree の別ウィンドウ）

不具合を直したら、**その不具合を再現するケースを 1 つ足してから**直す。
