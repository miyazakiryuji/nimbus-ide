# Phase 3 確認チェックリスト — worktree×カンバン（F-5）＋SCM＋診断ビュー

- 実施日: 2026-08-11
- 方針: NIMBUS_SPEC.md §9「テスト方針」に従い、自動テスト＋細分化チェックリストの両方を消化する

## 1. 自動テスト

| #   | 項目                          | 結果         | 確認方法                                                                 |
| --- | ----------------------------- | ------------ | ------------------------------------------------------------------------ |
| A-1 | vitest 全件パス               | OK (143/143) | WorktreeManager・TaskService・LogBuffer・GitService SCM に回帰テスト追加 |
| A-2 | typecheck / ESLint / Prettier | OK           | エラー・警告 0                                                           |

## 2. F-5 カンバン（タスク＝worktree＝セッション 1:1:1）

| #    | 項目                                                                                                      | 結果 | 確認方法                           |
| ---- | --------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------- |
| B-1  | タスク作成で `git worktree add`＋`nimbus/<slug>` ブランチ自動作成                                         | OK   | WorktreeManager 実 git テスト      |
| B-2  | worktree は ~/.nimbus/worktrees 配下（ユーザーのリポジトリを汚さない）                                    | OK   | WorktreeManager テスト             |
| B-3  | セッションは worktree を cwd に開始（多重セッションの分離 §3 原則 5）                                     | OK   | TaskService テスト                 |
| B-4  | カンバン 5 列: 待機中/実行中/承認待ち/レビュー待ち/完了                                                   | OK   | 状態遷移テスト＋BoardView          |
| B-5  | 承認保留 → 承認待ち列へ、解消 → 実行中へ（受信箱との連動）                                                | OK   | TaskService テスト                 |
| B-6  | ターン完了 → レビュー待ちへ                                                                               | OK   | TaskService テスト                 |
| B-7  | **同時実行上限**（maxConcurrentSessions・既定 3）: 超過は待機、空きで自動開始                             | OK   | TaskService テスト                 |
| B-8  | 完了: 実行中は中断→未コミット成果を**ブランチへ WIP 自動コミット保存**→破棄（データ消失を防止）＋確認付き | OK   | WorktreeManager/TaskService テスト |
| B-9  | 再起動復元: 実行系状態は「レビュー待ち」へ・done/pending 維持                                             | OK   | TaskService テスト                 |
| B-10 | セッション横断イベントフィード（全セッション直近 30 件）                                                  | OK   | BoardView                          |
| B-11 | tasks の永続化（migration v2・サニタイザ経由）                                                            | OK   | schema/Store                       |
| B-12 | 管理外ディレクトリの worktree 破棄を拒否（安全ガード）                                                    | OK   | WorktreeManager テスト             |

## 3. SCM（Git ツリー）＋コミット自動生成（ユーザー要望）

| #   | 項目                                                                       | 結果 | 確認方法                            |
| --- | -------------------------------------------------------------------------- | ---- | ----------------------------------- |
| C-1 | ステージ済み/変更の 2 セクション・ファイル単位＋一括の stage/unstage       | OK   | GitService テスト＋UI               |
| C-2 | コミット（ステージ済みのみ・空ステージはエラー）                           | OK   | GitService テスト                   |
| C-3 | ✨自動生成: staged 優先の diff から Conventional Commits メッセージ生成    | OK   | commitMessage.ts（実走は E2E 手動） |
| C-4 | 生成は履歴を汚さない（persistSession:false・ツールなし・設定読み込みなし） | OK   | commitMessage.ts 実装               |
| C-5 | stage 系のパス脱出拒否                                                     | OK   | GitService テスト                   |

## 4. 診断ビュー（ユーザー要望）

| #   | 項目                                                                            | 結果 | 確認方法          |
| --- | ------------------------------------------------------------------------------- | ---- | ----------------- |
| D-1 | 環境情報（バージョン・パス・プロファイル・バイナリ）表示                        | OK   | diagHandlers＋UI  |
| D-2 | ログはサニタイザ通過後に記録（issue にそのまま貼れる §6-2/6-3）                 | OK   | LogBuffer テスト  |
| D-3 | ログのホームパスを ~ に置換（OS ユーザー名の漏洩防止）                          | OK   | sanitizer テスト  |
| D-4 | リングバッファ（容量超過で古い順破棄）・コピー・クリア                          | OK   | テスト＋UI        |
| D-5 | Electron のクラッシュダイアログを抑止しない（uncaughtException を横取りしない） | OK   | LogBuffer.install |

## 5. E2E・パッケージ

| #   | 項目                                              | 結果 | 確認方法                |
| --- | ------------------------------------------------- | ---- | ----------------------- |
| E-1 | dev E2E: 5 ビュー構成でも全イベント配信・エラー 0 | OK   | 起動ログ                |
| E-2 | 敵対的レビュー → 確定事項の修正                   | 実施 | 下記 NG 記録            |
| E-3 | build:mac＋パッケージ版スモーク → v0.3.0 リリース | OK   | リリースページ・DB 検証 |

## 6. 敵対的レビュー（27 エージェント）確定事項の修正

diff v0.2.0..HEAD を 3 視点でレビュー→検証。**critical 1・major 4・minor 多数**を確定し修正：

| 深刻度       | 内容                                                                                                         | 修正                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| **critical** | 完了時 `worktree remove --force` が Claude の未コミット成果を無警告で消す（UI は「ブランチに残る」と誤表示） | 削除前に未コミット変更をタスクブランチへ **WIP 自動コミット**して保存。完了確認文言も実態に修正 |
| major        | startTask に in-flight ガードなし → 同一タスクの二重セッション・上限超過                                     | await 前に同期の `starting` セットでマーク。回帰テスト追加                                      |
| major        | 完了時に実行中セッションを中断せず、消した worktree で CLI が動き続ける                                      | 削除前に interrupt→close                                                                        |
| major        | ReviewView が worktree を対象にできない（`workspace ?? session.cwd`）                                        | アクティブセッションの cwd を優先に変更                                                         |
| major        | LogBuffer が uncaughtException を横取りし Electron のクラッシュダイアログを抑止                              | process ハンドラ登録を廃止（console パッチのみ）                                                |
| minor        | SCM の `git add` に `--` なし／unstage が unborn HEAD で失敗／競合ファイルの誤分類                           | `add --`・`reset` へ変更・競合を別セクション化                                                  |
| minor        | 診断ログにホームパス（OS ユーザー名）漏洩                                                                    | sanitizer にホーム→`~` 置換を追加                                                               |
| minor        | コミット生成のプロンプトインジェクション                                                                     | sentinel＋データ明示でインジェクション耐性                                                      |
| minor        | 新 IPC の出力側 zod 未検証（diag/taskStart/gitCommit 等）                                                    | 全て出力スキーマ検証を追加                                                                      |
| minor        | createTask が autoStart 失敗で作成ごと失敗／handleStart 未 try-catch／フィード非メモ化                       | それぞれ修正                                                                                    |

棄却: 「isManaged の prefix-sibling」→ 指摘は妥当と判断し予防修正（末尾セパレータ比較）

## NG 記録と再実施

- typecheck: settings スキーマ拡張に伴う ConfigService テスト更新（後方互換の既定値補完テストも追加）
- macOS の /var→/private/var symlink 差異で worktree 一覧比較が不一致 → realpath 比較に修正
- レビュー修正後に全 143 テスト＋lint＋typecheck を再実施し green
