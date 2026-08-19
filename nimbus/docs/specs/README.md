# 仕様書

Nimbus の**現行**仕様を機能ごとに 1 ファイルで置く場所です。ここが「今どう動くべきか」の正本。

- 実装を変えたら、**同じコミットで**該当ファイルを直す（README「実装したら仕様書を直す」）
- 過去の経緯・当時の指示書は `../history/`、確認記録は `../testing/`。**混ぜない**
- ファイル名は機能名の kebab-case（例: `parallel-tasks.md`）。`tasks.md` の該当タスクからリンクする

## 一覧

エージェントの操縦（Nimbus 本体）:

- [`sessions.md`](sessions.md) — セッション実行エンジン・状態・コスト・課金モード・実行ファイル解決
- [`approvals-and-diff.md`](approvals-and-diff.md) — 承認（`canUseTool`）と、承認前の差分
- [`context-view.md`](context-view.md) — いま Claude に渡っている前提の一覧
- [`claude-md.md`](claude-md.md) — CLAUDE.md のタブ（階層別の一覧・節単位で開く・ひな形から足す）
- [`parallel-tasks.md`](parallel-tasks.md) — 並列タスク（worktree × カンバン）
- [`skills-and-help.md`](skills-and-help.md) — スキルの一覧・検索とヘルプ（ゆあ）
- [`protected-paths.md`](protected-paths.md) — 読ませたくないファイルを画面から指定する
- [`safety.md`](safety.md) — 緊急停止・危険操作の検知・秘匿ファイルの遮断・送信前検査
- [`review-comments.md`](review-comments.md) — レビューコメントの取り込み
- [`pr-description.md`](pr-description.md) — PR の説明文の下書き
- [`branch-health.md`](branch-health.md) — ブランチの離れ具合と衝突の予告
- [`code-health.md`](code-health.md) — 命名のゆれとそっくりな実装
- [`review-progress.md`](review-progress.md) — レビューの進み（どこまで見たか）
- [`change-stats.md`](change-stats.md) — 変更のようす（統計とテスト有無）
- [`release-notes.md`](release-notes.md) — リリースノートの下書き
- [`build-metrics.md`](build-metrics.md) — ビルド時間と成果物の大きさの変化
- [`sql-safety.md`](sql-safety.md) — SQL を流す前に見る
- [`schema-diff.md`](schema-diff.md) — マイグレーションを起こす
- [`preflight.md`](preflight.md) — 出す前に
- [`cpu-profile.md`](cpu-profile.md) — 計測結果を渡す
- [`terminal-layout.md`](terminal-layout.md) — ターミナルを並べる
- [`plugins.md`](plugins.md) — プラグインを見る
- [`gif-export.md`](gif-export.md) — 作業の様子を GIF にする
- [`notarization.md`](notarization.md) — 公証（notarization）
- [`skill-package.md`](skill-package.md) — スキルを配れる形にする
- [`voice-input.md`](voice-input.md) — 声で指示する
- [`api-check.md`](api-check.md) — 実物との突き合わせと仮の応答
- [`openapi.md`](openapi.md) — スキーマから型を起こす
- [`platform-channel.md`](platform-channel.md) — Dart とネイティブの橋渡しの突き合わせ
- [`flutter-lint.md`](flutter-lint.md) — Flutter の確認（文言・読み上げ）
- [`licenses.md`](licenses.md) — 依存のライセンス
- [`vuln-fix.md`](vuln-fix.md) — 脆弱性の警告を直す順に
- [`dep-audit.md`](dep-audit.md) — 依存を足す前に見る
- [`dep-consistency.md`](dep-consistency.md) — 依存の食い違い（pub get / pod install）
- [`xcode-conflict.md`](xcode-conflict.md) — Xcode プロジェクトの衝突を解く
- [`mobile-checks.md`](mobile-checks.md) — 提出前の確認（iOS の権限・プライバシー）
- [`bisect.md`](bisect.md) — どこで壊れたかを絞り込む
- [`stack-trace.md`](stack-trace.md) — スタックトレースから該当箇所を開く
- [`lock-diff.md`](lock-diff.md) — ロックファイルの変更を読む
- [`schedule.md`](schedule.md) — 寝る前に仕込む（予約実行）
- [`ci-repro.md`](ci-repro.md) — CI を手元で再現する
- [`env-check.md`](env-check.md) — 環境の食い違い
- [`setup.md`](setup.md) — 使い始めの設定（言語別プリセット）
- [`sandbox.md`](sandbox.md) — 練習用サンドボックス
- [`rhythm.md`](rhythm.md) — いまのようす（区切りと待ち時間）
- [`mermaid.md`](mermaid.md) — Mermaid の図を確かめる
- [`replay.md`](replay.md) — セッションをたどり直す（間隔つき）
- [`explain.md`](explain.md) — 何をしたかを並べ直す（解説モード）
- [`share-session.md`](share-session.md) — やり取りを人に見せる
- [`highlights.md`](highlights.md) — やり取りの切り出し（教材用）
- [`prompt-stats.md`](prompt-stats.md) — 指示の出しかた（言い直しの傾向）
- [`digest.md`](digest.md) — ふりかえり（週次ダイジェスト・成長ログ）
- [`usage.md`](usage.md) — 使用量（5 時間・週の枠／文脈の消費／費用と上限アラート）
- [`session-activity.md`](session-activity.md) — セッションの中身（サブエージェント・フック・触ったファイル・コンパクション）と通知
- [`checkpoints-and-mcp.md`](checkpoints-and-mcp.md) — チェックポイントの巻き戻しと MCP サーバーの管理
- [`transcript-search.md`](transcript-search.md) — 過去セッションの横断検索
- [`completion-evidence.md`](completion-evidence.md) — 証跡つき完了報告（テスト実行の有無と成否）
- [`images-and-hot-reload.md`](images-and-hot-reload.md) — 画像の投入とホットリロード連携
- [`context-control.md`](context-control.md) — 文脈の制御（ピン留め・予算・効率）
- [`parallel-awareness.md`](parallel-awareness.md) — 並列セッションの見える化（誰が何を触っているか）
- [`session-lifecycle.md`](session-lifecycle.md) — セッションの始め方・分けかた・戻しかた
- [`tasks-board-link.md`](tasks-board-link.md) — tasks.md とタスク板の対応づけ・待機列の優先度
- [`agent-models.md`](agent-models.md) — サブエージェントごとのモデル指定
- [`tree-views.md`](tree-views.md) — ツリービューの共通土台
- [`prompts-and-find.md`](prompts-and-find.md) — 定型プロンプトと横断的な「探す」
- [`session-extras.md`](session-extras.md) — スキル化・預かり箱・ピン留めとタグ
- [`hooks.md`](hooks.md) — フックの組み立てとドライラン
- [`settings-and-bundle.md`](settings-and-bundle.md) — 設定タブと設定のパッケージ配布
- [`audit-and-timeline.md`](audit-and-timeline.md) — 監査ログ・時系列ビューア・アンビエント表示
- [`dialogue.md`](dialogue.md) — 見積もりと、頼みかたの型
- [`workflow-and-team.md`](workflow-and-team.md) — 流れに沿って進める・解説モード・チーム設定の同期
- [`evaluation.md`](evaluation.md) — スキル・プロンプトの評価（回帰・ブレ幅・モデル比較）
- [`authoring.md`](authoring.md) — スキル・サブエージェント・コマンドを書く支援
- [`persona-and-turns.md`](persona-and-turns.md) — 話しかた・状態の色・書く番
- [`local-and-recovery.md`](local-and-recovery.md) — ローカル完結・集中モード・立て直し
- [`migration-and-crashlog.md`](migration-and-crashlog.md) — ワンクリック導入・実機ログ
- [`japanese-and-history.md`](japanese-and-history.md) — 日本語の指示の補助・設定の世代・週のふりかえり

