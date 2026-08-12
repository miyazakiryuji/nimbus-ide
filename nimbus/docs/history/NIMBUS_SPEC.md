# Nimbus — 開発指示プロンプト

> このドキュメントは、Claude Code にそのまま渡して **Nimbus** を実装させるための指示書です。
> `§1〜§8` が仕様、`§9` が実際の実装オーダー、`§10` が実装前の必須確認事項です。

---

## §0 このドキュメントの使い方

1. プロジェクトルートに本ファイルを置き、Claude Code に読み込ませる
2. まず **§10 の検証タスク** を実行させ、公式ドキュメントで最新仕様を確認させる
3. その結果を踏まえて **§9 の Phase 0-1** を実装させる
4. Phase が進むごとに `§8` を参照して次のオーダーを出す

**重要：この指示書に書かれた API 名・フラグ名・パッケージ名は執筆時点の情報です。実装前に必ず §10 で裏を取り、齟齬があれば公式ドキュメントを正としてこの指示書を更新してください。推測で実装しないでください。**

---

## §1 プロダクト概要

### Nimbus とは

Claude Code を最大限に活用するための **デスクトップ開発環境**。

### コンセプト

**「コードを書くためのエディタ」ではなく「エージェントを操縦するためのコックピット」。**

Cursor や Windsurf が「補完が賢いエディタ」を目指すのに対し、Nimbus が磨くのは
**指示 → 待機 → レビュー → 再指示** のループそのもの。
人間がタイプする量が激減した時代に必要なのは、賢い補完ではなく、
**複数のエージェントの状態を把握し、素早く承認し、差分を確認して、次の指示を出す** ための操縦席である。

### 解決する課題

| # | 課題 | Nimbus の解 |
|---|---|---|
| P-1 | 複数タスクを並行させたいがターミナル切替が煩雑 | worktree × セッションのカンバン |
| P-2 | エージェントが今どれだけコンテキストを消費しているか見えない | コンテキスト可視化パネル |
| P-3 | ターミナル上の diff レビューが視認しづらい | GUI 差分レビュー ＋ チェックポイント |
| P-4 | 権限確認のたびに手が止まる | 承認インボックス |
| P-5 | `CLAUDE.md` や skills の効果が手探り | 設定ラボ |
| P-6 | 過去セッションの資産が埋もれる | セッション横断検索と再開 |

### 命名の由来（**README に必ず記載すること**）

以下の文面を `README.md` の冒頭付近に、原文の意図を保ったまま掲載すること。

```markdown
## なぜ "Nimbus" なのか

**Nimbus** はラテン語で「雲」を意味する語で、気象学では雨雲を指します
（乱層雲 *nimbostratus*、積乱雲 *cumulonimbus* など）。
同時に美術の世界では、聖人や神像の頭上に描かれる **光背（後光）** を指す言葉でもあります。

Nimbus が目指すのは、開発者の手からキーボードを奪うことではなく、
**背後からそっと照らす光** であること。
コードを書くのはあなたで、Nimbus はその周りに漂う雲であり、光でありたい。

> 語源についての補足：「Claude」という名前自体はラテン語の人名 *Claudius* に由来し、
> *cloud*（雲）とは語源的な繋がりはありません。あくまで響きから連想した名前です。
```

この由来はプロダクト全体の一貫性の軸でもある。既定テーマの配色（§4 F-8）も
「雨雲の青灰 ＋ 光背の淡い金」として、この由来と地続きにすること。

---

## §2 技術スタック

| 領域 | 採用 | 理由 |
|---|---|---|
| シェル | **Electron** | Claude Agent SDK が TypeScript/Node のためメインプロセスで直接動く。node-pty が枯れている。OSS コントリビューターの間口が広い |
| ビルド | **Vite** | 既存資産との一貫性 |
| UI | **React + TypeScript** | 〃 |
| エディタ / Diff | **Monaco Editor** | VS Code と同等の差分表示 |
| 状態管理 | **Zustand**（または Jotai） | 軽量。セッション単位の状態が多いため |
| 永続化 | **better-sqlite3** | 同期 API でメインプロセスから扱いやすい |
| Git 操作 | **simple-git** | worktree / diff / stash |
| ターミナル | **xterm.js + node-pty** | 生ターミナルのフォールバック用（Phase 3 以降） |
| Claude 連携 | **`@anthropic-ai/claude-agent-sdk`** | §10 で最新の import 名・API を要確認 |

