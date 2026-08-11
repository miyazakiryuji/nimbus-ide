# F1 確認チェックリスト — フォークが「Nimbus」としてビルド・起動する

- 実施日: 2026-08-12
- ベース: Code - OSS タグ **1.132.0** / ブランチ `nimbus`
- 方針: 項目を細かく分け、**実際に起動して目視**するところまでを 1 項目とする（推測で OK にしない）

## 1. ツールチェーンとビルド

| #   | 項目                                                     | 結果 | 確認方法                              |
| --- | -------------------------------------------------------- | ---- | ------------------------------------- |
| A-1 | `.nvmrc` の Node 24.18.0 を用意（システム Node を汚さない） | OK   | `10_products/.toolchain/` に配置・SHA256 検証つき |
| A-2 | `npm install` が成功する                                  | OK   | exit 0 / 2 分 / node_modules 1.7GB    |
| A-3 | `npm run compile` がエラー 0 で完了する                   | OK   | 0 errors / 39 秒                      |
| A-4 | `./scripts/code.sh` で開発ビルドが起動する                | OK   | プロセス `Nimbus.app/Contents/MacOS/Nimbus` |

## 2. 身元（ブランディング）

| #   | 項目                                                       | 結果 | 確認方法                             |
| --- | ---------------------------------------------------------- | ---- | ------------------------------------ |
| B-1 | 開発ビルドの実体が `Nimbus.app` になる                     | OK   | `.build/electron/Nimbus.app`         |
| B-2 | macOS のプロセス名／メニューバーが「Nimbus」               | OK   | System Events で frontmost 名を取得  |
| B-3 | Welcome 画面のタイトルが「Nimbus Dev」                     | OK   | スクリーンショット目視               |
| B-4 | 副題が VS Code のキャッチコピーでない                      | OK   | 「A cockpit for your agents」        |
| B-5 | ウォークスルーが「Get started with Nimbus Dev」            | OK   | スクリーンショット目視               |
| B-6 | データフォルダ・バンドル ID・URL スキームが Nimbus 固有     | OK   | product.json（`.nimbus` / `dev.idris.nimbus` / `nimbus`） |
| B-7 | アイコンが独自意匠（VS Code / Electron のロゴを使わない）   | OK   | `make-icon.mjs` で生成し icns を差し替え |

## 3. Copilot の露出を止める

| #   | 項目                                                              | 結果 | 確認方法                        |
| --- | ----------------------------------------------------------------- | ---- | ------------------------------- |
| C-1 | 初回起動で「Sign in to use GitHub Copilot」モーダルが出ない        | OK   | **user-data-dir を消した素の初回起動**で目視 |
| C-2 | タイトルバーに Copilot の「Sign In」ボタンが出ない                | OK   | 同上                            |
| C-3 | 右側の CHAT パネル（Build with Agent）が出ない                    | OK   | 同上                            |
| C-4 | `defaultChatAgent` 削除は**不可**と判明し、設定既定値で止めた      | OK   | 削除時は起動せず（台帳に記録）  |
| C-5 | Microsoft のサービス既定値（音声 WS・Webview CDN）を持ち込まない   | OK   | product.json から削除           |

## 4. 拡張機能ギャラリー（Open VSX）

| #   | 項目                                                       | 結果 | 確認方法                        |
| --- | ---------------------------------------------------------- | ---- | ------------------------------- |
| D-1 | `extensionsGallery` が Open VSX を向く                     | OK   | product.json                    |
| D-2 | 組み込み拡張のダウンロードが成功する                       | OK   | js-debug ほか 3 件取得          |
| D-3 | ハッシュ不一致を検知して**中身の身元を検証してから**固定した | OK   | VSIX 内 package.json で publisher/name/version 一致を確認 |
| D-4 | **実際に拡張をインストールできる**（Open VSX から）        | OK   | パッケージ版 CLI で `redhat.vscode-yaml v1.24.0` の導入に成功 |
| D-5 | 悪意ある拡張の停止リスト（`controlUrl`）を設定している      | OK   | product.json                    |

## 5. パッケージ版（`npm run gulp vscode-darwin-arm64`）

出力先は**リポジトリの 1 階層上** `VSCode-darwin-arm64/`（gulpfile がパス名を固定している）。

