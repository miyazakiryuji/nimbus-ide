# Platform Channel の突き合わせ

Dart とネイティブが、同じ名前で繋がっているかを見る（T-200）。

## 何を解決するのか

`MethodChannel` は**文字列で繋がっている**。名前を書き間違えてもコンパイルは通り、
落ちるのは実機で触ったとき。しかも `MissingPluginException` としか出ないので、
**どちら側が悪いのか分からない**。文字列どうしを突き合わせれば分かることなので、先に見せる。

## 振る舞い

コマンド「Platform Channel を突き合わせる」（`nimbus.openPlatformChannels`）。

- Dart は `lib/**/*.dart`、ネイティブは `ios/**/*.swift` と `android/**/*.kt` を読む
- 拾うもの
  - Dart: `MethodChannel('名前')` と `invokeMethod('メソッド')`
  - Swift: `FlutterMethodChannel(name: "名前")` と `case "メソッド"`
  - Kotlin: `MethodChannel(…, "名前")` と `"メソッド" ->` / `call.method == "メソッド"`
- 出すもの
  - **呼んでいるのに受け口が無い** — 実機で `MissingPluginException` になる、と書き添える
  - ネイティブ側にあるのに呼ばれていない
  - **受け口が見つからないチャネル** — 別枠にする。プラグインが提供しているなら問題ない
- **「無い」と言えるのは、そのチャネルの受け口が見つかっているときだけ。**
  見つからないチャネルについて断定しない

## 設計

- `extensions/nimbus/src/core/platformChannel.ts` — 解析と突き合わせ（VS Code 非依存）
- `extensions/nimbus/src/platformChannel.ts` — ファイル収集とコマンド

## 受け入れ条件

- [x] Dart のチャネルと呼び出しを拾う
- [x] Swift の `case` と Kotlin の `->` を拾う
- [x] 受け口の無いメソッドを挙げる
- [x] 呼ばれていない受け口を挙げる
- [x] 受け口が見つからないチャネルは断定せず別枠にする
- [ ] 画面確認（実際の Flutter プロジェクトで開く・未実施）

単体テスト: `extensions/nimbus/src/test/platformChannel.test.ts`（8 件）

## 決めなかったこと・やらないこと

- **引数の型の突き合わせ** — Dart 側は `dynamic` で渡ることが多く、静的には決まらない
- **Objective-C / Java** — 同じ形で足せる。まず Swift / Kotlin から