IDE 基礎機能:

- [`scratch-files.md`](scratch-files.md) — スクラッチファイル（IntelliJ 由来）

見た目と運用:

- [`themes.md`](themes.md) — Nimbus Dark / Nimbus Light
- [`distribution.md`](distribution.md) — 配布（dmg・ad-hoc 署名）と upstream 追従
- [`quality-commands.md`](quality-commands.md) — ドクター（健康診断）とテストコマンド
- [`pre-send-confirmation.md`](pre-send-confirmation.md) — 着手前の確認（曖昧な指示を止める）
- [`assumptions.md`](assumptions.md) — 置いた仮定の表示
- [`views-layout.md`](views-layout.md) — 画面の置きかた（サイドバー・パネル・コマンド）
- [`workspace-trust.md`](workspace-trust.md) — 信頼していないフォルダでの振る舞い
- [`display-language.md`](display-language.md) — 表示言語（既定を日本語にする）

## 索引の追補（2026-08-19 の棚卸し・T-281）

実装が先に進んで索引から漏れていた 68 本。上の一覧と同じ「今どう動くべきか」の正本です。

セッションの土台・並列・画面（追補）:

- [`approval-in-conversation.md`](approval-in-conversation.md) — 承認を会話の中で受ける
- [`cockpit-chat.md`](cockpit-chat.md) — コックピットの作り（VS Code のチャットに寄せる）
- [`cockpit-fullscreen.md`](cockpit-fullscreen.md) — 全画面のコックピットと、セッションのタブ、右半分
- [`debug-tools.md`](debug-tools.md) — デバッガ連携（T-104）
- [`debug-view.md`](debug-view.md) — デバッグ面（詰まったときに見るもの）
- [`decisions.md`](decisions.md) — 決めたことを残す（ADR）（T-060）
- [`editor-tabs.md`](editor-tabs.md) — コックピットとタスク板をエディタタブで開く
- [`headless-and-mcp-tools.md`](headless-and-mcp-tools.md) — ヘッドレス実行と MCP ツールの単体実行
- [`herdr.md`](herdr.md) — Herdr のセッションを読む
- [`import-rules.md`](import-rules.md) — 他のツールの設定を取り込む（T-068）
- [`localization.md`](localization.md) — 多言語化（T-091）
- [`managed-policy-and-plugins.md`](managed-policy-and-plugins.md) — 組織ポリシーとプラグイン API
- [`market.md`](market.md) — 共有マーケット — 入れる側（T-070）
- [`memory-and-startup.md`](memory-and-startup.md) — メモリの増え方と、起動時間
- [`monorepo-scope.md`](monorepo-scope.md) — モノレポのスコープ切り替え（T-078）
- [`permission-rules.md`](permission-rules.md) — 承認ルールの編集
- [`regression-guard.md`](regression-guard.md) — 直したものが戻らないようにする
- [`remote-approval.md`](remote-approval.md) — 手元の端末から承認だけする
- [`session-registry.md`](session-registry.md) — セッションの台帳（持ち主・横断の上限・続きから・場所の重なり）
- [`session-repeats.md`](session-repeats.md) — 走っている最中に繰り返しに気づく（T-237）
- [`session-sync.md`](session-sync.md) — マシンをまたいでセッションを続ける
- [`signature-attachment.md`](signature-attachment.md) — 型定義とバージョンの自動添付（T-175 / T-083）
- [`task-board-shared.md`](task-board-shared.md) — 板をウィンドウ横断で持つ（担当・進捗・点検）
- [`version-watch.md`](version-watch.md) — Claude Code の更新に気づく（T-094）
- [`workspace-roots.md`](workspace-roots.md) — マルチルートワークスペース対応（T-173）

