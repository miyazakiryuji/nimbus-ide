# コア変更の台帳

upstream（`microsoft/vscode`）のファイルに入れた変更を**すべて**ここに記録する。
追従マージのたびにこの一覧を読み返し、まだ必要か・当て方が変わっていないかを確認する。

原則:

1. コア変更は最小限。機能は `extensions/nimbus/` に置く
2. コアに入れる変更は `// --- Start Nimbus ---` / `// --- End Nimbus ---` で囲む
3. 機械的に再適用できるものは `nimbus/branding/*.mjs` のスクリプトにして、手編集を残さない

## 一覧

<!-- nimbus:base a3bf0c6b864ef0d5f6e486e0d44754ce5c879fb2 -->
ベースは `upstream/release/1.132`（上の行のコミット）。この行は追従のたびに
`nimbus/scripts/sync-upstream.sh` が書き換える。`doctor.mjs` はここを読んで
「upstream から何を変えたか」を判定する。


| # | ファイル | 変更 | 理由 | 再適用 |
| --- | --- | --- | --- | --- |
| 1 | `product.json` | 身元（名称・データフォルダ・バンドル ID・URL スキーム・Windows ID）を Nimbus に | 商標を使わず、VS Code と設定・インストールが衝突しないようにするため | `nimbus/branding/apply-product-json.mjs` |
| 2 | `product.json` | `extensionsGallery` を Open VSX に追加、`linkProtectionTrustedDomains` に open-vsx.org | Microsoft Marketplace は利用規約でフォークに開放されていない | 同上 |
| 3 | `product.json` | `trustedExtensionAuthAccess` / `builtInExtensionsEnabledWithAutoUpdates` を**空にする**、`voiceWsUrl` / `webviewContentExternalBaseUrlTemplate` を削除 | Copilot への無確認の認証許可と、Microsoft のサービス・CDN への既定接続を持ち込まないため | 同上 |
| 4 | `product.json` | `builtInExtensions[].sha256` を Open VSX 版に | 同じバージョンでもビルド主体が違いハッシュが一致しない（実測で起動が失敗） | `nimbus/branding/sync-builtin-extension-hashes.mjs` |
| 5 | `resources/darwin/code.icns`, `resources/linux/code.png` | Nimbus のアイコンに差し替え | VS Code のアイコンは商標。独自意匠（雨雲＋光背）を生成して使う | `nimbus/branding/make-icon.mjs` |
| 6 | `src/.../welcomeGettingStarted/common/gettingStartedContent.ts` | ウォークスルーの "VS Code" を `product.nameLong` の差し込みに | 商標。かつ製品名を変数化しておけば追従で壊れにくい | `nimbus/branding/apply-core-changes.mjs` |
| 7 | `src/.../welcomeGettingStarted/browser/gettingStarted.ts` | 副題を "Editing evolved" → "A cockpit for your agents" | VS Code のキャッチコピーをそのまま使わない | 同上 |
| 8 | `src/.../chat/browser/chat.shared.contribution.ts` | `chat.disableAIFeatures` の既定値を `false` → `true` | 初回起動の「Sign in to use GitHub Copilot」モーダルを止める（下記の実測を参照） | 同上 |
| 9 | `src/.../extensions/browser/extensions.contribution.ts` | `extensions.verifySignature` の既定値を `true` → `false` | Open VSX の拡張は Microsoft 署名を持たず、OSS ビルドに検証機構も無いため、既定のままだと**拡張を 1 つもインストールできない**（実測） | 同上 |
| 10 | `build/gulpfile.vscode.ts` | macOS のターミナル用コマンドを `bin/code` 固定から `bin/${product.applicationName}` に | 本物の VS Code の `code` と衝突する。製品名から決めるのが素直（upstream にも通る一般化） | 同上 |
| 11 | `build/gulpfile.vscode.ts` | パッケージ出力先を `VSCode-<platform>-<arch>` から `${product.nameShort}-…` に | 利用者の作業ディレクトリの隣に "VSCode" という名前のフォルダが生えるのは紛らわしい | 同上 |
| 12 | `src/vs/workbench/services/themes/common/workbenchThemeService.ts` | 既定テーマを `Dark 2026` / `Light 2026` から `Nimbus Dark` / `Nimbus Light` に | 配色を Claude の意匠に寄せた自前テーマを既定にするため。テーマ自体は組み込み拡張が提供する | 同上 |
| 13 | `README.md` | Nimbus の README に差し替え | フォークの製品説明・出自・導入手順を載せるため（upstream の README は残さない） | 同上 |
| 14 | `.gitignore` | `nimbus/branding/out/` を追加 | 生成したブランディング素材の中間物をコミットしないため | 同上 |
| 15 | `build/gulpfile.extensions.ts` | `compilations` に `extensions/nimbus/tsconfig.json` を追加 | この一覧は手書きで、載せないと拡張がコンパイルされない（実測） | 同上 |
| 16 | `build/lib/extensions.ts` | `packagedDependenciesByExtension` に `nimbus: ['@anthropic-ai/claude-agent-sdk']` | SDK は自パッケージ内の実行ファイルを子プロセスで起動するため、バンドルせず node_modules ごと同梱する | 同上 |
| 17 | `src/vs/platform/extensionManagement/node/extensionManagementService.ts` | 署名検証のフォールバックを `true` → `false` | 設定の既定値だけでは CLI 経路で undefined になり true に戻る。Open VSX の拡張が入らない（実測） | 同上 |