| #   | 項目                                        | 結果 | 確認方法                          |
| --- | ------------------------------------------- | ---- | --------------------------------- |
| E-1 | ビルドが成功する                            | OK   | exit 0                            |
| E-2 | `Nimbus.app` として出力される               | OK   | ls                                |
| E-3 | `CFBundleName` = Nimbus                     | OK   | PlistBuddy                        |
| E-4 | `CFBundleIdentifier` = dev.idris.nimbus     | OK   | PlistBuddy                        |
| E-5 | `CFBundleIconFile` = Nimbus.icns（独自意匠） | OK   | PlistBuddy                        |
| E-6 | URL スキーム = `nimbus`                     | OK   | PlistBuddy                        |
| E-7 | `extensions/nimbus` が同梱される            | OK   | app 内 extensions を確認          |
| E-8 | 実起動し、Copilot モーダルが出ない          | OK   | 素の user-data-dir で起動・目視    |
| E-9 | Welcome が「Nimbus / A cockpit for your agents」 | OK | スクリーンショット目視         |
| E-10 | Copilot を同梱しない                        | OK   | app 内に `extensions/copilot` が無い。サイズ 1.4G → **1.0G** |
| E-11 | CLI コマンド名が `nimbus`（`code` と衝突しない） | OK | `Nimbus.app/Contents/Resources/app/bin/nimbus` |
| E-12 | 起動時に例外が出ない                        | OK   | 起動ログ 0 件                     |

> E-9 のスクリーンショット確認は **Copilot 除去前のビルド**で実施済み。除去後の再撮影は、
> macOS の補助アクセス（Accessibility）権限が osascript に無く、ウィンドウ矩形を取得できないため未実施。
> **前面化できないまま画面全体を撮ると他ウィンドウの内容が写るため、撮影は行わない**（過去に実際に写り込んだ）。
> 権限を許可すれば `nimbus/branding/smoke-packaged.sh` がそのまま撮影まで行う。

## 6. 未了・次のタスク

- [ ] `origin` への push（**`workflow` スコープが必要**。`gh auth refresh -s workflow` をユーザーに依頼中）
- [ ] Copilot の同梱物としての完全除去（`extensions/copilot` とビルド配線・`@github/copilot*` 依存）
- [ ] 残る "VS Code" 直書き（localize 文字列で約 150 箇所）の掃除

## NG 記録と対処

| 事象 | 原因 | 対処 |
| --- | --- | --- |
| `code.sh` が起動途中で異常終了 | Open VSX 版 VSIX のハッシュが product.json（Marketplace 版）と不一致 | 中身の身元を検証したうえで Open VSX 版のハッシュに同期するスクリプトを作成 |
| ワークベンチが真っ白・例外 | `defaultChatAgent` を削除した | 削除は不可。`chat.disableAIFeatures` の既定値で止める |
| 拡張の `configurationDefaults` で抑止できない | 起動時のオンボーディング判定に間に合わない | コアの既定値そのものを変更（Nimbus マーカーで囲む） |
| スクリーンショットに**別ウィンドウの個人的な内容が写り込んだ** | 対象アプリが前面でないまま座標指定で撮影した | 前面化 → frontmost が Nimbus であることを確認 → ウィンドウ矩形のみ撮影、の順を必須手順にした（写り込んだ画像は破棄） |
| 拡張が 1 つもインストールできない（`not iterable`） | `builtInExtensionsEnabledWithAutoUpdates` をキーごと削除した | 削除ではなく空配列に。「消す」ではなく「空にする」が正解の場合がある |
| 拡張のインストールが `Signature verification was not executed.` で失敗 | Open VSX の拡張は Microsoft 署名を持たず、OSS ビルドに検証機構も無い | `extensions.verifySignature` の既定値を false に（停止リスト `controlUrl` を代替の防御として維持） |
| パッケージビルドが `Copilot SDK directory not found` で失敗 | 出力先 `VSCode-darwin-arm64/` を手で書き換えた状態で再ビルドした（差分パッケージが不整合に） | 出力先を消してクリーンビルド。Copilot の ripgrep シムがビルド成功の前提になっている点も要注意 |
