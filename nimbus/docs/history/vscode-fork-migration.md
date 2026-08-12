# Nimbus 方針転換 — Code - OSS フォーク（Cursor 方式）への移行計画

- 決定日: 2026-08-12（ユーザー指示「VS Code ベースで作成していく。Code - OSS をフォークする（Cursor 方式）」）
- 対象: これまでの Electron 自前実装（v0.1.0 〜 v0.5.0）から、**VS Code（Code - OSS）フォーク**へ土台を変更する

## 1. なぜ変えるのか / 何が変わるのか

自前 Electron では「IDE の土台」を作り続ける必要があった。フォークにすると **エディタ・ファイルツリー・SCM・検索・拡張機能・キーバインド・多言語・アクセシビリティ** が最初から手に入り、
Nimbus の独自価値（Claude Code の操縦席 = セッション・承認・並列タスク・コスト可視化）に集中できる。

代償は **upstream 追従コスト**。これを最小化するため、本計画では次を原則とする。

> **原則: コア（`src/vs/**`）への変更は最小限にとどめ、Nimbus の機能は「組み込み拡張」として実装する。**
> コアに触るのはブランディングと、拡張 API では届かない箇所のみ。触った箇所は必ず記録する。

## 2. 資産の引き継ぎ（v0.5.0 → フォーク）

| 既存資産 | 移行先 | 備考 |
| --- | --- | --- |
| SessionManager / normalize（Agent SDK 連携） | 拡張の Node 側へ**ほぼそのまま** | 依存が Node のみのため移植容易 |
| PermissionBroker（canUseTool 承認） | 拡張の Node 側＋VS Code ネイティブ UI | UI は通知/QuickPick/ビューへ |
| sanitizer（§6 マスキング） | そのまま | ログ・DB・診断で継続使用 |
| Store（SQLite・イベント/コスト/タスク） | そのまま | better-sqlite3 は拡張ホストでも動く（ABI 要確認） |
| ConnectionService / CredentialVault | 拡張へ（保存は VS Code SecretStorage を第一候補） | safeStorage 相当が標準 API で使える |
| TaskService / WorktreeManager | そのまま | カンバンのみ Webview 化 |
| GitService（diff/stage/commit/checkpoint） | **大半を破棄**、標準の Git 拡張へ | AI コミットメッセージ生成だけ残す |
| FileService / FileWatcher / ExplorerView | **破棄** | VS Code のエクスプローラー・エディタが上位互換 |
| MenuBar / ActivityBar / StatusBar / テーマ基盤 | **破棄** | VS Code 標準（テーマも Marketplace 資産が使える） |
| 検証資産（docs/testing・サニタイザ/権限のテスト） | 継続 | テスト方針（§9）はフォークでも維持 |

> 破棄する UI 群は無駄ではなく、**要件と使い勝手の実証**として機能した（例: 課金モード表示の誤表示バグ、承認キューの設計）。仕様は `NIMBUS_SPEC.md` に残す。

## 3. フェーズ分割

### F0 — 調査と方針決定（本ドキュメント）
- ライセンス（MIT）・商標・Marketplace 利用可否・ビルド前提の**一次情報での確認**
- リポジトリ戦略と upstream 追従方針の決定
- 完了条件: 本ドキュメントに検証結果が反映され、F1 に着手できる

### F1 — フォークが「Nimbus」としてビルド・起動する
- 依存インストール → 開発起動（`./scripts/code.sh`）
- `product.json` でリブランド（`nameShort` / `nameLong` / `applicationName` / `dataFolderName` / `darwinBundleIdentifier` / `urlProtocol` ほか）
- アイコン・製品リソース差し替え（雨雲の青灰 ＋ 光背の淡い金）
- 拡張ギャラリーを **Open VSX** に切替（Microsoft Marketplace は利用不可）
- macOS パッケージビルド
- 完了条件: **Nimbus 名義のアプリが起動し、拡張機能を検索・インストールできる**

### F2 — Nimbus コア機能を組み込み拡張として移植
- `extensions/nimbus/` を新設（built-in extension として同梱）
- セッション実行エンジン・承認・永続化・接続設定を移植
- チャットは Webview、承認は VS Code ネイティブ UI
- 完了条件: **フォーク内で実 Claude セッションが動く**（実 SDK 疎通テスト）

### F3 — IDE ネイティブ統合
- Claude の編集を標準 diff / decoration で提示（自前 diff は捨てる）
- 承認インボックスをネイティブ UI に統合（通知・QuickPick・ビュー）
- コンテキスト可視化と**課金モード/コストのステータスバー常時表示**（F-7-3 は維持）
- 完了条件: 「操縦席」体験が VS Code の作法で完結する

