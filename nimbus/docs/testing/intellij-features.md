# IntelliJ IDEA 由来の IDE 基礎機能 確認チェックリスト（T-033 / T-224〜T-231）

- 実施日: 2026-08-13
- 対象: スクラッチファイル・マクロ・Search Everywhere・ブックマーク・Run Anything・
  Command completion・構造検索・依存構造マトリクス・Productivity Guide
- 仕様: 各機能の `../specs/<機能名>.md`
- 実行環境: Node 24 は `10_products/.toolchain/node-v24.18.0-darwin-arm64/bin` にある。
  シェル既定の Node 22 では `npm run test-node` が起動を拒否するので、PATH の先頭に足すこと
  （`bash nimbus/scripts/test.sh unit` は自動で行う）

## 1. 自動テスト

| # | 項目 | 結果 |
| --- | --- | --- |
| A-1 | `npm run typecheck-client`（`src/` 全体） | OK (0 errors) |
| A-2 | リポジトリ全体の単体テスト | **OK (13,231 passing / 0 failing / 191 pending)** |
| A-3 | 追加した単体テスト | OK (56 件) |
| A-4 | 導入前の基準値 | 13,177 passing / 0 failing |

内訳: スクラッチ 5・マクロ 6・Search Everywhere 8・ブックマーク 9・Run Anything 5・
Command completion 3・構造検索 9・DSM 7・Productivity Guide 7。

> **既存機能を壊していないこと**は A-4 との差で確認している。増えた 54 件は
> すべて新規テストで、既存テストの失敗はゼロ。

### 並行ビルドとの競合について

作業中に一度 41 件の失敗が出たが、いずれもフィクスチャファイルを読むテスト
（`detectBOM` / `keyboardMapper` / `checksum` など）で、**別セッションのビルドと
`transpile-client` の `out` クリーンが競合したもの**だった。再実行で 0 件に戻ることを確認済み。
複数セッションで作業しているときにテストが落ちたら、まず単独で再実行すること。

## 2. 画面確認（未実施）

`npm run watch-client` でセッションウィンドウを起動して確認する。
各機能の詳細な受け入れ条件は仕様書の「受け入れ条件」節にある。

| # | 機能 | 最小の確認 | 結果 |
| --- | --- | --- | --- |
| B-1 | スクラッチファイル | `Cmd+Alt+Shift+S` → 言語選択 → 空ファイルが開く | 未 |
| B-2 | マクロ | 記録開始でステータスバーに手数が出る／再生で同じ編集が起きる | 未 |
| B-3 | Search Everywhere | **Shift 2 回**で開く／`2+3*4` が `14` になる | 未 |
| B-4 | Search Everywhere | 大文字を続けて打っても開かない | 未 |
| B-5 | ブックマーク | `Cmd+Alt+Shift+B` でガターに印／ニーモニックの文字が出る | 未 |
| B-6 | Run Anything | `Cmd+Alt+Shift+R` → `ls -la` でターミナルが開いて実行される | 未 |
| B-7 | Command completion | エディタで `.` を打つとアクションが候補に出る／選ぶと `.` が消える | 未 |
| B-8 | Command completion | `0..10` では候補が出ない（通常補完を潰していない） | 未 |
| B-9 | 構造検索 | `foo($x$)` が `foo(bar(1, 2))` 全体に当たる／置換が Undo 一回で戻る | 未 |
| B-10 | DSM | レポートが開き、循環が名指しされる／桁が揃っている | 未 |
| B-11 | Productivity Guide | 使った回数が出る／未使用のキーバインドが列挙される | 未 |
| B-12 | 全機能 | Nimbus Dark / Light の両方で配色が破綻しない | 未 |
| B-13 | 全機能 | 既存のコマンド・キーバインドを奪っていない | 未 |

### キーバインドの衝突確認（静的には確認済み）

| キー | 機能 | 状態 |
| --- | --- | --- |
| `Cmd+Alt+Shift+S` | スクラッチファイル新規 | 衝突なし |
| `Cmd+Alt+Shift+B` | ブックマーク切替 | 衝突なし |
| `Cmd+Alt+Shift+R` | Run Anything | 衝突なし |
| `Cmd+Alt+O` | Search Everywhere | **`remoteIndicator`（Show Remote Menu）と重複**。
  セッションウィンドウで remote indicator が出るかは画面確認で見る。
  主たる入口は Shift 2 回なので実害は小さいが、出るようなら振り直す |

## 3. パッケージ版スモーク（未実施）

`npm run build:mac` 相当でパッケージし、`.app` から起動して B-1 / B-3 / B-6 / B-10 を再確認する。