Git とレビュー（追補）:

- [`archaeology.md`](archaeology.md) — なぜこうなっているのかを辿る（T-079）
- [`ci-failure.md`](ci-failure.md) — 落ちた CI を調べる（T-131）
- [`codeowners.md`](codeowners.md) — コードオーナーへの通知
- [`commit-split.md`](commit-split.md) — コミットの分けかたの提案
- [`conflicts.md`](conflicts.md) — コンフリクトの解決を手伝う
- [`diff-summary.md`](diff-summary.md) — 変更の要約（差分の見取り図）
- [`equivalence.md`](equivalence.md) — 移行前後の等価性確認（T-179）
- [`error-monitor.md`](error-monitor.md) — 監視ツールの障害を取り込む
- [`impact-preview.md`](impact-preview.md) — 変更の影響範囲
- [`pr-review.md`](pr-review.md) — PR レビューの取り込み
- [`pr-stack.md`](pr-stack.md) — 積み上げた PR
- [`repo-summary.md`](repo-summary.md) — リポジトリの構造要約カード（T-176）
- [`rollback-and-hotfix.md`](rollback-and-hotfix.md) — 戻す道と、急ぐ道
- [`schema-impact.md`](schema-impact.md) — 型の変更が壊す場所を洗い出す（T-123）
- [`snapshot-review.md`](snapshot-review.md) — スナップショットの更新レビュー（T-181）
- [`wiki-export.md`](wiki-export.md) — 社内 Wiki / Notion へ出す