### F4 — 並列タスク（worktree × カンバン）
- TaskService / WorktreeManager を移植、カンバンは Webview
- worktree を別ウィンドウで開く導線（VS Code のマルチウィンドウを活用）
- 完了条件: 複数タスクを並列で回し、状態を俯瞰できる

### F5 — 配布と upstream 追従の運用
- macOS 配布（ad-hoc 署名 → 将来は公証）、GitHub Releases
- upstream の定期取り込み手順（コンフリクト最小化・記録）
- README / LICENSE / NOTICE の帰属表記（Code - OSS ベースであることの明示）
- 完了条件: 「修正のたびに固めて配布」の運用がフォークでも回る

## 4. リポジトリ戦略（確定）

- フォーク: **https://github.com/miyazakiryuji/nimbus-ide**（Public・`microsoft/vscode` の GitHub フォーク）
  - サーバー側コピーのため 1.3GB のアップロードが不要。フォーク関係が明示されるのは**出自として正直**でもある
- ローカル: `10_products/nimbus-ide`、`origin` = nimbus-ide / `upstream` = microsoft/vscode
- **ベースは開発中の `main` ではなく安定リリースタグ `1.132.0`（2026-08-04）**。作業ブランチは `nimbus`
- Node は `.nvmrc` の **24.18.0** をリポジトリ外の `10_products/.toolchain/` に配置（システム Node 22 を汚さない）
- 既存 `nimbus`（Electron 版 v0.1.0〜v0.5.0）は**そのまま残す**（破壊しない）
- 個人情報を上げない運用・コミットごとの push・修正のたびのパッケージ化は**フォークでも継続**

## 5. 検証結果（F0・一次情報で確認済み / 2026-08-12）

### 5-1. ライセンスと帰属義務 ✅

- ソースは **MIT**（`LICENSE.txt` = "Copyright (c) 2015 - present Microsoft Corporation"）。フォーク・商用利用・再配布とも可
- Microsoft がビルドして配る「Visual Studio Code」だけが**独占ライセンス**。README 原文でも "a distribution of the `Code - OSS` repository with Microsoft-specific customizations released under a traditional Microsoft product license" と区別されている
- **義務**: MIT の著作権表示と許諾文を保持（`LICENSE.txt`）、`ThirdPartyNotices.txt` を同梱、`cgmanifest.json` / `cglicenses.json` を維持
- **フォークするのは MIT のソースであり、Microsoft のビルド済みバイナリではない**

### 5-2. 商標・ブランディング ✅

- 公式ブランドガイドライン（code.visualstudio.com/brand）が禁じるもの: 製品名「Visual Studio Code」「VS Code」を自社製品・サイト・ドメインに使うこと、Microsoft の推奨を示唆する命名、**アイコンを自社製品の識別に使うこと**、アイコンの改変、Insiders/Exploration/macOS アイコンの使用
- ブランディングの切替口は **`product.json`**（リポジトリ直下）。実在キー:
  - 基本: `nameShort` `nameLong` `applicationName` `dataFolderName` `sharedDataFolderName` `urlProtocol` `licenseName` `licenseUrl` `licenseFileName` `reportIssueUrl`
  - macOS: `darwinBundleIdentifier` `darwinProfileUUID` `darwinProfilePayloadUUID`
  - Windows: `win32MutexName` `win32DirName` `win32NameVersion` `win32RegValueName` `win32x64AppId` `win32arm64AppId` `win32x64UserAppId` `win32arm64UserAppId` `win32AppUserModelId` `win32ShellNameShort` `win32TunnelServiceMutex` `win32TunnelMutex`
  - Linux: `linuxIconName` / サーバー: `serverApplicationName` `serverDataFolderName` `tunnelApplicationName` ほか
- アイコン等の実体は **`resources/`**（`resources/darwin/*.icns`・`resources/linux/`・`resources/win32/`）

### 5-3. 拡張機能マーケットプレイス ✅（重要）

- **Microsoft Marketplace はフォークでは使えない。** 利用規約（2025年9月改訂・M264）§2.b が、対象製品（Visual Studio / VS Code / Codespaces / Azure DevOps）**以外での利用を明確に禁止**。VS Code FAQ も "alternative products including those built on a fork of the Code - OSS Repository" を除外すると明記
- 実際に 2025年4月、Microsoft の C/C++ 拡張が Cursor・VSCodium で動作しないよう制限された前例がある
- **採用: Open VSX（Eclipse Foundation）**。`product.json` に以下を追加する（OSS 版には `extensionsGallery` キーが存在しないため新規追加）:

