# Phase 2 確認チェックリスト — IDE 基礎＋GUI 差分レビュー（F-4）

- 実施日: 2026-08-11
- 指示: 「IDE として作成しています。必要な機能を実装してください。」
- 方針: NIMBUS_SPEC.md §9「テスト方針」に従い、自動テスト＋細分化チェックリストの両方を消化する

## 1. 自動テスト

| #   | 項目                          | 結果         | 確認方法                                  |
| --- | ----------------------------- | ------------ | ----------------------------------------- |
| A-1 | vitest 全件パス               | OK (115/115) | GitService 8 件（実 git repo 統合）を追加 |
| A-2 | typecheck / ESLint / Prettier | OK           | エラー・警告 0                            |

## 2. GitService（F-4 コア）

| #   | 項目                                                                    | 結果 | 確認方法               |
| --- | ----------------------------------------------------------------------- | ---- | ---------------------- |
| B-1 | status: リポジトリ判定・ブランチ・変更ファイル一覧（非リポジトリ安全）  | OK   | 実 git repo 統合テスト |
| B-2 | diffFile: 変更・新規・削除の 3 ケースで HEAD/作業ツリー両内容を返す     | OK   | 統合テスト             |
| B-3 | チェックポイント: 作成 → 履歴表示（nimbus-checkpoint 識別）→ 復元で戻る | OK   | 統合テスト             |
| B-4 | 変更なし時のチェックポイント作成はエラー（空コミット防止）              | OK   | 統合テスト             |
| B-5 | revertFile: 追跡ファイルを HEAD へ巻き戻し                              | OK   | 統合テスト             |
| B-6 | セキュリティ: 絶対パス・`../` 脱出の拒否、コミットハッシュ形式検証      | OK   | 統合テスト（負ケース） |

## 3. IDE 基礎・UI

| #   | 項目                                                                         | 結果 | 確認方法                      |
| --- | ---------------------------------------------------------------------------- | ---- | ----------------------------- |
| C-1 | ワークスペースを開く（OS ダイアログ → workspaces 記録 → ステータスバー表示） | OK   | StatusBar＋reviewHandlers     |
| C-2 | 新規セッションがワークスペース cwd で開始                                    | OK   | ChatView（workspace 参照）    |
| C-3 | ビュー切替（コックピット / レビュー / 設定）＋受信箱はレビュー中も表示       | OK   | App / StatusBar               |
| C-4 | 変更ファイル一覧（ステータス表示）→ クリックで Monaco diff（side-by-side）   | OK   | ReviewView                    |
| C-5 | Monaco は CDN 不使用（ESM＋Vite ?worker。§10 検証の方針どおり）              | OK   | monacoSetup.ts                |
| C-6 | ファイル巻き戻し・チェックポイント作成/復元は確認ダイアログ付き（破壊操作）  | OK   | ReviewView（confirm）         |
| C-7 | レビューコメント → そのまま次の指示としてアクティブセッションへ送信          | OK   | ReviewView → sessions.send    |
| C-8 | Electron 非対応の prompt() を使っていない（入力欄方式）                      | OK   | ReviewView（checkpointLabel） |
| C-9 | IPC 入出力すべて zod 検証（git 系 6 チャネル＋workspace）                    | OK   | reviewHandlers                |

## 4. E2E・パッケージ

| #   | 項目                                                         | 結果 | 確認方法                      |
| --- | ------------------------------------------------------------ | ---- | ----------------------------- |
| D-1 | dev E2E: Monaco 組み込み後も全イベント配信・エラー 0         | OK   | 起動ログ                      |
| D-2 | build:mac 成功＋パッケージ版スモーク（実 SDK 疎通＋DB 記録） | OK   | パッケージスモーク（DB 検証） |
| D-3 | コミットごとに push（Public リポジトリ）                     | OK   | git log / origin 同期         |

## NG 記録と再実施

- typecheck: GitService の未使用 import 1 件 → 除去して再実施
- 設計時修正: Electron renderer では `prompt()` が未サポート → チェックポイント名を入力欄方式に変更（C-8）
- **D-1 初回 NG（renderer 全滅を E2E が検出）**: monaco-editor 0.56 は `exports` マップ（`"./*.js" → "./esm/vs/*.js"`）を持ち、従来レシピの `monaco-editor/esm/vs/...?worker` は解決不可 → 正しいサブパス `monaco-editor/editor/editor.worker.js?worker` 形式へ修正し再実施
- **追加修正（E2E ログが実証）**: シャットダウン時に破棄済み renderer への `webContents.send` が throw し、同期 emit 経由で pump を汚染し得る（Phase 0 レビューで棄却された指摘が実際に発生）→ 全 push 送信を `broadcastToWindows`（破棄チェック＋try/catch）に統一
