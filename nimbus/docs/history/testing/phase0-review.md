# Phase 0 敵対的コードレビュー記録（Step 1-2 完了時点）

- 実施日: 2026-08-11
- 方式: 3 視点（正しさ/並行性・セキュリティ §6・スペック適合）の並列レビュー → 検出事項ごとに別エージェントが実コードで敵対的検証（refute を試みる）
- 結果: 検出 14 件中 **確定 11 件 / 棄却 3+2 件**。セキュリティ視点の検出は全件棄却（= §6 違反なし）

## 確定事項と修正

| #   | 深刻度 | 内容                                                                                              | 修正                                                                                                                                                            |
| --- | ------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | major  | 終了済みセッションへの sendMessage がメッセージを黙って失い、status が 'running' に固着           | pump() の finally でキューを close。sendMessage は terminal/closed 状態で例外（IPC エラーとして renderer に届く）。push 成功後に user-text を記録する順序に変更 |
| 2   | major  | エラー系 result（error_during_execution 等）の累積コスト/usage を捨てていた → 課金表示が過少に    | normalize が全 result サブタイプでコスト/usage を写像。ゼロ載せクラッシュ result への単調増加ガードを SessionManager / store 両方に追加                         |
| 3   | major  | リロード/ウィンドウ再作成で store が空になり、既存セッションを孤児化して重複セッションを生成      | mount 時に list() で hydrate（zod 検証付き）。非 terminal の最新セッションへ自動再アタッチ。hydrate 完了まで送信ボタン無効                                      |
| 4   | major  | list() 応答が zod 未検証（§3 原則 2 違反）                                                        | main 側 `z.array(sessionSummarySchema).parse`＋renderer 側 safeParse                                                                                            |
| 5   | minor  | resume 時の履歴リプレイ（SDKUserMessageReplay）が新規 tool-result として再流出                    | normalize で `isReplay: true` を除外（履歴表示は Step 3 の永続化層が担当）                                                                                      |
| 6   | minor  | セッションの close が IPC 未配線・アプリ終了時にサブプロセス解放なし                              | session:close チャネル追加、app before-quit で closeAll()                                                                                                       |
| 7   | minor  | 'interrupted' status が不安定（即座に上書き or 固着）                                             | interrupt() は status を変更せず、turn-result 駆動の遷移に一本化                                                                                                |
| 8   | minor  | handleInterrupt が未捕捉 promise rejection                                                        | try/catch＋UI エラー表示（handleSend も UI エラー表示を追加）                                                                                                   |
| 9   | minor  | events.ts / normalize.ts のコメントが usage を「累積」と誤記（実際は per-turn・メインループのみ） | コメント修正（正確な集計は将来 modelUsage を使う旨も明記）                                                                                                      |

（#1 は concurrency/spec 両視点で検出の重複、#2 も同様。実修正は上記 9 系統）

## 棄却された指摘（敵対的検証で refute）

- 「クローズ中ウィンドウへの broadcast が pump を壊す」「user-text が push 失敗前に記録される」（concurrency）— 実コードで再現不能と判定（後者は修正 #1 の順序変更で予防的に解消済み）
- セキュリティ 3 件（ナビゲーションガード・openExternal・cwd 検証）— 現行コードでは失敗シナリオが成立しないと判定。ただし cwd 検証と will-navigate ガードは Step 4（接続設定）で防御的に追加予定

## 修正後の再検証

- ユニットテスト 25 件パス（SessionManager ライフサイクル回帰テスト 7 件を新規追加）
- 実 SDK 統合テスト再実行: パス（6.5s）
- E2E スモーク再実行: パス（renderer への全イベント配信・hydration エラーなし・sandbox フラグ維持）
