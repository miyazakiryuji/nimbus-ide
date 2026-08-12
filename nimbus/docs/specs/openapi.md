# スキーマから型を起こす

OpenAPI の `components.schemas` から、Dart / TypeScript の型を作る（T-122）。

## 何を解決するのか

手で書くと必ずずれる。**「存在しないフィールドを叩く」事故はここから生まれる**ので、
スキーマがあるならそこから型を作ってしまうのが確実。

## 振る舞い

コマンド「スキーマから型を起こす」（`nimbus.generateFromSchema`）。

- `*openapi*.json` / `*swagger*.json` を探す。開いている JSON も候補にする
- Dart（Flutter）か TypeScript を選ぶ
- `components.schemas` のオブジェクトから型を起こす
  - 必須・`nullable`・配列・`$ref` を読み分ける
  - **必須でなければ null 許容にする（曖昧なら nullable に倒す）**
  - Dart には `fromJson` も付ける
- **扱えないものは、扱えないと書く** — `oneOf` / `allOf` / `anyOf`、オブジェクト以外。
  半端に出すと、間違った型を信じさせる
- 出力はエディタに開くだけで、**ファイルには書かない**。命名と null の扱いは人が決める

## 設計

- `extensions/nimbus/src/core/openapi.ts` — 解析と生成（VS Code 非依存）
- `extensions/nimbus/src/openapi.ts` — ファイル選択とコマンド

## 受け入れ条件

- [x] 必須・nullable・配列・`$ref` を読み分ける
- [x] 扱えないものを理由つきで示す（型として出さない）
- [x] Dart は必須でなければ `?` を付け、`fromJson` を持つ
- [x] TypeScript は `?` と `| null` を使い分ける
- [x] スキーマが無ければその旨だけを書く
- [ ] 画面確認（実際のスキーマで開く・未実施）

単体テスト: `extensions/nimbus/src/test/openapi.test.ts`（8 件）

## 決めなかったこと・やらないこと

- **YAML の読み込み** — パーサを持ち込むと同梱物が増える。まず JSON から
- **ファイルへの書き出し** — 命名は設計。貼る場所と名前は人が決める
- **`oneOf` / `allOf`** — 表現が言語によって大きく変わる。手で書いたほうが正確