**Tauri を採用しない理由：** Agent SDK は TypeScript 実装のため Rust バックエンドでは直接動かせず、
結局 Node サイドカーが必要になる。PTY 管理も Rust 側で再実装が必要。
バンドルサイズ以外の全項目で Electron が優位と判断した。

---

## §3 アーキテクチャ

### プロセス構成

```
Main Process (Node)
├─ SessionManager      … Claude セッションの生成・保持・多重起動・再開
├─ WorktreeManager     … git worktree の生成／破棄／一覧
├─ PermissionBroker    … ツール実行前フックを横取りし、承認待ちキューへ積む
├─ ConfigService       … ~/.claude, .claude/, ~/.nimbus/ の読み書き
├─ ThemeService        … テーマ JSON のロード・監視・配信
├─ CredentialVault     … Electron safeStorage による資格情報の暗号化保存
└─ Store               … better-sqlite3（セッション索引・イベントログ・コスト履歴）
        ↕  型付き IPC（contextBridge / preload）
Renderer (React)
├─ Cockpit   … セッション一覧カンバン
├─ Context   … コンテキスト可視化パネル
├─ Review    … Monaco diff エディタ
├─ Inbox     … 承認インボックス
├─ Lab       … 設定・スキル編集
└─ Settings  … 接続 / テーマ / エディタ / プロファイル
```

### ディレクトリ構成

```
nimbus/
├─ src/
│  ├─ main/           # Electron メインプロセス
│  │  ├─ services/    # SessionManager, WorktreeManager, ...
│  │  ├─ ipc/         # ハンドラ定義（zod でスキーマ検証）
│  │  └─ db/          # マイグレーション・クエリ
│  ├─ preload/        # contextBridge の型付き公開
│  ├─ renderer/
│  │  ├─ features/    # cockpit / context / review / inbox / lab / settings
│  │  ├─ components/  # 汎用 UI
│  │  ├─ theme/       # CSS 変数定義・テーマローダ
│  │  └─ stores/
│  └─ shared/         # main / renderer 共通の型・定数
├─ themes/            # 内蔵テーマ JSON
├─ docs/
└─ README.md
```

### 設計原則

1. **Renderer から Node API を直接触らせない。** すべて型付き IPC 経由。`contextIsolation: true`, `nodeIntegration: false`
2. **IPC の入出力は zod でスキーマ検証する。**
3. **Claude セッションの生ストリームはメインプロセスで正規化し、Renderer には Nimbus 独自の正規化イベント型で流す。** SDK の型変更の影響範囲を一箇所に閉じ込めるため
4. **すべての永続データはユーザーのローカルに閉じる。** 外部送信・テレメトリは一切実装しない
5. **同一プロジェクトへの複数セッション並列操作を Phase 0 から前提にする。**（2026-08-11 追記。F-5 の UI を待たず、土台の段階で多重化を織り込む）
   - SessionManager は最初から `Map<sessionId, ManagedSession>` で複数セッションを保持し、「現在のセッション」というシングルトン前提の API を作らない
   - 正規化イベント・IPC ペイロード・DB の行は **必ず `sessionId` を持つ**。Renderer の状態も sessionId をキーにした辞書で持つ（Phase 1 の単一セッション UI はその上の「表示が1つ」にすぎない）
   - PermissionBroker の承認キューは **全セッション横断の 1 本** とし、各エントリがセッション帰属（sessionId / プロジェクト / worktree）を持つ
   - SQLite は WAL モードで開き、書き込みはメインプロセスの単一書き込み点に集約して複数セッションの同時追記に耐える
   - 同一プロジェクトの並列作業は worktree で分離するのが本線（F-5）だが、**複数セッションが同じ working dir を共有しても壊れない** こと（diff 取得・ファイル参照は各セッションの cwd 基準、グローバル状態への書き込みは排他）
   - 同時実行数の上限・コスト集計はセッション単位とプロジェクト単位の両方で追えるデータ構造にする

---

## §4 機能要件

### F-1 セッション実行エンジン（Phase 0）

- Claude セッションを生成し、対話を継続できること（状態を保持するクライアント方式を使用）
- ストリーミングイベントを受信し、正規化して Renderer へ配信
- セッションの中断（interrupt）に対応
- セッション ID を保存し、後から再開できること
- 全イベントを SQLite に追記保存（マスキング後、§6 参照）

