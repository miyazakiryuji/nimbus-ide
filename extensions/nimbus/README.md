# Nimbus 組み込み拡張

Nimbus 独自の機能はすべてこの拡張に入れる。コア（`src/vs/**`）を触らずに済ませることが、
upstream（Code - OSS）への追従コストを抑える唯一の現実的な方法だから。

## 現在の内容

- **`chat.disableAIFeatures` の既定値を `true` に上書き**
  Code - OSS は GitHub Copilot を同梱しており、初回起動で「Sign in to use GitHub Copilot」の
  モーダルが出る。Nimbus は Claude の操縦席なので、この導線は既定で無効にする。
  （`product.json` の `defaultChatAgent` を削除するとワークベンチ自体が起動しないため、
  設定の既定値で無効化するのが正しい経路）

## これから入るもの（F2 以降）

- セッション実行エンジン（Claude Agent SDK）
- 承認インボックス（canUseTool）
- 永続化（イベント・コスト・タスク）
- 並列タスク（worktree × カンバン）
