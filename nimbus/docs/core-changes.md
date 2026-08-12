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
| 3 | `product.json` | `trustedExtensionAuthAccess` / `builtInExtensionsEnabledWithAutoUpdates` を**空にする**、`voiceWsUrl` / `webviewContentExternalBaseUrlTemplate` を削除 | Copilot への無確認の認証許可と、Microsoft のサービス・CDN への既定接続を持ち込まないため | 同上 |
| 4 | `product.json` | `builtInExtensions[].sha256` を Open VSX 版に | 同じバージョンでもビルド主体が違いハッシュが一致しない（実測で起動が失敗） | `nimbus/branding/sync-builtin-extension-hashes.mjs` |
| 5 | `resources/darwin/code.icns`, `resources/linux/code.png` | Nimbus のアイコンに差し替え | VS Code のアイコンは商標。独自意匠（雨雲＋光背）を生成して使う | `nimbus/branding/make-icon.mjs` |
| 6 | `src/.../welcomeGettingStarted/common/gettingStartedContent.ts` | ウォークスルーの "VS Code" を `product.nameLong` の差し込みに | 商標。かつ製品名を変数化しておけば追従で壊れにくい | `nimbus/branding/apply-core-changes.mjs` |
| 7 | `src/.../welcomeGettingStarted/browser/gettingStarted.ts` | 副題を "Editing evolved" → "A cockpit for your agents" | VS Code のキャッチコピーをそのまま使わない | 同上 |
| 8 | `src/.../chat/browser/chat.shared.contribution.ts` | `chat.disableAIFeatures` の既定値を `false` → `true` | 初回起動の「Sign in to use GitHub Copilot」モーダルを止める（下記の実測を参照） | 同上 |
| 9 | `src/.../extensions/browser/extensions.contribution.ts` | `extensions.verifySignature` の既定値を `true` → `false` | Open VSX の拡張は Microsoft 署名を持たず、OSS ビルドに検証機構も無いため、既定のままだと**拡張を 1 つもインストールできない**（実測） | 同上 |
| 10 | `build/gulpfile.vscode.ts` | macOS のターミナル用コマンドを `bin/code` 固定から `bin/${product.applicationName}` に | 本物の VS Code の `code` と衝突する。製品名から決めるのが素直（upstream にも通る一般化） | 同上 |

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