### F-2 コンテキスト可視化（Phase 1）

セッション開始時のシステム初期化イベントには、モデル名・利用可能ツール・MCP サーバー・
ロード済みプラグイン等のメタデータが含まれる。**これを受け取って表示するだけで大半が実現できる。**

表示項目：

- 現在のモデル名
- 有効なツール一覧
- 接続中の MCP サーバー
- ロード済みプラグイン / skills
- 適用されている `CLAUDE.md` の階層（プロジェクト / ユーザー / 親ディレクトリ）
- 累積コスト（結果イベントのコスト情報より）
- トークン使用量の推移グラフ

### F-3 承認インボックス（Phase 1）

- ツール実行前フックで実行を保留し、承認待ちキューに積む
- キューを一覧表示し、**まとめて承認 / 個別承認 / 拒否** できる
- ツール名・引数・対象ファイルパスをプレビュー表示
- 「このツールは以後自動承認」のルール登録（セッション単位 / ワークスペース単位）
- OS 通知連携（承認待ちが発生したら通知）

> **2026-08-11 追記（ユーザー指示）**: 本プロダクトは **IDE として** 位置づけて開発する。
> コックピット（指示→待機→レビュー→再指示）を主軸としつつ、IDE の基礎機能 —
> ワークスペース（フォルダを開く）・差分レビュー・ファイル閲覧 — を Phase 2 以降で実装する。
>
> **実装済みの IDE 機能（v0.4.0 時点）**
>
> - **F-9 エクスプローラー＋エディタ**: 遅延ロードのファイルツリー、Monaco での編集と ⌘S 保存、
>   Claude がファイルを書き換えたら編集中でないものは自動リロード
> - **F-10 Git ツリー（VS Code 風 SCM）**: ステージ済み/変更の分離、stage/unstage、コミット、
>   差分からのコミットメッセージ自動生成
> - **F-11 診断ビュー**: 環境情報＋サニタイズ済みログ（issue にそのまま貼れる）
>
> **セキュリティ追記（§6 の適用）**: ファイル読み書き・git 操作の対象ディレクトリは
> 「ユーザーが明示的に開いた場所」の許可リスト（WorkspaceRegistry）に限定し、
> 相対パスは字面（`../`・絶対パス）と **symlink 実体（realpath）** の両方で検証する。
> ディレクトリ作成は実体検証の**後**に行う。

### F-4 GUI 差分レビュー（Phase 2）

- セッションが加えた変更を `git diff` で取得し、Monaco の diff エディタで表示
- ファイル単位で **承認 / 巻き戻し**
- コミット単位のチェックポイント作成と復元
- レビューコメントをそのまま次の指示としてセッションへ送る導線

### F-5 並列セッション管理（Phase 3）

- **タスク ＝ worktree ＝ セッション** を 1:1:1 で紐付ける
- タスク作成時に `git worktree add` を自動実行、完了時に破棄
- カンバン表示（待機中 / 実行中 / 承認待ち / レビュー待ち / 完了）
- セッション横断のイベントストリームを 1 画面で俯瞰
- 同時実行数の上限設定（コスト暴走防止）

### F-6 設定・スキルラボ（Phase 4）

- `CLAUDE.md`, `.claude/skills/`, `.claude/agents/`, hooks 設定を GUI で編集
- 編集前後で同じプロンプトを流し、挙動を並べて比較する A/B 実行
- skills / subagents のテンプレートギャラリー
- **スキル検索・発見**（2026-08-11 ユーザー要望で追加）：
  - インストール済み skills / subagents / plugins の横断検索
  - 「こんなスキルない？」と自然言語で尋ねると候補を探して提示する
  - 検索対象はまずローカル資産。公開マーケットプレイス等の外部検索は**ユーザーが明示的に実行した場合のみ**（§6-4 のテレメトリ禁止と区別する。暗黙の外部送信はしない）
  - 見つかったスキルの導入（インストール）導線まで提供する
- **ヘルプチャット**（2026-08-11 ユーザー要望で追加）：
  - 「この画面は何？」「worktree タスクはどう作る？」など Nimbus 自体の使い方をチャットで聞ける
  - 実装方針：専用ボットは作らず、**Nimbus の使い方ドキュメントをコンテキストに与えたプリセットセッション**として提供する（ユーザーの Claude 接続・課金モードをそのまま使う）
  - **サポート担当キャラクター設定**を持つ：ユーザーが普段使うペルソナ系スキルをヘルプチャットの「担当者」として割り当てられ、担当者が名乗って対応する（例：「チャットサポートシステムを担当する『ゆあ』です」）。OSS 配布時の既定はニュートラル（キャラなし）とし、Nimbus 側でキャラクターを固定しない