```json
"extensionsGallery": {
  "serviceUrl": "https://open-vsx.org/vscode/gallery",
  "itemUrl": "https://open-vsx.org/vscode/item",
  "latestUrlTemplate": "https://open-vsx.org/vscode/gallery/{publisher}/{name}/latest",
  "controlUrl": "https://raw.githubusercontent.com/EclipseFdn/publish-extensions/refs/heads/master/extension-control/extensions.json"
},
"linkProtectionTrustedDomains": ["https://open-vsx.org"]
```

  `controlUrl` は悪意ある拡張の停止リスト。**名前だけ似た偽拡張（Open VSX 上のスクワッティング）が報告されているため、推奨拡張を出す場合は実在確認を必須にする**

### 5-4. ビルド前提（macOS arm64 / タグ 1.132.0） ✅

| 項目 | 実測値 |
| --- | --- |
| Node | **24.18.0**（`.nvmrc`。gulp は `--experimental-strip-types` で TS を直接実行） |
| パッケージマネージャ | **npm のみ**（2024-09 の `b5a6aa14a8` で yarn から移行済み） |
| Electron ヘッダ | **42.7.1**（`.npmrc` の `target` / `runtime=electron` / `build_from_source=true`） |
| その他 | Python（node-gyp 用・`setuptools` 必要）、Xcode Command Line Tools |
| リポジトリ | 1.3GB（clone 実測 1.7GB） |

```bash
npm install                        # postinstall で組み込み拡張も取得
npm run watch                      # 開発用ウォッチ
./scripts/code.sh                  # 開発ビルドを起動
npm run gulp vscode-darwin-arm64   # パッケージ（出力は 1 階層上の ../VSCode-darwin-arm64）
```

### 5-5. upstream 追従 ✅

- **VSCodium 方式**（パッチ列を毎リリース当て直す・現在 53 パッチ）は「引き算（脱ブランド）」向き
- **Positron 方式**（実フォーク＋定期マージ）は「足し算（プロダクト）」向き。コア変更を必ず
  `// --- Start Positron ---` / `// --- End Positron ---` で囲み、機能は組み込み拡張に寄せてコンフリクトを抑えている
- **Nimbus は Positron 方式を採用**。コア変更は `// --- Start Nimbus ---` / `// --- End Nimbus ---` で囲み、`docs/fork/core-changes.md` に一覧を残す

### 5-6. 組み込み拡張の追加 ✅

- `extensions/` に置くだけでよい。`build/lib/extensions.ts` の `doPackageLocalExtensionsStream()` が **`extensions/*/package.json` を glob** して自動的に同梱する（除外リストと `product.json.builtInExtensions` の重複を除く）
- `esbuild.mts` を置けば esbuild でバンドルされ、`main` が `out/` → `dist/` に書き換わる
- **ネイティブ／実行時 npm 依存の同梱は可能**。外部化する場合は `build/lib/extensions.ts` の `packagedDependenciesByExtension` に追記（実例: `'git': ['@vscode/fs-copyfile']`）。**`extensions/git/` の構成（`package.json` + `package-lock.json` + `esbuild.mts` + `.vscodeignore`）が Nimbus 拡張のひな型として最適**

### 5-7. 追加で判明した要対応事項 ⚠️

- **Code - OSS は現在 Copilot を同梱している**（`extensions/copilot/`＋`product.json` の `defaultChatAgent`、`compile-copilot` スクリプト）。Nimbus は Claude の操縦席なので、**F1 で Copilot を除去する**（VSCodium も専用パッチで除去している）
- ビルド基盤は変化が速い（gulpfile が TS 化、拡張バンドルが webpack → esbuild、`tsgo` 型チェック）。**タグ固定は必須**

## 6. F1 実施結果（2026-08-12）

**達成**: フォークが「Nimbus」として開発ビルド・パッケージ版の両方で起動する。

- 開発: `npm install`(2分) → `npm run compile`(39秒・エラー0) → `./scripts/code.sh`
- パッケージ: `npm run gulp vscode-darwin-arm64` → `../VSCode-darwin-arm64/Nimbus.app`（`dev.idris.nimbus` / URL スキーム `nimbus` / 独自アイコン）
- Welcome は「Nimbus / A cockpit for your agents」「Get started with Nimbus」
- 初回起動の Copilot サインインモーダルを抑止（詳細は `nimbus/docs/core-changes.md`）
- 検証記録: `nimbus/docs/testing/f1-fork-build.md`

**残課題**

1. **push が `workflow` スコープ不足で拒否される**（フォークが .github/workflows を 18 個含むため）。`gh auth refresh -s workflow` が必要
2. Copilot が同梱物として残っている（app 1.4GB の一因）
3. localize 文字列に残る "VS Code" 直書き（約 150 箇所）の掃除
