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
- [`api-check.md`](api-check.md) — 実物との突き合わせと仮の応答
- [`openapi.md`](openapi.md) — スキーマから型を起こす
- [`platform-channel.md`](platform-channel.md) — Dart とネイティブの橋渡しの突き合わせ
- [`flutter-lint.md`](flutter-lint.md) — Flutter の確認（文言・読み上げ）
- [`licenses.md`](licenses.md) — 依存のライセンス
- [`dep-consistency.md`](dep-consistency.md) — 依存の食い違い（pub get / pod install）
- [`xcode-conflict.md`](xcode-conflict.md) — Xcode プロジェクトの衝突を解く
- [`mobile-checks.md`](mobile-checks.md) — 提出前の確認（iOS の権限・プライバシー）
- [`bisect.md`](bisect.md) — どこで壊れたかを絞り込む
- [`stack-trace.md`](stack-trace.md) — スタックトレースから該当箇所を開く
- [`lock-diff.md`](lock-diff.md) — ロックファイルの変更を読む
- [`schedule.md`](schedule.md) — 寝る前に仕込む（予約実行）
- [`sandbox.md`](sandbox.md) — 練習用サンドボックス
- [`rhythm.md`](rhythm.md) — いまのようす（区切りと待ち時間）
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

IDE 基礎機能:

- [`scratch-files.md`](scratch-files.md) — スクラッチファイル（IntelliJ 由来）

見た目と運用:

- [`themes.md`](themes.md) — Nimbus Dark / Nimbus Light
- [`distribution.md`](distribution.md) — 配布（dmg・ad-hoc 署名）と upstream 追従
- [`quality-commands.md`](quality-commands.md) — ドクター（健康診断）とテストコマンド
- [`pre-send-confirmation.md`](pre-send-confirmation.md) — 着手前の確認（曖昧な指示を止める）
- [`assumptions.md`](assumptions.md) — 置いた仮定の表示

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