### F-7 接続設定（BYO Claude Code）— **Phase 1 で必須**

**大原則：Nimbus は認証を代行しない・預からない。** ログインはユーザーが CLI 側で完了させ、
Nimbus はその結果に乗るだけとする。

対応する接続方式：

| 方式 | 内容 |
|---|---|
| **① Claude Code ログイン（既定）** | ユーザーが既に `claude` でログイン済みの状態を利用する。Nimbus は資格情報に一切触れない |
| **② API キー** | Claude Console で発行した API キーを環境変数として渡す。動的供給用のヘルパー設定にも対応する |
| **③ クラウドプロバイダ** | Amazon Bedrock / Google Cloud / Microsoft Foundry。各プロバイダの資格情報をそのまま利用する。プロファイルごとの環境変数設定で対応 |

実装要件：

1. **バイナリ選択**：SDK 同梱バイナリ / ユーザーがインストールした `claude`（`which claude` で自動検出）を設定で切替可能にする。選択中のバージョンを `claude --version` で表示
2. **接続テストボタン**：軽量なクエリを 1 回投げ、返ってきた初期化イベントからモデル名・MCP・プラグインを表示する
3. **課金モードの明示**：ステータスバーに「サブスク利用（利用上限を消費）」か「API キー利用（従量課金・累計 $X.XX）」かを常時表示する。**ユーザーが自分の請求形態を誤認しないことは、このプロダクトの信頼性そのものである**
4. **プロファイル**：仕事用 / 個人用などを複数登録し、切替可能にする。ワークスペースごとに使用プロファイルを固定できること
5. **未接続時の導線**：接続が未設定なら、CLI でのログイン方法を案内する。**Nimbus 内でログインフォームを実装してはならない**

### F-8 テーマ（VS Code 方式）— **Phase 1 で必須**

#### 仕組み

- **UI の全色を CSS Custom Properties（`--nimbus-*`）で描画する。** テーマ切替は `:root` の変数差し替えのみで完結させ、**再起動不要の即時反映** とする
- テーマは JSON で定義する。色キーの命名は **VS Code の workbench color key に寄せる**（既存テーマの移植を容易にするため）
- `~/.nimbus/themes/*.json` に置くだけで自動認識・ホットリロードされること
- OS のダークモード追従（`nativeTheme.shouldUseDarkColors`）に対応
- フォントファミリ / サイズ / 行間も同じ設定画面で変更可能にする

#### テーマ定義スキーマ

```jsonc
{
  "name": "My Theme",
  "type": "dark",              // "dark" | "light" | "highContrast"
  "author": "...",
  "colors": {
    "editor.background": "#12161f",
    "editor.foreground": "#d6dae3",
    "sideBar.background": "#0d1117",
    "statusBar.background": "#0d1117",
    "nimbus.accent": "#e8c98a"
  },
  "tokenColors": [ /* シンタックスハイライト定義 */ ]
}
```

#### 内蔵テーマ（命名由来と配色を一致させること）

| テーマ名 | 配色コンセプト |
|---|---|
| **Nimbus Dark**（既定） | 雨雲の深い青灰ベース ＋ 光背の淡い金がアクセント |
| **Nimbus Light** | 高層の薄雲。白基調 ＋ やわらかい影 |
| **Cumulonimbus** | 積乱雲。ハイコントラスト |

#### 既知の制約（実装時に判断すること）

VS Code のシンタックスハイライトは TextMate 文法（scope）ベースであり、
Monaco の標準テーマ定義とはトークンの粒度が異なる。
そのため **「VS Code のテーマ JSON をそのまま読める」とは謳わないこと。**

以下いずれかを実装フェーズで検証し、採用方針を決定すること：

- (a) VS Code テーマ → Monaco テーマへの変換レイヤーを自前で持つ（互換は部分的）
- (b) TextMate 文法をそのまま解釈できるハイライタ（Shiki 等）を採用する

---

## §5 設定ファイル仕様

VS Code と同じ **二層構造** とする。