## リポジトリ運用（push できない問題とその回避）

GitHub は「このプッシュが workflow ファイルを作成・更新するか」を判定する。トークンに `workflow`
スコープが無い場合、判定できないとプッシュを拒否する。**新規ブランチの作成**では upstream 全体との
差分計算になり、この規模のリポジトリでは判定がタイムアウトして必ず失敗する:

```
! [remote rejected] nimbus -> nimbus
  (Unable to determine if workflow can be created or updated due to timeout; `workflows` scope may be required.)
```

**回避策（実証済み）**: 既存ブランチへの**早送りプッシュ**なら差分が小さく、判定が通る。

1. 手元のコミットを、フォークに既にあるブランチ（例 `release/1.132`）の先端へ rebase する
2. そのブランチへ push する（早送りになる）
3. GitHub API でブランチ名を変える: `gh api -X POST repos/<owner>/<repo>/branches/<old>/rename -f new_name=nimbus`

以後は `nimbus` ブランチへの早送り push なので問題なく続けられる。
**そのため Nimbus のベースはタグ 1.132.0 ではなく `release/1.132`（1.132.0＋リリース後の修正）**になっている。

**タグとリリース**も同じ制約に当たるが、経路を選べば通る（実測）:

- `git push origin v0.6.0` / `gh release create` → 拒否される
- `gh api -X POST repos/<o>/<r>/git/refs -f ref=refs/tags/v0.6.0 -f sha=<commit>` → **通る**
- `gh api -X POST repos/<o>/<r>/releases -f tag_name=v0.6.0 …` → **通る**（タグが既にあれば）
- アセットは `uploads.github.com/.../releases/<id>/assets?name=…` へ curl で直接 POST する

つまり **REST API 経由なら作成できる**。`workflow` スコープを足せばどれも普通に通るので、
恒久的にはスコープを付けるのが本筋（`gh auth refresh -s workflow`）。

## 実測でわかったこと（重要）

- **`product.json` の `defaultChatAgent` は削除できない。** 消すとワークベンチが
  `Onboarding requires a default chat agent product configuration.` で例外になり、**画面が真っ白のまま起動しない**。
  Copilot の導線を切るのは設定 `chat.disableAIFeatures` の既定値で行う（`startupPage.tryShowOnboarding()` が
  `chatEntitlementService.sentiment.hidden` で早期 return する経路）
- **組み込み拡張の `configurationDefaults` では起動時のオンボーディング判定に間に合わない**（実測で抑止できず）。
  起動シーケンスより前に効かせたい既定値は、コアの既定値そのものを変える必要がある
- Copilot はビルド基盤にも配線されている（`build/lib/copilot.ts`・`gulpfile.vscode.ts` の ripgrep シム・
  `@github/copilot*` の依存）。**同梱物としての完全除去は別タスク**とし、まずは UI 露出を止めた
- **`builtInExtensionsEnabledWithAutoUpdates` はキーごと消してはいけない。** 消すと拡張管理が
  `productService.builtInExtensionsEnabledWithAutoUpdates is not iterable` で落ち、**拡張を一切インストールできなくなる**。
  空配列にすれば同じ効果で壊れない。「不要なキーは消す」ではなく「**空にする**」が正解の場合がある
- **署名検証を無効化するトレードオフ**: Open VSX を使う以上ここは避けられない（VSCodium など他のフォークも同様）。
  代わりに `extensionsGallery.controlUrl`（Eclipse が管理する悪意ある拡張の停止リスト）を有効にしてある。
  拡張を推奨・同梱する際は、Open VSX 上の名前squatting に注意し、実在と発行者を都度確認する
