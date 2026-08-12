# Nimbus タスク

Nimbus の「やること」と「やりたいこと」を 1 か所に集めたファイル。**思いついたら、まず Inbox に 1 行足す。**
整えるのは後でよい。ここに無いものは、誰の頭の中にも無いものとして扱う。

## 書きかた（複数の AI が同時に触るための約束）

- **追記はセクションの末尾に、1 タスク 1 行。** 既にある行は書き換えず、状態が変わったら**行ごと別のセクションへ移す**
  — 行単位の変更なら、競合しても機械的にマージできる（→ README「[複数の AI で並行開発する](README.md#複数の-ai-で並行開発する)」）
- **状態は置き場所で表す** — Inbox → 次にやる → 進行中 → 完了。`[x]` は完了の印
- 温めておく場所は 2 つ — **やりたいこと**（① 〜 ⑧ の層。実装の面で分ける）と
  **アイデア（視点別）**（体験・運用の切り口）。どちらか迷うものは Inbox に置いて後で振る
- **ID は `T-001` から通し番号。** コミットメッセージや会話で参照する。欠番は埋めない。
  ID が重複したら、**後からコミットする側が採番し直す**
- **着手するときは 進行中 へ移し、担当と開始日を書く**（例: `@session-a 2026-08-13`）。二重作業はこれで防ぐ
- 優先度は必要なときだけ行末に付ける — `[P1]` 今やる / `[P2]` 次の波 / `[P3]` いつか
- 1 行に収まらなくなったら仕様書（`nimbus/docs/specs/<機能名>.md`）に切り出し、ここからリンクして 1 行に戻す
- 実装したら仕様書も直す（→ README「[実装したら仕様書を直す](README.md#実装したら仕様書を直す)」）

## 選ぶ基準

数が増えるほど、要るのは足す基準ではなく**捨てる基準**。着手を決めるときはこの 3 つで測る。

1. **Claude Code 単体でできることは作らない。** これだけで候補はかなり削れる
2. **VS Code ベースでしか作れないものを優先する** — LSP・デバッガ・テストランナー・Git 統合。
   素の Claude Code では取りづらい情報をエージェントに渡せることが、エディタの上に乗る本質的な価値
3. **自分が毎日使うものから着手する** — Flutter の実務に効くものを先に作ると、開発が続く

## Inbox（未整理）

思いついたことをここへ。整った文章でなくてよい。「〜したい」「〜が気になる」で十分。
優先度や置き場所は後で決める。

- [ ] T-235 繰り返しの検出をセッション中にも効かせる（今は過去の記録を読む形なので、走っている最中には出ない）

- [ ] T-014 ターミナルを**好きな数に分割**できるようにする（4 分割に限らず、必要なだけ並べる）—
      複数エージェントの出力を同時に見たい。VS Code は左右分割とタブはあるが、任意のグリッドは組めない

## 進行中

<!-- 着手したら 次にやる / やりたいこと からこの下へ行ごと移し、担当と開始日を書く -->

- [ ] T-045 解説モード。実装前に claim @session-a 2026-08-13 [P2]
- [ ] T-149 複数ステップのワークフロー定義。実装前に claim @session-a 2026-08-13 [P2]



























- [ ] T-008 / T-009 **CLAUDE.md 専用のタブ** — 実装・単体テスト（10 件全通過）・仕様・確認項目まで完了。
      残るは配線のコミット（`extension.ts` / `package.json` に他セッションの作業が同居しているため待ち）と
      画面確認（`nimbus/docs/testing/claude-md.md` §2）→ 仕様 `nimbus/docs/specs/claude-md.md`
      @yua 2026-08-13 [P2]




## 次にやる


## やりたいこと

構想は **8 つの層**で捉えている — ① オーケストレーション（並列）② コンテキスト可視化 ③ レビュー
④ 制御 ⑤ ラボ ⑥ IDE との統合 ⑦ コードの理解と生成の精度 ⑧ 対話の質。
④ が体験としての差別化、⑥ ⑦ は「フォークにした意味」が出る層、⑧ は事故を防ぐ層。

### コックピットとセッション履歴


### ① オーケストレーション層（並列セッション・ここが主戦場）

Nimbus が狙うのは「1 人の Claude を速く回す」ことではなく、**複数のエージェントで同時に同じプロジェクトを
開発できること**。このセクションの項目は優先して考える。
**worktree の自動切り出しと「1 タスク = 1 セッション」の並列実行、同時実行上限つきのタスクキューは
F4 で実装済み**（`extensions/nimbus/src/tasks/`）。ここに残るのはその先。
（Nimbus 自身を複数の AI で開発するときの作法は README「複数の AI で並行開発する」。こちらは**製品の機能**の話）


### ② コンテキスト可視化層（文脈とコスト）

- [ ] T-008 **CLAUDE.md 専用の編集タブ** — 階層（プロジェクト／親フォルダ／`~/.claude`）のどれでも開いて
      その場で直せる。今は `extensions/nimbus/src/contextView.ts` で「どこにあるか」を見せているだけ [P2]
- [ ] T-009 CLAUDE.md をセクション単位で扱う — 見出しごとに編集し、よく使う節はテンプレートから足せる [P2]

### ③ レビュー層

**承認前に差分エディタで見せる仕組みは F3 で実装済み**（`core/editPreview.ts`）。ここに残るのはその先。

- [ ] T-116 PR レビューの取り込み — レビューコメントを読んで修正し、返信まで下書きする [P2]

### ④ 制御層（Hooks・権限・MCP・設定）

**一番の差別化になりそうな層。**

- [ ] T-028 パーミッションルールの GUI 編集（`settings.json` の allow / deny / ask を画面から）[P2]

- [ ] T-235 MCP ツールの単体実行 — エージェント抜きでツールを 1 回だけ呼んで試す。
      SDK の `Query` に直接呼ぶ API が無く、`@modelcontextprotocol/sdk` で別途繋ぐ必要がある
      （T-042 の残り。接続設定の二重管理になるので設計から）[P2]
### ⑤ ラボ層（スキル・サブエージェント・コマンド）

**スキルの一覧と検索は F6 で実装済み** — サイドバーの「スキル」ビュー（出どころ別に分類・行をクリックで
`SKILL.md` が開く・▶ でコックピットへ `/<name>` を送る）と、見出しの「探す」（曖昧な言葉で絞り込む
QuickPick・説明文にも当たる）。`extensions/nimbus/src/skillsView.ts` と `nimbus.findSkill`。

- [ ] T-030 **フロントマター補完つきエディタ** — Skill / サブエージェント / スラッシュコマンドを書く場所。
      補完・検証つきで、書式ミスで動かない事故を無くす [P2]
- [ ] T-031 **プレビュー実行** — 保存したらすぐ、サンドボックスのセッションで試し打ちできる [P2]
- [ ] T-032 プラグインのインストールと有効／無効の切り替え [P3]
- [ ] T-165 **自作スキルの回帰テスト** — 更新後も過去の成功ケースが通るか自動で確かめる [P2]
- [ ] T-166 ブレ幅の測定 — 同じ課題を複数回走らせて、プロンプトの安定性を数字にする [P2]
- [ ] T-167 モデル切り替えの比較 — 軽いモデルで足りるタスクを見つける（T-232 と対）[P2]

### ⑥ IDE との統合（フォークにした旨味が出る場所）

（Inbox の T-014「ターミナルの多分割」もこの層の話。整理したらここへ移す）
- [ ] T-170 エラー文をコピーした瞬間に「調べます？」と提案する（オフにできること）[P3]
- [ ] T-173 マルチルートワークスペース対応 [P2]
- [ ] T-174 ノートブック（`.ipynb`）対応 [P3]

### ⑦ コードの理解と生成の精度（エンジン側）

UI ではなく「**エージェントがどれだけ正確に読めて、正確に書けるか**」の層。
LSP・型情報・デバッガ・テストはフォークならプロセス内にあるので、ここは ⑥ と地続き。

**読ませる**


**書かせる**


**デバッグ**


**動作確認**


**リファクタ・移行**


### ⑧ 対話の質（人間とエージェントの間）

**「何を作るか」ではなく「どう頼むか／どう返すか」の層。** ここが弱いと、他が良くても事故る。

- [ ] T-190 交代モード — 人間が書く番／エージェントが書く番を明示的に切り替える [P3]
- [ ] T-191 肩越しモード — 自分が書く横で待機し、必要なときだけ口を出す [P3]

### IntelliJ IDEA 由来の IDE 基礎機能

IntelliJ IDEA 2026.2 の機能一覧（公式ドキュメント全 1,273 トピックから起こしたもの）を Code OSS と
突き合わせ、**IntelliJ にあって VS Code に無いもの**だけを残した。章番号は調査書のもの。
土台に既にある機能（エディタ・補完・デバッグ・SCM・テスト・階層表示・Sticky Scroll・Local History・
Screencast Mode）は除外済み。**新しい配色は足さず、Nimbus Dark / Light のテーマ変数に従う**方針
（T-001 の Claude 配色。スクラッチファイル T-033 の判断と揃える）。

**第一波（T-033 / T-224〜T-231）は実装済み。** 完了セクションを参照。


### 配布・運用

- [ ] T-006 Apple の公証（notarization）に移行し、初回起動の「右クリック → 開く」を不要にする [P3]

### upstream 追従・コア

- [ ] T-007 `nimbus/scripts/sync-upstream.sh` を実際に一度回し、手順とコンフリクトの実際を記録する [P2]

### ドキュメント・テスト

## アイデア（視点別）

層（① 〜 ⑥）が「何を作るか」の分けかたなら、こちらは「**どの視点から見るか**」の引き出し。
やると決めたものは、行ごと上の層のセクションへ移す。

### 🎓 学習・教育


### 👥 チーム・社会性

- [ ] T-048 セッションの共有リンク — 会話＋差分をそのまま人に見せる。レビュー依頼や質問が楽になる。
      ※会話と差分には秘匿情報が混じるので、サニタイザ通過と公開範囲の設計が前提 [P2]
- [ ] T-049 チーム設定の同期 — CLAUDE.md やスキルをリポジトリ経由で配って全員の足並みを揃える（T-043 と対）[P2]
- [ ] T-212 権限管理（企業導入向け）[P3]

### ⏰ 時間軸


### 📱 デスクを離れる

- [ ] T-054 スマホから承認だけ — 進行が止まっているのに気づかず 1 時間ロス、を無くす [P2]
- [ ] T-055 音声で指示 — 手が離せないときに「テスト通しといて」だけ言う [P3]

### 🛡 事故る前に


### 📄 コード以外の成果物

- [ ] T-061 Mermaid 図のライブプレビュー — エージェントが描いた構成図をその場で確認する [P3]
- [ ] T-208 社内 Wiki / Notion 連携 [P3]
- [ ] T-209 API ドキュメントの追従更新 [P2]

### 🎨 自分だけの相棒にする

- [ ] T-063 ペルソナ設定 — 口調やキャラを設定できる（ヘルプの「ゆあ」は F6 で実装済み。
      あれを設定で選べる形にし、コックピット側にも効かせる）[P3]
- [ ] T-064 テーマ連動 — エージェントの状態で配色が変わる（思考中は青、待機は緑）[P3]

### 📊 自分を観測する

- [ ] T-206 セッションのリプレイ再生 [P3]

### 🔀 乗り換え・共存

- [ ] T-068 Cursor / Copilot からの設定インポート — 移行の壁を下げる [P2]
- [ ] T-069 他エージェントとの併用 — Claude Code をメインに据えつつ、別ツールの結果も同じ差分ビューで比べる [P3]

### 🌐 コミュニティ

- [ ] T-070 スキル・サブエージェントの共有マーケット — OSS 公開の方向と相性がいい [P3]
- [ ] T-071 設定のワンクリック導入 — 他の人の環境をそのまま試せる（T-043 / T-049 と繋がる）[P3]

### 📱 モバイル開発

- [ ] T-073 シミュレータ操作 — タップ操作を代行し、UI が実際に動くところまで確認させる [P2]
- [ ] T-074 実機ログの取り込み — クラッシュログをドロップしたら該当箇所まで一直線 [P2]

### 🔐 コンプラ・機密

- [ ] T-077 ローカル完結モード — ログを外に出さない設定（企業導入の必須条件になりがち）[P2]

### 🏚 巨大・レガシーリポ

- [ ] T-078 モノレポのスコープ切り替え — 作業対象のパッケージだけをエージェントに見せる [P2]
- [ ] T-079 考古学モード — `git blame` × 会話ログで「このコードが生まれた理由」を辿る（T-024 / T-034 の応用）[P2]
- [ ] T-080 仕様の逆生成 — ドキュメントが無いコードから仕様書を起こす（`nimbus/docs/specs/` へ・T-003 と繋がる）[P2]

### 🧪 「本当に動いたの？」

- [ ] T-083 裏取りモード — ライブラリの使い方を公式ドキュメントで確認してから書かせる（ハルシネーション対策）[P2]

### 🖥 環境まわり

- [ ] T-084 リモート開発 — SSH 先や devcontainer の中でエージェントを走らせる。
      ※MS の Remote-SSH / Dev Containers は VS Code 専用ライセンスでフォークでは使えない。
      OSS 代替（open-remote-ssh 等）の調査が前提 [P2]
- [ ] T-085 マシンをまたぐセッション同期 — 会社の Mac で始めて、家の PC で続きを見る [P3]
- [ ] T-086 iPad から様子見 — 閲覧と承認だけの軽量クライアント（T-054 と同じ線）[P3]
- [ ] T-203 言語別プリセット — Flutter / Go / Swift などの初期設定の雛形 [P2]
- [ ] T-204 **初回セットアップウィザード** — 連携・権限・CLAUDE.md 生成まで案内する [P2]
- [ ] T-205 環境差分の検出 — 「自分の環境では動くのに」問題の切り分け [P2]

### 🧠 メンタル・集中

- [ ] T-087 集中モード — エージェント稼働中は通知を全部黙らせる。
      ※T-019 の完了通知と方針が衝突するので、どちらを既定にするかを決める [P3]
- [ ] T-088 失敗時のリカバリ提案 — 詰まったときに「一旦戻す／別解を試す／人間が手を入れる」を選ばせる
      （T-025 のチェックポイントと繋がる）[P2]

### 🌏 日本語まわり

- [ ] T-090 日本語プロンプトの補助 — 曖昧な指示を検知して「これって〇〇のこと？」と聞き返す [P2]
- [ ] T-091 UI とドキュメントの多言語化 — 日本語圏の初学者に強い IDE は、まだ空いている椅子。
      ※Nimbus 側の文字列は今すべて日本語の直書き。`nls` に載せ替えるかの判断が要る（T-002 とは逆方向の作業）[P2]

### 🧩 拡張性

- [ ] T-092 Nimbus 自体のプラグイン API — 他の人が機能を足せる。OSS 化と噛み合う [P3]
- [ ] T-093 ヘッドレス Nimbus — GUI 抜きで同じワークフローを CI から呼べる（T-037 の週次プールの話と繋がる）[P2]

### 🔄 バージョン追従

- [ ] T-094 Claude Code の更新通知 — 新しいフックや機能が増えたときに「使ってみます？」と提案する [P2]
- [ ] T-095 設定のバージョン管理 — スキルや CLAUDE.md の変更履歴を残し、壊れたら戻せるように [P2]

### 🎮 続けたくなる

- [ ] T-097 今週のハイライト — 一番よく働いたサブエージェントを表彰する（T-047 の成長ログと同じ線）[P3]
- [ ] T-223 GIF / 動画エクスポート — 作業の様子をそのまま共有する [P3]

### 📦 依存・ビルド

- [ ] T-118 依存追加の妥当性チェック — パッケージを足そうとしたときに、メンテ状況・最終更新・
      既存依存との重複を提示してから承認させる（③ の承認 UI に載る話）[P2]
- [ ] T-121 脆弱性アラート起点の修正 — 警告が出た依存を、破壊的変更の有無を調べた上で上げる [P2]

### 🌐 API・スキーマ

- [ ] T-123 スキーマ変更の影響追跡 — バックエンドの型が変わったときに、フロント側の壊れる箇所を洗い出す [P2]

### 🗄 データ・DB

- [ ] T-125 マイグレーション生成とレビュー — スキーマ差分から生成し、破壊的操作（DROP など）は
      必ず人間承認にする（④ の権限ルールと繋げる）[P2]
- [ ] T-126 本番データの安全な扱い — クエリを流す前に SELECT だけのモードで確認する [P2]
- [ ] T-127 クエリの実行計画チェック — 生成された SQL が遅くないかを事前に見る [P3]

### ⚡️ パフォーマンス

- [ ] T-128 プロファイル結果の投入 — DevTools の計測結果を渡して、重い箇所を特定させる [P2]
- [ ] T-130 改善前後のベンチ比較 — 「速くなった気がする」を数字で確定させる（T-081 の証跡と同じ考え）[P2]
- [ ] T-222 メモリリークの調査支援と、起動時間の計測 [P2]

### 🔁 CI/CD

- [ ] T-131 CI 失敗の自動調査 — 赤くなった瞬間にログを取りに行って、原因の当たりをつけておく（T-039 の延長）[P2]
- [ ] T-132 ローカルで CI を再現 — 「CI だけ落ちる」問題の切り分け [P2]
- [ ] T-133 flaky テストの検出 — 何度か回して不安定なテストを見つける [P2]
- [ ] T-215 デプロイ前チェックリストの自動実行 [P2]
- [ ] T-216 ロールバックスクリプトの用意（T-144 のホットフィックスと対）[P3]

### 🌿 ブランチ運用

**worktree の自動管理は F4 で実装済み** — タスクごとに切り、完了時は未コミットの変更を WIP コミットで
保存してから `git worktree remove` する（`core/worktree.ts`）。ここに残るのはその先。

- [ ] T-135 スタックした PR の管理 — 積み上げたブランチの依存関係を整理する [P3]
- [ ] T-221 コードオーナーへの通知 [P3]

### 📊 コード品質


### 🧬 型・生成コード

- [ ] T-139 コード生成ツールとの連携 — `build_runner` のような生成物を、エージェントが直接編集しないようガード [P2]
- [ ] T-140 生成物と手書きの区別 — 差分ビューで生成コードは折りたたむ（③ に載る）[P2]
- [ ] T-141 freezed / json_serializable の追従 — モデル変更時に生成コマンドまで自動で回す [P2]

### 🧯 運用・障害対応

- [ ] T-142 エラー監視ツールとの連携 — Sentry などのエラーをそのままセッションに投入する [P2]
- [ ] T-143 再現手順の生成 — ログから再現用のテストコードを起こす [P2]
- [ ] T-144 ホットフィックスの最短経路 — 緊急時だけ手順を簡略化するモード [P3]

## 保留・やらないと決めたこと

**理由を 1 行必ず残す。**同じ議論を別のセッションが蒸し返さないために置いてあるセクション。

- Claude Code 本体の同梱 — バイナリだけで 280MB あり、利用者はすでに認証済みのものを持っていることが多い（README「ダウンロードと実行」）
- Microsoft Visual Studio Marketplace の利用 — 利用規約により Microsoft 製品以外での利用が認められていない（README「拡張機能について」）
- ベースを upstream の `main` に載せる — ビルド基盤の変化が速く追従コストが高い。安定リリースタグに載せる（`nimbus/docs/history/vscode-fork-migration.md` 5-7）

## 完了

新しい順。日付と、あれば確認記録へのリンクを添える。溜まってきたら `nimbus/docs/history/` へ退避する。

- [x] T-060 決めたことを残す（ADR）（会話から候補を拾い、`nimbus/docs/decisions/NNNN-*.md` を採番して作る。
      採番は wx で確保して並行実行でも衝突しない）— 2026-08-13 / 仕様 [decisions](nimbus/docs/specs/decisions.md)

- [x] T-177 スニペット化（選択範囲を `.vscode/*.code-snippets` に保存。エスケープと字下げ落としつき）
      — 2026-08-13 / 仕様 [snippets](nimbus/docs/specs/snippets.md)

- [x] T-182 テストが守っているかを確かめる（確実に意味が変わる壊し方を出し、1 つずつ入れて落ちるかを試させる）
      — 2026-08-13 / 仕様 [mutations](nimbus/docs/specs/mutations.md)

- [x] T-110 大規模な一括変更（影響範囲を先に数え、まとまりに分けて間にテストを挟ませる。進捗追跡にも繋ぐ）
      — 2026-08-13 / 仕様 [refactor-progress](nimbus/docs/specs/refactor-progress.md)

- [x] T-103 プロジェクト固有の書き方（既存ファイルを数えて、はっきり多いものだけを渡す。推測はしない）
      — 2026-08-13 / 仕様 [conventions](nimbus/docs/specs/conventions.md)

- [x] T-179 移行前後の等価性確認（移行前に「いまのとおり」を写すテストを書かせ、移行後は落ちたテストを
      変わった証拠として仕分けさせる）— 2026-08-13 / 仕様 [equivalence](nimbus/docs/specs/equivalence.md)

- [x] T-158 変更影響範囲の事前プレビュー（消した export の呼び出し元を、適用の前に並べる）
      — 2026-08-13 / 仕様 [impact-preview](nimbus/docs/specs/impact-preview.md)

- [x] T-181 スナップショットの更新レビュー（何が更新されたかを名指しし、「直して」ではなく「説明して」から入る）
      — 2026-08-13 / 仕様 [snapshot-review](nimbus/docs/specs/snapshot-review.md)

- [x] T-176 リポジトリの構造要約カード（数えた事実だけを 1 枚にして、そのままセッションへ渡せる）
      — 2026-08-13 / 仕様 [repo-summary](nimbus/docs/specs/repo-summary.md)

- [x] T-157 差分のセマンティック要約（export の増減を先頭に・構造だけ出して意図は Claude へ）
      — 2026-08-13 / 仕様 [diff-summary](nimbus/docs/specs/diff-summary.md)

- [x] T-111 段階的リファクタの進捗管理（`git grep -c` で残りを数え、続きを残りの多い順に頼む）
      — 2026-08-13 / 仕様 [refactor-progress](nimbus/docs/specs/refactor-progress.md)

- [x] T-160 レビュー済み／未レビューの管理（見たあとに変わったものは自動で未レビューに戻す）
      — 2026-08-13 / 仕様 [review-progress](nimbus/docs/specs/review-progress.md)

- [x] T-180 影響を受けるテストだけを走らせる（参照検索で関係するテストを選び、一覧を見せてから実行）
      — 2026-08-13 / 仕様 [test-runner](nimbus/docs/specs/test-runner.md)

- [x] T-115 コンフリクト解消支援（両方残す／片方を採るを 1 件ずつ・判断がつかないものは Claude へ相談文）
      — 2026-08-13 / 仕様 [conflicts](nimbus/docs/specs/conflicts.md)

- [x] T-107 失敗テスト起点の開発（先に落ちるテストを書かせる指示と、赤 → 緑になった瞬間の確認）
      — 2026-08-13 / 仕様 [test-runner](nimbus/docs/specs/test-runner.md)

- [x] T-106 ビルドエラーの自動リトライ（利用者が打ったビルド／型チェックだけを、直させてから
      同じ端末で走らせ直す。既定は無効・上限つき）— 2026-08-13 / 仕様 [terminal-capture](nimbus/docs/specs/terminal-capture.md)

- [x] T-114 コミットの意味単位への分割（変更を意図ごとに束ね、束ごとの `git add -- …` を出す）
      — 2026-08-13 / 仕様 [commit-split](nimbus/docs/specs/commit-split.md)

- [x] T-109 カバレッジ差分（この変更で足した行のうち、テストで実行されていない行を名指しする）
      — 2026-08-13 / 仕様 [test-runner](nimbus/docs/specs/test-runner.md)
- [x] T-108 回帰の検知（前回通っていたテストが落ちたら、上限で切られる前に先頭で名指しする）
      — 2026-08-13 / 仕様 [test-runner](nimbus/docs/specs/test-runner.md)
- [x] T-102 編集 → 解析 → 再編集の自動ループ（T-101 の auto モード。lint の警告まで回す設定つき・回数上限あり）
      — 2026-08-13 / 仕様 [verify-edits](nimbus/docs/specs/verify-edits.md)
- [x] T-171 / T-172 エディタから直接頼む（右クリックと、関数の上のコードレンズ。説明／リファクタ／テスト／自由指示）
      — 2026-08-13 / 仕様 [editor-actions](nimbus/docs/specs/editor-actions.md)
- [x] T-175 型定義の自動添付（指示で名指しした API の実物のシグネチャを、送る前に見出しつきで添える）
      — 2026-08-13 / 仕様 [signature-attachment](nimbus/docs/specs/signature-attachment.md)

- [x] T-193 Widget / ゴールデンテストの生成（開いている Dart から widget の実引数を読み、
      `test/` の規約どおりの場所に雛形を作る）— 2026-08-13 / 仕様 [widget-tests](nimbus/docs/specs/widget-tests.md)

- [x] T-004 §6 の画面確認（6 項目を GUI テストのケースに起こし 13/13 通過。あわせて GUI テストが
      開発ビルドで動いていなかった不具合 2 件を修正）— 2026-08-13 / [f3-f6 §6](nimbus/docs/testing/f3-f6.md)

- [x] T-104 デバッガ連携（止まっている位置のコールスタックと変数の値を `mcp__nimbus_debug__*` で渡す。
      式の評価は入れない）— 2026-08-13 / 仕様 [debug-tools](nimbus/docs/specs/debug-tools.md)

- [x] T-099 シンボル単位の参照（`read_symbol` — その関数の本体だけを渡す）
      — 2026-08-13 / 仕様 [lsp-tools](nimbus/docs/specs/lsp-tools.md)
- [x] T-100 依存グラフの提示（`file_graph` — 読み込んでいる先／依存されている側を定義ジャンプと参照検索で解く）
      — 2026-08-13 / 仕様 [lsp-tools](nimbus/docs/specs/lsp-tools.md)

- [x] T-101 型情報による即時検証（編集の前後で診断を比べ、そのターンで増えたエラーだけを差し戻す）
      — 2026-08-13 / 仕様 [verify-edits](nimbus/docs/specs/verify-edits.md)

- [x] T-230 依存構造マトリクス（DSM）（IntelliJ 由来）— 2026-08-13 / 仕様 `nimbus/docs/specs/dependency-matrix.md` /
      確認 `nimbus/docs/testing/intellij-features.md`（画面確認は §2 が未実施）
- [x] T-229 構造検索・置換（SSR）（IntelliJ 由来）— 2026-08-13 / 仕様 `nimbus/docs/specs/structural-search.md` /
      確認 `nimbus/docs/testing/intellij-features.md`（画面確認は §2 が未実施）
- [x] T-231 Productivity Guide（IntelliJ 由来）— 2026-08-13 / 仕様 `nimbus/docs/specs/productivity-guide.md` /
      確認 `nimbus/docs/testing/intellij-features.md`（画面確認は §2 が未実施）
- [x] T-228 Command completion（ドットから IDE アクション）（IntelliJ 由来）— 2026-08-13 / 仕様 `nimbus/docs/specs/command-completion.md` /
      確認 `nimbus/docs/testing/intellij-features.md`（画面確認は §2 が未実施）
- [x] T-227 Run Anything（IntelliJ 由来）— 2026-08-13 / 仕様 `nimbus/docs/specs/run-anything.md` /
      確認 `nimbus/docs/testing/intellij-features.md`（画面確認は §2 が未実施）
- [x] T-226 ブックマーク（ニーモニック付き）（IntelliJ 由来）— 2026-08-13 / 仕様 `nimbus/docs/specs/bookmarks.md` /
      確認 `nimbus/docs/testing/intellij-features.md`（画面確認は §2 が未実施）
- [x] T-225 Search Everywhere（IntelliJ 由来）— 2026-08-13 / 仕様 `nimbus/docs/specs/search-everywhere.md` /
      確認 `nimbus/docs/testing/intellij-features.md`（画面確認は §2 が未実施）
- [x] T-224 マクロの記録・再生（IntelliJ 由来）— 2026-08-13 / 仕様 `nimbus/docs/specs/macros.md` /
      確認 `nimbus/docs/testing/intellij-features.md`（画面確認は §2 が未実施）
- [x] T-033 スクラッチファイル（IntelliJ 由来）— 2026-08-13 / 仕様 `nimbus/docs/specs/scratch-files.md` /
      確認 `nimbus/docs/testing/intellij-features.md`（画面確認は §2 が未実施）

- [x] T-039 テストランナー連携（Test Explorer の結果から落ちたテストの名前・場所・メッセージを
      1 クリックでセッションへ。CI 連携は T-131）— 2026-08-13 / 仕様 [test-runner](nimbus/docs/specs/test-runner.md)

- [x] T-113 hunk 単位の部分採用（変更を選んで採用・外したものは元のまま残る・Write / Edit / MultiEdit）
      — 2026-08-13 / 仕様 [approvals-and-diff](nimbus/docs/specs/approvals-and-diff.md)

- [x] T-169 ターミナル出力の自動キャプチャ（落ちたコマンドの出力を通知のボタン 1 つでセッションへ）
      — 2026-08-13 / 仕様 [terminal-capture](nimbus/docs/specs/terminal-capture.md)
- [x] T-098 LSP をエージェントのツールにする（定義・参照・型・アウトライン・シンボル検索・呼び出し階層・
      診断を `mcp__nimbus_lsp__*` として渡す）— 2026-08-13 / 仕様 [lsp-tools](nimbus/docs/specs/lsp-tools.md) /
      確認 [testing/lsp-tools](nimbus/docs/testing/lsp-tools.md)（画面確認 §2 は未実施）

- [x] T-211 レビューを頼む文（読む順はテストから・テスト無しは自分から言う）— 2026-08-13 / 仕様 [pr-description](nimbus/docs/specs/pr-description.md)
- [x] T-214 やり取りの切り出し（切り出す時点で伏せる・保存しない）— 2026-08-13 / 仕様 [highlights](nimbus/docs/specs/highlights.md)
- [x] T-202 危ない書き方の検出（断定しない・当てられても困らない用途は拾わない）— 2026-08-13 / 仕様 [code-health](nimbus/docs/specs/code-health.md)
- [x] T-076 依存のライセンス（迷ったら分からないに倒す・合法判定はしない）— 2026-08-13 / 仕様 [licenses](nimbus/docs/specs/licenses.md)
- [x] T-066 詰まりやすい場所（件数で足切り・理由は推測しない）— 2026-08-13 / 仕様 [prompt-stats](nimbus/docs/specs/prompt-stats.md)
- [x] T-065 / T-067 指示の出しかた（言い直しの傾向・数が少ないうちは出さない）— 2026-08-13 / 仕様 [prompt-stats](nimbus/docs/specs/prompt-stats.md)
- [x] T-051 寝る前に仕込む（過ぎた時刻は翌日・承認で止まることを黙らない・常駐しない）— 2026-08-13 / 仕様 [schedule](nimbus/docs/specs/schedule.md)
- [x] T-046 / T-213 練習用サンドボックス（直すところがある状態で置く）— 2026-08-13 / 仕様 [sandbox](nimbus/docs/specs/sandbox.md)
- [x] T-218 / T-124 実物とスキーマの突き合わせと、仮の応答 — 2026-08-13 / 仕様 [api-check](nimbus/docs/specs/api-check.md)
- [x] T-122 スキーマから型を起こす（Dart / TypeScript・扱えないものは扱えないと書く）— 2026-08-13 / 仕様 [openapi](nimbus/docs/specs/openapi.md)
- [x] T-200 Platform Channel の突き合わせ（受け口の無い呼び出しを実機の前に見つける）— 2026-08-13 / 仕様 [platform-channel](nimbus/docs/specs/platform-channel.md)
- [x] T-089 / T-053 いまのようす（続けすぎの区切り・待ち時間の使い道）— 2026-08-13 / 仕様 [rhythm](nimbus/docs/specs/rhythm.md)
- [x] T-210 古くなっているコメントの検出（`@param` の食い違い・存在しない参照）— 2026-08-13 / 仕様 [code-health](nimbus/docs/specs/code-health.md)
- [x] T-160 レビューの進み（見たあとに変わったら見ていない扱いに戻す）— 2026-08-13 / 仕様 [review-progress](nimbus/docs/specs/review-progress.md)
- [x] T-198 依存の食い違い（pubspec と Podfile.lock の突き合わせ）— 2026-08-13 / 仕様 [dep-consistency](nimbus/docs/specs/dep-consistency.md)
- [x] T-199 Xcode プロジェクトの衝突を解く（両方残す・1 つでも怪しければ触らない）— 2026-08-13 / 仕様 [xcode-conflict](nimbus/docs/specs/xcode-conflict.md)
- [x] T-217 / T-129 ビルド時間と成果物の大きさを前回と比べる — 2026-08-13 / 仕様 [build-metrics](nimbus/docs/specs/build-metrics.md)
- [x] T-194 / T-195 Flutter の確認（直書きの文言・読み上げに渡らない画像・名前の無いボタン）— 2026-08-13 / 仕様 [flutter-lint](nimbus/docs/specs/flutter-lint.md)
- [x] T-196 / T-197 / T-201 提出前の確認（権限の差分・プライバシーマニフェスト・版）— 2026-08-13 / 仕様 [mobile-checks](nimbus/docs/specs/mobile-checks.md)
- [x] T-183 どこで壊れたかを絞り込む（残り回数を出す・git は勝手に動かさない）— 2026-08-13 / 仕様 [bisect](nimbus/docs/specs/bisect.md)
- [x] T-220 PR の説明文の下書き（意図は人が書く・テスト無しは警告）— 2026-08-13 / 仕様 [pr-description](nimbus/docs/specs/pr-description.md)
- [x] T-052 朝のダイジェスト（ふりかえりに「昨夜から」を追加）— 2026-08-13 / 仕様 [digest](nimbus/docs/specs/digest.md)
- [x] T-134 / T-219 ブランチの離れ具合と衝突の予告、命名規則の判定 — 2026-08-13 / 仕様 [branch-health](nimbus/docs/specs/branch-health.md)
- [x] T-136 / T-138 重いところの可視化と、層の逆流の検知（core/ は vscode に依存しない）— 2026-08-13 / 仕様 [code-health](nimbus/docs/specs/code-health.md)
- [x] T-112 使われていない export を挙げる（死骸と「export を外せるだけ」を分ける）— 2026-08-13 / 仕様 [code-health](nimbus/docs/specs/code-health.md)
- [x] T-178 / T-137 命名のゆれとそっくりな実装を見せる — 2026-08-13 / 仕様 [code-health](nimbus/docs/specs/code-health.md)
- [x] T-159 / T-082 変更のようす（統計と、テストが伴っていないときの指摘）— 2026-08-13 / 仕様 [change-stats](nimbus/docs/specs/change-stats.md)
- [x] T-062 リリースノートの下書きを履歴から作る（分類・迷ったらその他）— 2026-08-13 / 仕様 [release-notes](nimbus/docs/specs/release-notes.md)
- [x] T-096 連続稼働日数をふりかえりに出す — 2026-08-13 / 仕様 [digest](nimbus/docs/specs/digest.md)
- [x] T-105 スタックトレースから該当箇所を開く（Dart / JS・自分のコードの一番上を優先）— 2026-08-13 / 仕様 [stack-trace](nimbus/docs/specs/stack-trace.md)
- [x] T-119 ロックファイルの変更を読む（pubspec.lock / package-lock.json・メジャーを先頭に）— 2026-08-13 / 仕様 [lock-diff](nimbus/docs/specs/lock-diff.md)
- [x] T-207 / T-047 ふりかえり（週次ダイジェスト・成長ログ）— 2026-08-13 / 仕様 [digest](nimbus/docs/specs/digest.md)
- [x] T-155 読ませたくないファイルを画面から指定する（既定の可視化・取り込み・外すときの確認）— 2026-08-13 / 仕様 [protected-paths](nimbus/docs/specs/protected-paths.md)
- [x] T-234 何度も言っている指示を、その場で CLAUDE.md の「毎回の指示」に足せるようにする — 2026-08-13 / 仕様 [claude-md](nimbus/docs/specs/claude-md.md)
- [x] T-041 CLAUDE.md のメンテ支援（重複・空の節・長さの指摘＋何度も言っている指示の提示）— 2026-08-13 / 仕様 [claude-md](nimbus/docs/specs/claude-md.md)
- [x] T-021 文脈ビューの CLAUDE.md に出どころを添える（プロジェクト／親フォルダから継承／ユーザー設定）— 2026-08-13 / 仕様 [context-view](nimbus/docs/specs/context-view.md)
- [x] T-041（リンター部分）CLAUDE.md の重複・空の節・長さの指摘とトークン数表示 — 2026-08-13 / 仕様 [claude-md](nimbus/docs/specs/claude-md.md)

- [x] T-010 承認の横断キュー（全セッションの承認待ちを 1 ビューに集約・危険な順・キューモードで順に処理）
      — 2026-08-13 / 仕様 [approvals-and-diff](nimbus/docs/specs/approvals-and-diff.md)
- [x] T-038 インライン権限承認 UI（「今後この種類は常に許可」をルール化して `settings.json` へ保存）
      — 2026-08-13 / 仕様 [approvals-and-diff](nimbus/docs/specs/approvals-and-diff.md)

- [x] T-003 現行機能の仕様を書き起こす（セッション / 承認と差分 / 文脈 / 並列タスク / スキルとヘルプ /
      テーマ / 配布と追従の 6 本）— 2026-08-13 / [`nimbus/docs/specs/`](nimbus/docs/specs/README.md)

- [x] T-154 圧縮前に何を残すかを選ぶ（/compact への指示として渡す・選ばなければ従来どおり）— 2026-08-13 / 仕様 [context-control](nimbus/docs/specs/context-control.md)
- [x] T-232 サブエージェントごとのモデル指定（割り当てたものだけを差し替える）— 2026-08-13 / 仕様 [agent-models](nimbus/docs/specs/agent-models.md)
- [x] T-187 見積もり表示（予測ではなく、直近 5 ターンの中央値）— 2026-08-13 / 仕様 [dialogue](nimbus/docs/specs/dialogue.md)
- [x] T-188 選択肢の比較表（「まだ変更しないで」を型に入れる）— 2026-08-13 / 仕様 [dialogue](nimbus/docs/specs/dialogue.md)
- [x] T-189 意見の相違の記録（どちらが正しいかを決めつけさせない）— 2026-08-13 / 仕様 [dialogue](nimbus/docs/specs/dialogue.md)
- [x] T-015 デバッグモード（生イベントの時系列ビューア）— 2026-08-13 / 仕様 [audit-and-timeline](nimbus/docs/specs/audit-and-timeline.md)
- [x] T-050 監査ログ（日付ごとの JSONL・サニタイズしてから書く）— 2026-08-13 / 仕様 [audit-and-timeline](nimbus/docs/specs/audit-and-timeline.md)
- [x] T-056 アンビエント表示（走っている間だけ、いまのツールを視界の端に）— 2026-08-13 / 仕様 [audit-and-timeline](nimbus/docs/specs/audit-and-timeline.md)
- [x] T-184 ログの時系列ビューア（T-015 と同じ面に統合）— 2026-08-13 / 仕様 [audit-and-timeline](nimbus/docs/specs/audit-and-timeline.md)
- [x] T-016 アクティビティバーに設定タブ（いま効いている値を 1 か所に）— 2026-08-13 / 仕様 [settings-and-bundle](nimbus/docs/specs/settings-and-bundle.md)
- [x] T-043 設定のパッケージ配布（JSON 1 枚・秘匿を弾き、上書きは必ず聞く）— 2026-08-13 / 仕様 [settings-and-bundle](nimbus/docs/specs/settings-and-bundle.md)
- [x] T-162 承認ポリシーのプロファイル切り替え（広げるときだけ確認する）— 2026-08-13 / 仕様 [hooks](nimbus/docs/specs/hooks.md)
- [x] T-163 実行サンドボックス・ネットワーク遮断（SDK の sandbox で外に出さない）— 2026-08-13 / 仕様 [hooks](nimbus/docs/specs/hooks.md)
- [x] T-026 Hooks の GUI ビルダー（イベントは 31 種類・よく使う 5 つを前面に）— 2026-08-13 / 仕様 [hooks](nimbus/docs/specs/hooks.md)
- [x] T-044 ターミナルの Shift+Enter を改行に（出荷時から ESC+CR を送る）— 2026-08-13 / 仕様 [hooks](nimbus/docs/specs/hooks.md)
- [x] T-161 フックのドライラン（本番と同じ形の入力で、止まるかを先に確かめる）— 2026-08-13 / 仕様 [hooks](nimbus/docs/specs/hooks.md)
- [x] T-147 タスクのピン留めとタグ（板の並びと絞り込みの判定）— 2026-08-13 / 仕様 [session-extras](nimbus/docs/specs/session-extras.md)
- [x] T-151 送れなかった入力の預かり（繋がらない失敗だけ・自動では送らない）— 2026-08-13 / 仕様 [session-extras](nimbus/docs/specs/session-extras.md)
- [x] T-168 セッション → スキル化（骨格まで書き、確かめていないことは書かない）— 2026-08-13 / 仕様 [session-extras](nimbus/docs/specs/session-extras.md)
- [x] T-035 プロンプトライブラリ（変数つきテンプレ・埋め残しは残して知らせる）— 2026-08-13 / 仕様 [prompts-and-find](nimbus/docs/specs/prompts-and-find.md)
- [x] T-117 スキル以外も同じ場所から探せる（コマンド・サブエージェント・MCP ツール・定型）— 2026-08-13 / 仕様 [prompts-and-find](nimbus/docs/specs/prompts-and-find.md)
- [x] T-236 ツリービューの共通土台（4 ビューすべてを載せ替え・ツール入力の取り出しも共通化）— 2026-08-13 / 仕様 [tree-views](nimbus/docs/specs/tree-views.md)
- [x] T-013 tasks.md とタスク板の対応づけ（定義行から着手・完了で行ごと移す）— 2026-08-13 / 仕様 [tasks-board-link](nimbus/docs/specs/tasks-board-link.md)
- [x] T-233 タスクキューの優先度（高／中／低・同じなら作った順）— 2026-08-13 / 仕様 [tasks-board-link](nimbus/docs/specs/tasks-board-link.md)
- [x] T-036 セッションの分岐（同じ地点から A 案・B 案をタスクとして並列に）— 2026-08-13 / 仕様 [session-lifecycle](nimbus/docs/specs/session-lifecycle.md)
- [x] T-148 セッションテンプレート（調査／実装／レビューを同梱・{input} 展開）— 2026-08-13 / 仕様 [session-lifecycle](nimbus/docs/specs/session-lifecycle.md)
- [x] T-150 セッションの復元（Claude Code の記録から再開。自前バックアップは持たない）— 2026-08-13 / 仕様 [session-lifecycle](nimbus/docs/specs/session-lifecycle.md)
- [x] T-011 同じファイルを触っているセッションの検出（書く前に知らせる・読みと書きを区別）— 2026-08-13 / 仕様 [parallel-awareness](nimbus/docs/specs/parallel-awareness.md)
- [x] T-012 いま誰が何をしているかの俯瞰（並列時だけ「他のセッション」を出す）— 2026-08-13 / 仕様 [parallel-awareness](nimbus/docs/specs/parallel-awareness.md)
- [x] T-152 コンテキストのピン留め（常に含めるファイル・上限つき・preset に append）— 2026-08-13 / 仕様 [context-control](nimbus/docs/specs/context-control.md)
- [x] T-153 コンテキスト予算の割り当て（8 割で警告・超過で圧縮を促す・止めない）— 2026-08-13 / 仕様 [context-control](nimbus/docs/specs/context-control.md)
- [x] T-156 コンテキスト効率のスコア表示（読み直しの重複だけを数える）— 2026-08-13 / 仕様 [context-control](nimbus/docs/specs/context-control.md)
- [x] T-040 画像・スクショのドロップ投入（貼り付け／ドロップ・中身で種類を判定）— 2026-08-13 / 仕様 [images-and-hot-reload](nimbus/docs/specs/images-and-hot-reload.md)
- [x] T-072 ホットリロード連携（直す→リロード→スクショ→自分で見る。上限つき・既定オフ）— 2026-08-13 / 仕様 [images-and-hot-reload](nimbus/docs/specs/images-and-hot-reload.md)
- [x] T-081 証跡つき完了報告（テスト実行の有無と成否を機械で拾い、報告に添える）— 2026-08-13 / 仕様 [completion-evidence](nimbus/docs/specs/completion-evidence.md)
- [x] T-024 「この修正はどの指示から生まれたか」の紐づけ（指示ごとに修正と読んだファイルをまとめる）— 2026-08-13 / 仕様 [session-activity](nimbus/docs/specs/session-activity.md)
- [x] T-192 思考中の可視化（走っているツールと対象を「セッションの中身」の先頭に出す）— 2026-08-13 / 仕様 [session-activity](nimbus/docs/specs/session-activity.md)
- [x] T-025 チェックポイントのタイムライン UI（戻す先を選び、変更内容を見てから戻す）— 2026-08-13 / 仕様 [checkpoints-and-mcp](nimbus/docs/specs/checkpoints-and-mcp.md)
- [x] T-029 MCP サーバーの接続管理（状態・エラー・繋ぎ直し・有効無効）— 2026-08-13 / 仕様 [checkpoints-and-mcp](nimbus/docs/specs/checkpoints-and-mcp.md)
- [x] T-034 過去セッションの横断検索（`~/.claude/projects/**` を読む・`file:` `tool:` で絞り込み）— 2026-08-13 / 仕様 [transcript-search](nimbus/docs/specs/transcript-search.md)
- [x] T-042 MCP ツールエクスプローラ（一覧・説明・破壊的かどうか。単体実行は T-235 へ分割）— 2026-08-13 / 仕様 [checkpoints-and-mcp](nimbus/docs/specs/checkpoints-and-mcp.md)
- [x] T-018 サブエージェントのツリー可視化（指示・種別・消費・状態・まとめ）— 2026-08-13 / 仕様 [session-activity](nimbus/docs/specs/session-activity.md)
- [x] T-019 完了通知（ターン完了と承認待ちを OS 通知・裏にいるときだけ）— 2026-08-13 / 仕様 [session-activity](nimbus/docs/specs/session-activity.md)
- [x] T-022 コンパクションの可視化（発生の記録と手動実行 `nimbus.compact`）— 2026-08-13 / 仕様 [session-activity](nimbus/docs/specs/session-activity.md)
- [x] T-023 読み込まれたファイル一覧（読み／書きを分けて数え、クリックで開く）— 2026-08-13 / 仕様 [session-activity](nimbus/docs/specs/session-activity.md)
- [x] T-027 フック発火ログのビューア（結果・終了コード・stderr まで）— 2026-08-13 / 仕様 [session-activity](nimbus/docs/specs/session-activity.md)
- [x] T-017 使用量を常時表示（5 時間・週の枠を SDK から取得。自前積算は不要と判明）— 2026-08-13 / 仕様 [usage](nimbus/docs/specs/usage.md)
- [x] T-020 トークン消費量のリアルタイムバー（文脈の消費率をステータスバーに常時表示）— 2026-08-13 / 仕様 [usage](nimbus/docs/specs/usage.md)
- [x] T-037 コスト・使用量ダッシュボード（「使用量」ビュー・週の枠は対話とアプリ経由で分ける）— 2026-08-13 / 仕様 [usage](nimbus/docs/specs/usage.md)
- [x] T-059 コスト上限アラート（上限の 80% で警告・超過で停止ボタンを添える）— 2026-08-13 / 仕様 [usage](nimbus/docs/specs/usage.md)
- [x] T-057 暴走の緊急停止（全セッションを一括停止・待機タスクの自動開始も止める）— 2026-08-13 / 仕様 [safety](nimbus/docs/specs/safety.md)
- [x] T-058 危険操作の事前検知（`rm -rf` / 強制 push / 本番反映などを承認前に名指しする）— 2026-08-13 / 仕様 [safety](nimbus/docs/specs/safety.md)
- [x] T-075 送信前マスキング（プロンプト送信の直前に資格情報を検出して止める）— 2026-08-13 / 仕様 [safety](nimbus/docs/specs/safety.md)
- [x] T-120 ビルド設定の変更検知（Gradle / Xcode / CI 設定への書き込みを注意扱いにする）— 2026-08-13 / 仕様 [safety](nimbus/docs/specs/safety.md)
- [x] T-164 秘匿ファイルの読み取り禁止（`.env`・秘密鍵などを承認を求めず拒否）— 2026-08-13 / 仕様 [safety](nimbus/docs/specs/safety.md)
- [x] T-001 Nimbus 独自テーマ（Nimbus Dark / Nimbus Light・Claude を思わせる配色）— 2026-08-13 / `df49e981c80`
- [x] F6 スキル検索・ヘルプ（ゆあ）— 2026-08-12 / `nimbus/docs/testing/f3-f6.md` §4
- [x] F5 配布と upstream 追従の運用 — 2026-08-12 / `nimbus/docs/testing/f3-f6.md` §5
- [x] F4 並列タスク（worktree × カンバン）— 2026-08-12 / `nimbus/docs/testing/f3-f6.md` §3
- [x] F3 承認前の差分・文脈可視化・課金モード表示 — 2026-08-12 / `nimbus/docs/testing/f3-f6.md` §2
- [x] F2 組み込み拡張への移植と実 Claude セッションの疎通 — 2026-08-12 / `nimbus/docs/testing/f2-extension.md`
- [x] F1 フォークが Nimbus として起動し、Open VSX から拡張を入れられる — 2026-08-12 / `nimbus/docs/testing/f1-fork-build.md`
- [x] F0 調査と方針決定（ライセンス・商標・Marketplace・ビルド前提）— 2026-08-12 / `nimbus/docs/history/vscode-fork-migration.md`
- [x] T-145 ドクター（不要ファイル・宣言と実装のズレ・台帳の記載漏れを機械で洗い出す）— 2026-08-13 / `node nimbus/scripts/doctor.mjs` / 仕様 [quality-commands](nimbus/docs/specs/quality-commands.md)
- [x] T-146 テストコマンド（モジュールテスト＋GUI 操作テスト）— 2026-08-13 / `bash nimbus/scripts/test.sh` / スキル `nimbus-doctor` `spec-drift` `nimbus-test`
- [x] T-234 重複検出とリファクタリング用スキル、テスト雛形の自動生成 — 2026-08-13 / `doctor.mjs duplication|coverage` / `scaffold-test.mjs` / スキル `refactor` `write-tests`
- [x] T-002 `localize()` の "VS Code" 直書き 152 箇所 — 2026-08-13 / nls の集約点（`_format`）で置換。1 ファイルの変更で全部に効き、upstream の新しい文言にも追随する
- [x] T-005 Copilot をソースとビルドスクリプトからも除去 — 2026-08-13 / `extensions/copilot/`（4193 ファイル・1.8GB）を削除し、npm スクリプトとビルド配線からも外した。**依存 `@github/copilot-sdk` `@vscode/copilot-api` はコアの agent host が使うため残す**（台帳に理由を記載）
- [x] T-185 着手前の確認強制（曖昧な指示を走らせる前に止める）— 2026-08-13 / 仕様 [pre-send-confirmation](nimbus/docs/specs/pre-send-confirmation.md) / 判定は `src/core/clarify.ts`・テスト 12 件
- [x] T-186 前提・仮定のリスト表示 — 2026-08-13 / 仕様 [assumptions](nimbus/docs/specs/assumptions.md) / 抽出は `src/core/assumptions.ts`・テスト 12 件
