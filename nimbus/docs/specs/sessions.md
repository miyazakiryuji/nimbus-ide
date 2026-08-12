# セッション実行エンジン

Claude Code のセッションを Nimbus の中で起動・保持・中断する土台（旧 F-1 / フォーク F2）。
コックピット・タスク板・文脈ビューは、すべてここが流すイベントの上に乗っている。

## 何を解決するのか

エージェントを操縦するには「いま何が起きているか」が見えないといけない。ターミナルで
Claude Code を回すと、状態・コスト・どのセッションが何番目のターンかが流れて消える。
ここでは**セッションを構造として持ち**、状態遷移とコストを常に取り出せる形にする。

## 振る舞い

### セッションの生成と多重化

- セッションは最初から `Map` で多重に持つ。シングルトン前提の API を作らない
- Nimbus 内部 ID（`randomUUID`）と Claude 側の `session_id` は**別物として持つ**。
  イベントと永続化のキーは Nimbus 内部 ID。再開時は `reuseSessionId` で引き継げる
- 再開は `resumeClaudeSessionId` を SDK の `options.resume` に渡す。
  再開時は最初のメッセージを送らず、入力待ちで開始する

### 状態

| 状態 | 意味 |
| --- | --- |
| `starting` | 起動中。init メッセージがまだ来ていない |
| `running` | ターンが走っている |
| `awaiting-input` | ターンが終わり、人間の番 |
| `completed` | 入力が閉じられ、クエリが完走した |
| `error` | 例外で終わった |

- `completed` / `error` は終端。終端セッションへの送信は**黙殺せずエラーを返す**
- 「Map にある（`isActive`）」と「いま入力を受け付けられる（`isAccepting`）」は別。
  送信先を決めるときは後者を見る（緊急停止のあとにコックピットへ打った文で落とさないため）
- 中断（`interrupt`）は状態を自分では変えない。中断されたターンの `turn-result` が
  `awaiting-input` へ遷移させる（中間状態を作らない）

### 緊急停止

`nimbus.stopAll`（コマンド「すべてのセッションを止める」）は、全セッションに中断を投げてから
入力を閉じる。**中断は 3 秒で見切り、失敗しても閉じるところまでは必ず進む**（止まらないのが
一番困る）。入力を閉じるだけでは進行中のツール実行が最後まで走ってしまうので、両方やる。
詳細は [safety](safety.md)。

### コスト

`turn-result` の `total_cost_usd` を累積として持つ。ただしクラッシュ系の result はゼロを
載せることがあるため、**単調増加でガードする**（`Math.max`）。

### 課金モード

init メッセージの `apiKeySource` から判定して常時表示する。

| `apiKeySource` | 表示 |
| --- | --- |
| 未取得 | 接続未確認 |
| `oauth` / `none` | サブスク利用（利用上限を消費） |
| それ以外 | API キー利用（従量課金） |

**`none` はサブスク**。型定義の enum には無いが実測で届く。旧 Electron 版はこれを従量課金と
誤表示しており、スクリーンショット検品で見つけて直した経緯がある。ここは戻してはいけない。

### Claude Code 実行ファイルの解決

Nimbus は Claude Code 本体を同梱しない（プラットフォーム別バイナリだけで 280MB あり、
利用者は認証済みのものを既に持っていることがほとんど）。次の順で探す。

1. 設定 `nimbus.claudeCodeExecutable`（明示指定が最優先）
2. SDK 同梱のプラットフォーム別バイナリ（同梱する構成なら効く）
3. `PATH` と、よくあるインストール先（`~/.local/bin` / `~/.claude/local` /
   `/opt/homebrew/bin` / `/usr/local/bin`）

**GUI から起動したアプリの `PATH` はログインシェルと違う**（`.zshrc` が読まれない）ため、
`PATH` だけに頼らない。

## 設計

- `extensions/nimbus/src/session/SessionManager.ts` — セッションの生成・保持・中断・再開
- `extensions/nimbus/src/session/normalize.ts` — SDK メッセージを Nimbus イベントへ正規化
- `extensions/nimbus/src/session/AsyncMessageQueue.ts` — 入力キュー（`prompt` に渡す）
- `extensions/nimbus/src/events.ts` — イベント型（`session-init` / `user-text` / `turn-result` ほか）
- `extensions/nimbus/src/billing.ts` — 課金モードの文言
- `extensions/nimbus/src/claudeExecutable.ts` — 実行ファイルの探索
- `extensions/nimbus/src/cockpit/CockpitViewProvider.ts` — 会話 UI（Webview）

`query()` は `QueryFn` として注入できる。SDK を起動せずに状態機械を検証するため。

## 受け入れ条件

- [x] 複数セッションを同時に持てる（Map・ID 衝突時はエラー）
- [x] 終端セッションへの送信がエラーになる
- [x] 中断後にコックピットへ入力しても落ちない（`isAccepting` で判定）
- [x] 緊急停止が、中断に失敗しても入力を閉じるところまで進む
- [x] 累計コストが減らない
- [x] `apiKeySource='none'` がサブスク表示になる
- [x] 実行ファイルが設定 → 同梱 → PATH/既知ディレクトリの順で解決される

確認記録: `nimbus/docs/testing/f2-extension.md`

## 決めなかったこと・やらないこと

- **Claude Code の同梱** — 280MB あり、利用者は認証済みのものを持っていることが多い
- **`interrupted` という状態を持つこと** — 遷移が不安定になるため、`turn-result` に委ねる
- **セッションの永続化（DB）** — フォークにはまだ無い。過去ログの検索は `tasks.md` T-034 で、
  Claude Code 本体が `~/.claude/projects/**` に残す JSONL を読む線を先に調べる