IDE 基礎機能（追補）:

- [`bookmarks.md`](bookmarks.md) — ブックマーク（ニーモニック付き）
- [`command-completion.md`](command-completion.md) — Command completion（ドットから IDE アクション）
- [`dependency-matrix.md`](dependency-matrix.md) — 依存構造マトリクス（DSM）
- [`editor-actions.md`](editor-actions.md) — エディタから直接頼む（T-171 / T-172）
- [`macros.md`](macros.md) — マクロ（記録・再生）
- [`productivity-guide.md`](productivity-guide.md) — Productivity Guide
- [`run-anything.md`](run-anything.md) — Run Anything
- [`search-everywhere.md`](search-everywhere.md) — Search Everywhere
- [`structural-search.md`](structural-search.md) — 構造検索・置換（SSR）

コードを読む・直す・確かめる（追補）:

- [`agent-compare.md`](agent-compare.md) — 別のツールの結果と並べて比べる
- [`api-docs.md`](api-docs.md) — 古くなった API ドキュメントを探す（T-209）
- [`benchmark.md`](benchmark.md) — 改善前後のベンチ比較
- [`clipboard-hints.md`](clipboard-hints.md) — コピーしたエラー文に気づく（T-170）
- [`conventions.md`](conventions.md) — プロジェクト固有の書き方（T-103）
- [`flaky-tests.md`](flaky-tests.md) — 不安定なテストの検出
- [`lsp-tools.md`](lsp-tools.md) — LSP をエージェントのツールにする（T-098）
- [`mutations.md`](mutations.md) — テストが守っているかを確かめる（T-182）
- [`notebooks.md`](notebooks.md) — ノートブック（`.ipynb`）対応（T-174）
- [`refactor-progress.md`](refactor-progress.md) — 段階的リファクタの進捗管理と一括変更（T-111 / T-110）
- [`repro-test.md`](repro-test.md) — 再現手順の生成
- [`reverse-spec.md`](reverse-spec.md) — コードから仕様書を起こす（T-080）
- [`simulator.md`](simulator.md) — シミュレータ操作
- [`snippets.md`](snippets.md) — スニペット化（T-177）
- [`terminal-capture.md`](terminal-capture.md) — ターミナル出力の自動キャプチャ（T-169 / T-106）
- [`test-runner.md`](test-runner.md) — テストランナー連携（T-039 / T-108 / T-109）
- [`verify-edits.md`](verify-edits.md) — 生成直後の型検証と自動ループ（T-101 / T-102）
- [`widget-tests.md`](widget-tests.md) — Widget テスト / ゴールデンテストの生成

旧 Electron 実装向けの指示書は `../history/NIMBUS_SPEC.md`、確認記録は `../testing/` にあります。

## テンプレート

```markdown
# <機能名>

## 何を解決するのか
利用者の困りごとを 1〜3 行。実装の説明ではなく、なぜ在るのか。

## 振る舞い
利用者から見た動き。設定・既定値・UI の場所。エラー時と権限が無いときの挙動も書く。

## 設計
どこに実装があるか（`extensions/nimbus/src/...`）。コアに触る場合は `core-changes.md` の該当項目へリンク。

## 受け入れ条件
- [ ] 確認できる形で列挙する（`../testing/` の記録と対応させる）

## 決めなかったこと・やらないこと
理由つきで。同じ議論を蒸し返さないため。
```