```
~/.nimbus/settings.json           … ユーザー設定
<project>/.nimbus/settings.json   … ワークスペース設定（ユーザー設定を上書き）
~/.nimbus/themes/*.json           … ユーザーテーマ
~/.nimbus/profiles.json           … 接続プロファイル（機密は含めない）
```

- **GUI 設定画面と JSON 直接編集の両方をサポートする。** 双方向に反映されること
- **資格情報を `settings.json` に書いてはならない**（§6 参照）
- 設定スキーマは zod で定義し、不正な設定は起動時に警告表示して既定値へフォールバックする

---

## §6 セキュリティ要件（**必須・妥協不可**）

OSS として公開する以上、以下は実装の前提条件とする。

1. **API キーは OS のセキュアストレージに保存する。**
   Electron の `safeStorage` API を使用（macOS Keychain / Windows DPAPI / Linux libsecret）。
   **平文 JSON への書き込みは禁止。**
2. **ログ・DB のマスキング層を必ず挟む。**
   イベントログを SQLite に保存する前に、API キー形式の文字列・トークン・環境変数値を
   マスクするサニタイザを通すこと。
   これは **利用者が issue にログを貼り付けて資格情報を流出させる事故** を防ぐための必須要件である。
3. **エラーレポート / クラッシュログにも同じサニタイザを適用する。**
4. **テレメトリ・外部送信は一切実装しない。**
5. **`contextIsolation: true` / `nodeIntegration: false` / `sandbox: true` を維持する。**
6. **エクスポート機能を作る場合は、書き出し前に必ずマスキング後の内容をプレビュー表示する。**

---

## §7 OSS 公開要件

1. **ライセンス**：MIT
2. **README**：英語を主、日本語を併記。**§1 の命名由来を必ず含める**
3. **商標配慮**：README に「本プロダクトは Anthropic の公式製品ではなく、Anthropic とは無関係の非公式ツールである」旨を明記する
4. **名前の衝突対策**：`Nimbus` は既存プロジェクトが多い名称である。
   - リポジトリ名：`nimbus`
   - npm パッケージ名 / アプリ ID：`nimbus-code` などに逃がす
   - Bundle ID：`dev.idris.nimbus`
   - **公開前に npm / GitHub / 商標の空き状況を必ず調査すること**
5. **CONTRIBUTING.md**：開発環境セットアップ手順（Node バージョン、Claude Code の準備方法）を明記
6. **スクリーンショット**：README にコックピット画面と承認インボックスの画像を掲載する

---

## §8 実装フェーズ

| Phase | 内容 | 完了時に得られるもの |
|---|---|---|
| **0** | F-1 セッション実行エンジン ＋ イベント正規化 ＋ SQLite 保存 | 心臓部 |
| **1** | 単一セッション UI ＋ F-2 可視化 ＋ F-3 承認インボックス ＋ **F-7 接続設定** ＋ **F-8 テーマ** | 日常的に使えるレベル |
| **2** | F-4 GUI 差分レビュー | レビュー体験の改善 |
| **3** | F-5 並列 worktree ＋ カンバン | Nimbus 固有の価値が完成 |
| **4** | F-6 設定・スキルラボ | 拡張性の完成 |

**Phase 1 完了時点で「毎日使えるツール」になっていること** をゴールとする。
機能を横に広げるより、Phase 1 の完成度を優先すること。

---

## §9 実装オーダー（Phase 0 - 1）

以下を順に実装してください。各ステップ完了時にコミットし、動作確認できる状態を保ってください。

### テスト方針（2026-08-11 追記・全 Step 共通）

**テスト作業は念入りに行い、確認項目は細かく分けて網羅的に実施すること。**

1. 各 Step の「完了」条件は次の両方を満たすこと：
   - **自動テスト**（vitest）が全件パス。純ロジック — イベント正規化・サニタイザ・設定マージ・テーマ解決・自動承認ルール判定・プロファイル切替など — はユニットテスト必須。DB 層は一時ファイル DB を使った統合テスト
   - **確認チェックリスト**の全項目消化。`docs/testing/step-N.md` に確認項目を**細かく分解して**列挙し、実施結果（OK/NG・確認方法・実施日）を記録してからコミットする
2. セキュリティ要件（§6）は専用チェックリストを持ち、リリース前だけでなく資格情報・ログ経路に触れた Step ごとに回す
3. 多重セッション前提（§3 原則 5）の検証 — 同一プロジェクトに対する同時 2 セッション以上での動作確認 — を Phase 0 のチェックリストから組み込む
4. NG になった項目は修正後に**チェックリスト全体を再実施**する（部分再確認で済ませない）

