# Productivity Guide

## 何を解決するのか

機能を足すほど、**知られないまま埋もれる**。Nimbus には既に多くのコマンドとキーバインドがあるのに、
使われているのはその一部で、しかも「自分が何を使えていないか」は自覚できない。
IntelliJ IDEA の Productivity Guide と同じく、使用状況を見せて、使っていない近道を教える。

## 振る舞い

### 開きかた

コマンドパレットの `Help: Show Productivity Guide`。

### 出るもの

2 つに分かれる。

**Most used** — 実行回数の多い順。区切り行に総実行回数が出る。
各行は「コマンド名 / キーバインド / N 回・最終 3 時間前」。

**Shortcuts you have not used** — **キーバインドを持っているのに一度も実行していないコマンド**。
名前順。ここが行動を変えられる側で、この機能の本体。

どちらの行も選べば**その場で実行される**（読むだけで終わらせない）。

上限は各 25 件。指摘する場所を絞るための一覧であって、統計表ではない。

### 記録

`ICommandService.onDidExecuteCommand` を購読して回数と最終実行時刻を数える。

- 保存は `StorageScope.PROFILE`（キー `nimbus.productivityGuide.usage`）
- **5 秒のタイマーでまとめ書き**する。1 キーストロークごとにディスクを叩かないため
- ウィンドウが閉じるときは `onWillSaveState` で確実に書き出す
- Productivity Guide 自身とコマンドパレットは数えない（使い方の指標にならない）

### エラー・境界

- 記録がまだ無いときは「Nothing recorded yet」を出す
- 壊れた保存データは読める分だけ残す（`count` が 0 以下・型違い・欠落は捨てる）

## 設計

| ファイル | 役割 |
|---|---|
| `contrib/productivityGuide/common/productivityGuide.ts` | 純粋関数（`recordUsage` / `rankByUsage` / `unusedShortcuts` / `totalInvocations` / `parseStats`）と上限値 |
| `contrib/productivityGuide/browser/productivityGuide.contribution.ts` | 集計サービス（ワークベンチコントリビューション）と表示コマンド |
| `contrib/productivityGuide/test/common/productivityGuide.test.ts` | 純粋関数のテスト（7 件） |

起動経路は `sessions.common.main.ts` の `// Productivity Guide` セクション。

集計対象の母集団はコマンドパレットに出るコマンド。キーバインドは
`IKeybindingService.lookupKeybinding` で引く。`recordUsage` は入力を破壊しない。

### 配色について

独自 CSS なし。2 つの区分はセパレータで分け、性格はアイコンで示す
（よく使う＝炎、使っていない近道＝電球）。テーマ（T-001 の Claude 配色）に従う。

## 受け入れ条件

- [ ] いくつかコマンドを実行してからガイドを開くと Most used に出る
- [ ] 区切り行の総実行回数が増えている
- [ ] 一度も使っていないキーバインド付きコマンドが下の区分に出る
- [ ] 行を選ぶとそのコマンドが実行される
- [ ] ウィンドウを再起動しても回数が残っている
- [ ] 記録が空のときに「Nothing recorded yet」が出る
- [ ] Nimbus Dark / Light の両方で見た目が破綻しない

確認記録は `../testing/productivity-guide.md`。

## 決めなかったこと・やらないこと

- **表形式のエディタタブは作らない**（IntelliJ は表）— まずピッカーで足りるか見る。
  ソートや期間の絞り込みが欲しくなったら作る
- **回数を外部に送らない** — 端末ローカルに閉じる。テレメトリではない
- **「使っていない機能」に機能紹介文は付けない** — 説明の維持コストに見合わない。
  コマンド名とキーが分かれば試せる
- **ワークスペースごとに分けない** — 作業のクセは人に付くのでプロファイル単位で数える
