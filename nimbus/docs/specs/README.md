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
- [`safety.md`](safety.md) — 緊急停止・危険操作の検知・秘匿ファイルの遮断・送信前検査
- [`usage.md`](usage.md) — 使用量（5 時間・週の枠／文脈の消費／費用と上限アラート）
- [`session-activity.md`](session-activity.md) — セッションの中身（サブエージェント・フック・触ったファイル・コンパクション）と通知

IDE 基礎機能:

- [`scratch-files.md`](scratch-files.md) — スクラッチファイル（IntelliJ 由来）

見た目と運用:

- [`themes.md`](themes.md) — Nimbus Dark / Nimbus Light
- [`distribution.md`](distribution.md) — 配布（dmg・ad-hoc 署名）と upstream 追従
- [`quality-commands.md`](quality-commands.md) — ドクター（健康診断）とテストコマンド
- [`pre-send-confirmation.md`](pre-send-confirmation.md) — 着手前の確認（曖昧な指示を止める）

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