### Step 1 — プロジェクト初期化

- Electron + Vite + React + TypeScript のプロジェクトを作成
- `§3` のディレクトリ構成を作る
- ESLint / Prettier / TypeScript strict モードを設定
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` で起動確認

### Step 2 — Claude 連携の疎通（F-1）

- Claude Agent SDK を導入し、**まず CLI 相当の 1 往復** をメインプロセスから実行して標準出力に流す
- ストリーミングイベントを受信し、Nimbus 独自の正規化イベント型（`shared/events.ts`）に変換する
- 型付き IPC で Renderer に流し、最小限のチャット UI で表示する

### Step 3 — 永続化（F-1）

- better-sqlite3 でスキーマを作成：`sessions` / `events` / `costs` / `workspaces`
- **保存前に §6 のサニタイザを通す**
- セッション一覧と再開機能を実装

### Step 4 — 接続設定（F-7）

- 設定画面の「接続」タブを実装
- 接続方式の切替（Claude Code ログイン / API キー / クラウドプロバイダ）
- `claude` バイナリの自動検出とバージョン表示
- API キーは `safeStorage` で暗号化保存
- 接続テストボタン（初期化イベントからモデル名等を表示）
- ステータスバーに課金モードを常時表示
- プロファイルの複数登録と切替

### Step 5 — テーマ基盤（F-8）

- **UI の全色を CSS 変数化する**（この時点でやりきること。後から直すのは高コスト）
- テーマローダを実装し、内蔵 3 テーマを用意
- `~/.nimbus/themes/*.json` の自動読み込みとホットリロード
- 設定画面の「テーマ」タブ ＋ OS ダークモード追従
- フォント設定

### Step 6 — コンテキスト可視化（F-2）

- 初期化イベントのメタデータをパースし、サイドパネルに表示
- コスト累計とトークン使用量の推移グラフ
- 適用中の `CLAUDE.md` 階層の表示

### Step 7 — 承認インボックス（F-3）

- ツール実行前フックで実行を保留し、承認待ちキューに積む
- キューの一覧 UI（まとめて承認 / 個別承認 / 拒否）
- 自動承認ルールの登録
- OS 通知連携

### Step 8 — 仕上げ

- README（**命名由来を含める**）、LICENSE（MIT）、CONTRIBUTING.md を作成
- スクリーンショットを撮影して README に掲載

---

## §10 実装前に必ず検証すること

**このドキュメントの技術記述を鵜呑みにせず、着手前に以下を公式ドキュメントで確認し、
結果をこのファイルに反映してから実装を開始してください。推測での実装は禁止です。**

確認先：

- Claude Code ドキュメント： https://code.claude.com/docs/en/overview
- Agent SDK（TypeScript）リファレンス： https://code.claude.com/docs/en/agent-sdk/typescript
- Headless mode： https://code.claude.com/docs/en/headless
- npm： https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk

確認項目：

1. **パッケージ名と import 名**（`@anthropic-ai/claude-agent-sdk` / `query` / 状態保持クライアントの正式名称）
2. **状態を保持する対話セッションの正しい生成方法**（`query()` との使い分け）
3. **ツール実行前に介入するための正式な API**（権限コールバック / hooks の名称・シグネチャ・戻り値の型）
4. **ストリーミングイベントの型定義**（初期化イベントに含まれるフィールド、結果イベントのコスト情報のキー名）
5. **セッション再開の正しい方法**（セッション ID の取得場所と再開時の指定方法）
6. **中断（interrupt）の API**
7. **同梱バイナリの扱い**（別途 Claude Code のインストールが必要か、実行ファイルパスを指定するオプション名）
8. **認証方式ごとの環境変数名**（Anthropic API / 各クラウドプロバイダ）
9. **プログラム経由の利用がサブスクリプションの利用上限を消費するかどうかの最新の扱い**
   → F-7 の課金モード表示の文言に直結するため、**必ず最新情報を確認すること**
10. Electron `safeStorage` の各 OS での可用性と、利用不可時のフォールバック方針

### §10 検証結果（2026-08-11 実施）

> 7 領域を並列調査し、課金ポリシーと権限 API は別エージェントによる敵対的クロスチェック済み。
> 出典 URL 付きの生データは `docs/research/sdk-verification-2026-08-11.json`。
> 以下、**この記述が本ドキュメント内の他の記述と食い違う場合はこちらを正とする。**

1. **パッケージ**：`@anthropic-ai/claude-agent-sdk`（0.3.x 系。Claude Code 本体とバージョン同期、要 Node 18+）。主要 export は `query()` ほか `startup()`, `listSessions()`, `getSessionMessages()`, `getSessionInfo()` 等。**V2 セッション API（`unstable_v2_*`）は 0.3.142 で削除済み。`query()` が唯一の正式 API**（インストール時に `npm view` で最新版を確認すること）
2. **状態保持セッション**：`query({ prompt: AsyncIterable<SDKUserMessage> })` の**ストリーミング入力モード**を使用。yield する形は `{ role: 'user', content: string }`。TS 版に Python のようなクライアントクラスは存在しない
3. **ツール実行前介入**：承認インボックスには **`canUseTool`** コールバックを使用。
   - シグネチャ：`(toolName: string, input: Record<string, unknown>, options: { signal, suggestions?, toolUseID, agentID?, blockedPath?, decisionReason?, requestId? }) => Promise<PermissionResult>`
   - 戻り値：許可 `{ behavior: 'allow', updatedInput, updatedPermissions? }` ／ 拒否 `{ behavior: 'deny', message }`
   - **タイムアウトなし＝無期限保留可**（承認インボックスに最適。クエリ自体の abort でのみ解除）
   - 評価順序：hooks → deny ルール → ask ルール → permissionMode → allow ルール → canUseTool。**早期段階で許可されたツールは canUseTool に届かない**
   - permissionMode は 6 値：`default` / `dontAsk` / `acceptEdits` / `bypassPermissions` / `plan` / `auto`。実行中に `query.setPermissionMode()` で変更可
   - 全ツール横断の監査・強制ゲートには PreToolUse フック（戻り値は `{ hookSpecificOutput: { permissionDecision: 'allow'|'deny'|'ask'|'defer', updatedInput?, permissionDecisionReason? } }`）
4. **イベント型**：init は `{ type:'system', subtype:'init' }` で model / tools / mcp_servers / plugins / skills / slash_commands / agents / cwd / permissionMode / apiKeySource / output_style / session_id / uuid / capabilities を持つ（F-2 の想定どおり）。結果は `{ type:'result' }` で `total_cost_usd`（**クライアント側推定値**）/ `usage`（input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens）/ `modelUsage`（モデル別・サブエージェント含む最も正確な集計）/ num_turns / duration 系 / session_id。トークン単位表示は `includePartialMessages: true` → `type:'stream_event'`（生の Anthropic API イベントをラップ、text は content_block_delta から自前で再構成）。ほかに task_progress / hook_started / compact_boundary / api_retry / plugin_install など
5. **再開**：session_id は init と result の両方に載る。`options.resume: sessionId` で再開、`+ forkSession: true` で分岐。実体は `~/.claude/projects/<encoded-cwd>/*.jsonl`
6. **中断**：`query()` の戻り値（Query オブジェクト）に対し `await q.interrupt()`
7. **バイナリ**：SDK は OS 別ネイティブバイナリを optionalDependencies として**同梱**（追加インストール不要。`--omit=optional` 時は PATH の `claude` にフォールバック）。明示指定は `pathToClaudeCodeExecutable`。**`env` オプションは置換であってマージではない — 必ず `...process.env` をスプレッドすること**
8. **認証環境変数**：`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / apiKeyHelper（settings）/ `CLAUDE_CODE_OAUTH_TOKEN`（`claude setup-token` で発行・サブスク認証・1年有効）。Bedrock：`CLAUDE_CODE_USE_BEDROCK=1`＋AWS 資格情報チェーン（`CLAUDE_CODE_USE_MANTLE` もあり）。Vertex：`CLAUDE_CODE_USE_VERTEX=1`＋`CLOUD_ML_REGION`＋`ANTHROPIC_VERTEX_PROJECT_ID`。Microsoft Foundry：`CLAUDE_CODE_USE_FOUNDRY=1`＋`ANTHROPIC_FOUNDRY_API_KEY` or `ANTHROPIC_FOUNDRY_AUTH_TOKEN`＋`ANTHROPIC_FOUNDRY_RESOURCE` or `ANTHROPIC_FOUNDRY_BASE_URL`。優先順位：クラウド > AUTH_TOKEN > API_KEY > apiKeyHelper > OAUTH_TOKEN > `/login` の OAuth。モデル指定：`ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`
9. **課金（クロスチェック済・2026-08-11 時点）**：SDK / `claude -p` / サードパーティアプリ経由の利用は**サブスクの利用上限を消費する**（2026-06-15 予定だった別枠クレジット化は公式に一時停止中。再変更があり得るため定期確認）。`total_cost_usd` は認証方式に関わらず入るが推定値であり、正式請求額は Usage & Cost API が正。`apiKeySource` の enum 値は公式ドキュメント未記載 → **実装時に SDK の `index.d.ts` で確認**。
   **⚠️ ポリシー上の重要事項**：公式ドキュメントに「Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK.」（agent-sdk/overview）の明記あり。Nimbus はログイン UI を実装しない BYO 設計だが、**接続方式①（CLI ログイン利用）を既定として推奨する見せ方は OSS 公開前に要再検討**（課金モード表示の文言にも反映する）
10. **safeStorage**：同期 API に加え **Electron 42+ の非同期 API（`isAsyncEncryptionAvailable` / `encryptStringAsync` / `decryptStringAsync`）が公式推奨**。`decryptStringAsync` は `{ shouldReEncrypt, result }` を返す（キーローテーション時は再暗号化して保存し直す）。**Linux は keyring 不在時に `basic_text`（実質平文）で「成功」する罠**があるため、`isEncryptionAvailable` に加えて `getSelectedStorageBackend() !== 'basic_text'` をゲートし、不可なら保存を拒否（メモリ保持＋ユーザー警告。平文保存は明示的オプトインのみ）。現行 stable は Electron 43

**ビルドスタックの検証結果（§2 の補強）：**

- scaffold は **electron-vite 5.0.0**（`npm create @quick-start/electron@latest -- --template react-ts`）。create-electron-vite は 2 年更新なしで不採用、Forge の Vite プラグインは公式に experimental 扱い
- **Vite は ^7 のまま使う**（electron-vite 5 の peerDependencies は ^5||^6||^7。Vite 8 に上げない）
- electron-vite 5 では `externalizeDepsPlugin` が廃止 → `build.externalizeDeps` オプション＋ネイティブアドオンは `build.rollupOptions.external`
- **better-sqlite3 13.x は N-API 化**されプリビルトバイナリ同梱 → `@electron/rebuild` は原則不要（Node >= 22 必須）。`dependencies` に置き external 指定
- Monaco 0.56.0：Vite の `?worker` import で worker を設定（vite-plugin-monaco-editor は 4 年停滞で不採用）。**`loader.config({ monaco })` で CDN 読み込みを必ず無効化**（Electron ではデフォルトの CDN 参照が死ぬ）。シンタックスハイライトは **Shiki（@shikijs/monaco）を採用 → §4 F-8 の選択肢 (b) に決定**
- zod 4 / zustand 5 / ESLint 10（flat config のみ、eslintrc 完全削除）/ React 19 / electron-builder 26（27 は alpha）

---

## 付録：確認事項リスト（実装者向けチェックリスト）

- [x] §10 の 10 項目を公式ドキュメントで確認し、本ドキュメントを更新した（2026-08-11、検証結果は §10 末尾）
- [x] README に命名の由来を掲載した（原文＋英訳）
- [x] README に「Anthropic 非公式」の但し書きを入れた（英日両方）
- [x] 資格情報が平文で保存される経路が存在しないことを確認した（CredentialVault は暗号化不可なら保存拒否。docs/testing/step-4.md C-1〜C-6）
- [x] ログ・DB・エラーレポートすべてにサニタイザが適用されている（DB 書き込みは Store.record の単一点に集約。docs/testing/step-3.md）
- [x] UI の色がすべて CSS 変数経由になっており、ハードコードされた色が残っていない（docs/testing/step-5.md B-1）
- [x] テーマ切替が再起動なしで反映される（ホットリロード実発火を E2E 確認。docs/testing/step-5.md）
- [x] 課金モードがステータスバーに常時表示される（実測 apiKeySource='none' の誤表示バグを検出・修正済み。docs/testing/step-8.md）
- [x] npm の名前空き状況を調査した（nimbus-code は 404=未登録、nimbus は既存→回避方針どおり）。GitHub/商標の本調査は公開直前に実施
