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
| 18 | `src/vs/sessions/sessions.common.main.ts` | スクラッチファイルの contribution を 1 行 import | 機能自体は `src/vs/sessions/contrib/scratchFiles/`（新規追加）にあり、登録だけがここに要る（T-033） | 手作業（追従時は import 行の位置だけ確認する） |
| 19 | `src/vs/nls.ts` | `_format()` の末尾で、文言中の "Visual Studio Code" / "VS Code" を製品名に置き換える | upstream の文言には製品名が直書きされている（`localize()` 内だけで 152 箇所・約 90 ファイル）。ファイルごとに直すと差分が広がって追従できない。`localize` / `localize2` が必ず通る集約点で 1 回だけ行えば、新しい文言にも自動で効く | `nimbus/branding/apply-core-changes.mjs` |
| 20 | `extensions/copilot/`（削除）・`package.json`・`build/npm/dirs.ts`・`build/gulpfile.vscode.ts` | Copilot 拡張をソースごと削除し、ビルド・npm の対象からも外す | Nimbus は Claude の操縦席で Copilot を同梱しない。パッケージからの除去だけでは 1.8GB・4193 ファイルがソースに残り続ける（T-005） | 削除は手作業。ビルド側は `apply-core-changes.mjs` |
| 21 | `src/.../chat/test/browser/sessionBrowsersControl.test.ts` | テストの題名データ `'Visual Studio Code'` を `'Docs'` に変える | #19 が `localize()` を通る文言だけ製品名に差し替えるため、aria-label だけ 'Open Nimbus' になり、`localize()` を通らない表示文字列とずれてテストが落ちていた。確かめたいのは「題名があればそれを出す」ことなので、製品名でない題名にする。**一般形: `'Visual Studio Code'` / `'VS Code'` を「値」として持つテストは #19 の影響を受ける。とくに `localize()` を通る文字列（aria-label など）と通らない文字列（テンプレートリテラルなど）が同じ値を期待している箇所は、追従のたびに非対称にずれる** | 手当て（追従時は衝突しうる） |
| 22 | `src/main.ts` | `getUserDefinedLocale()` が、指定が無いとき返す値を `undefined` → `'ja'` に | 日本語で使う道具なのに画面が英語で立ち上がっていた。upstream は `undefined` を返し、そうすると NLS の解決自体が行われないので、OS が日本語でも英語のまま。`--locale` と `argv.json` の `locale` は今までどおり優先されるので、変えたい人は変えられる（T-245） | `nimbus/branding/apply-core-changes.mjs` |
| 23 | `product.json` | `builtInExtensions` に `MS-CEINTL.vscode-language-pack-ja` を追加 | #22 だけでは訳文の実体が無く英語に落ちる。日本語の文言は言語パックが持つ。**Open VSX から取得し、VSIX の中身で publisher / name / version を確かめてからハッシュを固定する**（T-245） | `nimbus/branding/sync-builtin-extension-hashes.mjs`（ハッシュ） |
| 24 | `src/vs/workbench/browser/parts/paneCompositeBar.ts` | `getViewContainer()` / `getViewContainers()` で `NIMBUS_HIDDEN_VIEW_CONTAINERS`（いまは `workbench.view.debug` のみ）を除く | 標準のデバッグは、Claude 用のものを用意するまでアイコンを出さない。**登録は消さない** — 消すとビューの登録先が無くなり、F5・ブレークポイント・`openPaneComposite` まで巻き添えになる。バーがコンテナを引く口はこの 2 つだけなので、「このバーの担当ではない」を表す既存の道すじにそのまま乗せる（T-246） | `nimbus/branding/apply-core-changes.mjs` |
| 25 | `src/vs/workbench/browser/parts/editor/editorGroupWatermark.ts` | 空のエディタの案内から `workbench.action.debug.start`（Start Debugging）を外す | #24 でアイコンを消しても、**一番よく見る画面**に 「Start Debugging F5」が出ていては隠したことにならない。F5 自体は今までどおり効く（T-246） | `nimbus/branding/apply-core-changes.mjs` |
| 26 | `src/vs/workbench/browser/parts/paneCompositeBar.ts` | #24 の除外集合に `workbench.panel.chat` を追加 | VS Code 内蔵のチャットを出さない。Nimbus のチャットはコックピットなので、**似て非なるものが右に常駐していると、どちらに書けばよいのか分からない**。`chat.disableAIFeatures` はエージェントホストの有効・無効を決めるだけで、この UI は別に登録されている（T-238） | `nimbus/branding/apply-core-changes.mjs` |
| 27 | `src/vs/workbench/browser/workbench.contribution.ts` | `workbench.secondarySideBar.defaultVisibility` の既定を `visibleInWorkspace` → `hidden` | upstream の既定は右の補助バーに内蔵チャットを置く前提。#26 でチャットを外すと、**中身が無いまま帯だけ残る**（実測）。開きたい人は ⌥⌘B で開ける（T-238） | 同上 |
| 28 | `src/vs/workbench/browser/layout.ts` | サイドバーの既定幅を `300` → `560`、画面幅からの上限を `width/4` → `width*0.4` に。**3 か所**（静的な既定値・画面幅から決める既定値・「小さい窓では詰める」道） | Nimbus の主面はコックピットで、**セッションの一覧（縦・200px 以上）と会話が同じ面を分け合う**（T-341）。300px では会話に 100px しか残らない。上限も上げないと効かない — 1440px 幅の画面で `width/4` は 360px にしかならない。とくに 3 つ目（`width <= 1440` で詰める道）は**ノート PC のほとんどが通る**ので、ここを直さないと上の 2 つは一度も効かない（実測で 300px のままだった）。**既に幅を覚えている環境には効かない**（`StorageScope.PROFILE` に保存済み）— 新しいプロファイルと「ビューの位置をリセット」で効く | `nimbus/branding/apply-core-changes.mjs` |
| 29 | `src/vs/workbench/browser/layout.ts` | 面（ビューコンテナ）ごとのサイドバー幅 `sideBar.sizeByView`（`{ id: 幅 }`）を `LayoutStateKeys` に足し、Sidebar の `onDidPaneCompositeClose`（＋ upstream の `onWillSaveState` の中）で幅を控え、`onDidPaneCompositeOpen` で戻す。既定は Nimbus の面（`workbench.view.extension.nimbus*`）= 560px、それ以外 = upstream の 300px。**挿入 5 か所**（定数と既定幅の関数 / 状態キー / `onWillSaveState` の中 / 開閉のリスナ / private メンバ 2 本＋メソッド 3 本）。`sideBar.size` と #28 は無改変 | upstream のサイドバー幅は**全ビュー共有の 1 値**なので、#28 でコックピットのために 560px にしたぶん、エクスプローラーや検索まで 560px になりエディタが潰れる（利用者報告 2026-08-31・T-361 —「コックピットを開いている時は今ぐらいのサイズで良いんだけど、ファイルとかのアクティビティバーをクリックしたときも同じサイズだとちょっと使いづらい」）。**閉じる側で幅を読めるのは、`compositePart.ts` の `doOpenComposite` が close → open の順に同期で走り、間にグリッドのリサイズが挟まらないから — ここが将来 async 化されたら、記録される幅が入れ替わる。**終了時の記録を upstream の `onWillSaveState` ハンドラの**中**に挿しているのも同じ理由で、`setInitializationValue` はキャッシュに置くだけ・書き出すのは同ハンドラ末尾の `save(true, true)` なので、別のリスナに分けると登録順で間に合わない。`ViewContainerLocation.Sidebar` で絞るのでパネル・補助バーには効かない。`resizeView` が切り詰めた幅を「利用者が引いた幅」として焼き付けないよう、当てた幅を読み戻して照合する。**移行時、非 Nimbus の面は初めて開いたときに一度だけ 300px へ縮む**（意図して広げていた人はその 1 回ぶん失う）。起動直後に復元される面が **Nimbus の面のときだけ**、`sideBar.size` の復元値をその面の幅として表に取り込む（コックピットで引いた幅を移行で失わないため。取り込みは**起動後 1 回きり** — 2 回目以降にやると「知らない面が出ていった面の幅を名乗る」ことになり、直したい症状そのものになる）。**面を選ばずに取り込んではいけない** — パッケージ版（`isBuilt`）の冷起動は upstream の `initLayoutState` が「既定のビューコンテナへ戻す」道を通り、拡張のビューは既定になれないので**復元される面はほぼ必ずエクスプローラー**。取り込むとそこへ 560px が焼き付いて症状がそのまま残る。裏返しに、コックピットを開いたまま終了した次の冷起動では、エクスプローラーが 560px → 300px へ一度縮むのが見える（`sideBar.size` は最後に開いていた面の幅なので避けられない）。**未検証: 複数ウィンドウ** — 表は `StorageScope.PROFILE` にオブジェクトまるごとで書くので、後に flush した窓が表全体を上書きする（`sideBar.size` と同じ粒度の問題だが、表だと巻き添えが広い） | `nimbus/branding/apply-core-changes.mjs` |

> **依存 `@github/copilot-sdk` と `@vscode/copilot-api` は消せない。** コアの agent host
> （`src/vs/platform/agentHost/`）が import している（それぞれ 35 箇所・14 箇所）。
> 消すには agent host ごと外す必要があり、影響が桁違いに大きいので別の判断とする。

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
