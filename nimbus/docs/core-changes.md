# コア変更の台帳

upstream（`microsoft/vscode`）のファイルに入れた変更を**すべて**ここに記録する。
追従マージのたびにこの一覧を読み返し、まだ必要か・当て方が変わっていないかを確認する。

原則:

1. コア変更は最小限。機能は `extensions/nimbus/` に置く
2. コアに入れる変更は `// --- Start Nimbus ---` / `// --- End Nimbus ---` で囲む
3. 機械的に再適用できるものは `nimbus/branding/*.mjs` のスクリプトにして、手編集を残さない

## 一覧（ベース: 1.132.0）

| # | ファイル | 変更 | 理由 | 再適用 |
| --- | --- | --- | --- | --- |
| 1 | `product.json` | 身元（名称・データフォルダ・バンドル ID・URL スキーム・Windows ID）を Nimbus に | 商標を使わず、VS Code と設定・インストールが衝突しないようにするため | `nimbus/branding/apply-product-json.mjs` |
| 2 | `product.json` | `extensionsGallery` を Open VSX に追加、`linkProtectionTrustedDomains` に open-vsx.org | Microsoft Marketplace は利用規約でフォークに開放されていない | 同上 |
| 3 | `product.json` | `trustedExtensionAuthAccess` / `builtInExtensionsEnabledWithAutoUpdates` / `voiceWsUrl` / `webviewContentExternalBaseUrlTemplate` を削除 | Copilot への無確認の認証許可と、Microsoft のサービス・CDN への既定接続を持ち込まないため | 同上 |
| 4 | `product.json` | `builtInExtensions[].sha256` を Open VSX 版に | 同じバージョンでもビルド主体が違いハッシュが一致しない（実測で起動が失敗） | `nimbus/branding/sync-builtin-extension-hashes.mjs` |
| 5 | `resources/darwin/code.icns`, `resources/linux/code.png` | Nimbus のアイコンに差し替え | VS Code のアイコンは商標。独自意匠（雨雲＋光背）を生成して使う | `nimbus/branding/make-icon.mjs` |
| 6 | `src/.../welcomeGettingStarted/common/gettingStartedContent.ts` | ウォークスルーの "VS Code" を `product.nameLong` の差し込みに | 商標。かつ製品名を変数化しておけば追従で壊れにくい | `nimbus/branding/apply-product-strings.mjs` |
| 7 | `src/.../welcomeGettingStarted/browser/gettingStarted.ts` | 副題を "Editing evolved" → "A cockpit for your agents" | VS Code のキャッチコピーをそのまま使わない | 同上 |
| 8 | `src/.../chat/browser/chat.shared.contribution.ts` | `chat.disableAIFeatures` の既定値を `false` → `true` | 初回起動の「Sign in to use GitHub Copilot」モーダルを止める（下記の実測を参照） | 同上 |

## 実測でわかったこと（重要）

- **`product.json` の `defaultChatAgent` は削除できない。** 消すとワークベンチが
  `Onboarding requires a default chat agent product configuration.` で例外になり、**画面が真っ白のまま起動しない**。
  Copilot の導線を切るのは設定 `chat.disableAIFeatures` の既定値で行う（`startupPage.tryShowOnboarding()` が
  `chatEntitlementService.sentiment.hidden` で早期 return する経路）
- **組み込み拡張の `configurationDefaults` では起動時のオンボーディング判定に間に合わない**（実測で抑止できず）。
  起動シーケンスより前に効かせたい既定値は、コアの既定値そのものを変える必要がある
- Copilot はビルド基盤にも配線されている（`build/lib/copilot.ts`・`gulpfile.vscode.ts` の ripgrep シム・
  `@github/copilot*` の依存）。**同梱物としての完全除去は別タスク**とし、まずは UI 露出を止めた
