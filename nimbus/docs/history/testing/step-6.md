# Step 6 確認チェックリスト — コンテキスト可視化（F-2）

- 実施日: 2026-08-11
- 方針: NIMBUS_SPEC.md §9「テスト方針」に従い、自動テスト＋細分化チェックリストの両方を消化する

## 1. 自動テスト

| #   | 項目                          | 結果       | 確認方法                            |
| --- | ----------------------------- | ---------- | ----------------------------------- |
| A-1 | vitest ユニット全件パス       | OK (90/90) | claudeMd 4 件＋sparkline 6 件を追加 |
| A-2 | typecheck / ESLint / Prettier | OK         | エラー・警告 0                      |

## 2. 表示項目（F-2 の指定リスト）

| #   | 項目                                                               | 結果 | 確認方法                        |
| --- | ------------------------------------------------------------------ | ---- | ------------------------------- |
| B-1 | 現在のモデル名                                                     | OK   | ContextPanel（init.model）      |
| B-2 | 有効なツール一覧（件数＋一覧）                                     | OK   | ContextPanel（init.tools）      |
| B-3 | 接続中の MCP サーバー（名前＋status）                              | OK   | ContextPanel（init.mcpServers） |
| B-4 | ロード済みプラグイン / skills（バージョン付き）                    | OK   | ContextPanel（plugins/skills）  |
| B-5 | 適用されている CLAUDE.md の階層（ユーザー / 親 / プロジェクト）    | OK   | findClaudeMdChain＋IPC＋表示    |
| B-6 | 累積コスト（推定値である旨を明記 — §10 検証の注意を反映）          | OK   | ContextPanel                    |
| B-7 | トークン使用量の推移（ターン別バー）＋コスト推移（スパークライン） | OK   | sparkline ヘルパー＋SVG         |
| B-8 | 追加: Claude Code バージョン / 認証ソース / 権限モード / cwd       | OK   | ContextPanel                    |

## 3. 実装品質

| #   | 項目                                                                           | 結果 | 確認方法               |
| --- | ------------------------------------------------------------------------------ | ---- | ---------------------- |
| C-1 | CLAUDE.md 階層検出が純関数（exists 注入）でテスト済み（順序・scope・空ケース） | OK   | claudeMd.test.ts       |
| C-2 | グラフは依存ライブラリなし（正規化・座標変換をユニットテスト）                 | OK   | sparkline.test.ts      |
| C-3 | ContextPanel の状態が sessionId キーの辞書（§3 原則 5）                        | OK   | ContextPanel 目視      |
| C-4 | IPC 入出力 zod 検証（claudeMd リクエスト/レスポンス両方向）                    | OK   | sessionHandlers＋panel |
| C-5 | トークン集計はターン単位 usage（累積でない値）を使用 — §10 検証の意味論どおり  | OK   | ContextPanel 実装      |

## 4. E2E（起動確認）

| #   | 項目                                    | 結果 | 確認方法 |
| --- | --------------------------------------- | ---- | -------- |
| D-1 | Step 6 変更後も全イベント配信・エラー 0 | OK   | 起動ログ |

## NG 記録と再実施

- ESLint `set-state-in-effect` 1 件（セッション切替時の同期クリア）: 正当な指摘。sessionId キーの辞書に変更して同期 setState 自体を排除し、全チェック再実施
