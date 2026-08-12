# スタックトレースから開く

貼られた例外ログから、直すべき場所へ着地する（T-105）。

## 何を解決するのか

ログを見てから自分でファイルを探して開く往復が、毎回いちばん時間を食う。
**貼った時点で該当行まで行ける**ようにする。

## 振る舞い

コマンド「スタックトレースから開く」（`nimbus.openFromStackTrace`）。

- **選択範囲があればそれを、無ければクリップボード**を読む
- 対応する形式
  - Dart / Flutter — `#0      MyApp.build (package:app/ui/home.dart:42:7)`
  - JavaScript / TypeScript — `at handle (/repo/src/handler.ts:10:5)` / 関数名なしの行
  - 素の位置表記 — `file:///repo/lib/main.dart:7:3`
- **自分のコードの一番上のフレーム**をまず開く。ライブラリの中で落ちていても、直せるのは
  たいてい自分の側。自分のコードが 1 つも無ければ先頭を開く
- 残りのフレームは QuickPick で選べる（原因が 1 つ下にいることも多い）
- `package:<自分のパッケージ>/…` は `lib/…` に寄せて開く（`pubspec.yaml` の `name` で判断）。
  他人のパッケージは寄せない（当てずっぽうで開かない）
- 実在するファイルだけを候補にする
- 同じ場所が何度も出る（再スロー）ときは 1 度だけ

「自分のコードでない」と見なすもの: `node_modules/` / `.pub-cache/` / `dart:` / `package:flutter/` /
`node:internal/` / `.dart_tool/` / `out/` / `dist/`。

## 設計

- `extensions/nimbus/src/core/stackTrace.ts` — 解析・判定（VS Code 非依存）
- `extensions/nimbus/src/stackTrace.ts` — ファイルの解決とエディタ操作

## 受け入れ条件

- [x] Dart / JS のトレースから関数名と位置を拾う
- [x] 自分のコードの一番上を選ぶ／無ければ先頭
- [x] 同じ場所を重複させない
- [x] `package:` を自分のパッケージのときだけ `lib/` に寄せる
- [x] 実在しないファイルを候補にしない
- [ ] 画面確認（実際の例外ログを貼って開く・未実施）

単体テスト: `extensions/nimbus/src/test/stackTrace.test.ts`（8 件）

## 決めなかったこと・やらないこと

- **原因の推測** — ここは「どこで落ちたか」に着地する道具。なぜ落ちたかはセッションに聞く
- **ソースマップの解決** — 圧縮された JS は対象外。まず素の出力から
