# 依存の食い違い

`pubspec` と `Podfile.lock` を突き合わせて、揃っていないものを出す（T-198）。

## 何を解決するのか

Flutter では「`pubspec.yaml` を触ったのに `pub get` していない」「プラグインを足したのに
`pod install` していない」が定番の詰まりどころ。**エラーメッセージが原因を指さない**ので、
気づくまでに時間を溶かす。ファイルを突き合わせれば分かることなので、先に見せる。

## 振る舞い

コマンド「依存の食い違いを見る」（`nimbus.openDepConsistency`）。

- `pubspec.yaml` の依存（`dependencies` / `dev_dependencies`）が `pubspec.lock` に無ければ挙げる
  → `flutter pub get` を実行すると揃う
- プラグインが `ios/Podfile.lock` に無ければ挙げる → `pod install` を実行すると揃う
- プラグインの一覧は `.flutter-plugins-dependencies`（`flutter pub get` が作る）から取る。
  **無ければ pod 側は見ない**（分からないものを推測して指摘しない）
- 名前は寄せて比べる（`url_launcher` と `url_launcher_ios` を別物と言わない）
- **原因を断定せず、次にやることだけ書く**（手が動くほうが役に立つ）

## 設計

- `extensions/nimbus/src/core/depConsistency.ts` — 解析と突き合わせ（VS Code 非依存）
- `extensions/nimbus/src/depConsistency.ts` — ファイル読み込みとコマンド
- `pubspec.lock` の解析は [`lock-diff`](lock-diff.md) のものを使い回す

## 受け入れ条件

- [x] `pubspec.yaml` の依存を拾う（`sdk: flutter` は数えない）
- [x] `Podfile.lock` の `PODS` を拾う（版とサブスペックは落とす）
- [x] lock に無い依存を挙げ、`flutter pub get` を案内する
- [x] プラグイン名を寄せて比べる
- [x] 材料が無ければ何も言わない
- [x] 画面確認: 実際の Flutter プロジェクトで開き、置いた問題を拾う
      — GUI ケース `35-flutter-commands.mjs`（食い違いのある `pubspec` と直書き文言のある `.dart` を置いて開く。Flutter SDK は要らない）

単体テスト: `extensions/nimbus/src/test/depConsistency.test.ts`（7 件）

## 決めなかったこと・やらないこと

- **`pub get` / `pod install` の自動実行** — 時間がかかるうえ、走っているセッションと衝突する
- **Gradle 側の突き合わせ** — Android は同じ形で足せるが、詰まる頻度は iOS のほうが高い
