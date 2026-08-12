# Step 5 確認チェックリスト — テーマ基盤（F-8）

- 実施日: 2026-08-11
- 方針: NIMBUS_SPEC.md §9「テスト方針」に従い、自動テスト＋細分化チェックリストの両方を消化する

## 1. 自動テスト

| #   | 項目                          | 結果       | 確認方法                                                       |
| --- | ----------------------------- | ---------- | -------------------------------------------------------------- |
| A-1 | vitest ユニット全件パス       | OK (80/80) | theme（schema/写像）7 件＋ThemeService 5 件＋settings 1 件追加 |
| A-2 | typecheck / ESLint / Prettier | OK         | エラー・警告 0                                                 |

## 2. CSS 変数化（F-8 の土台）

| #   | 項目                                                               | 結果 | 確認方法                          |
| --- | ------------------------------------------------------------------ | ---- | --------------------------------- |
| B-1 | UI の全色が --nimbus-* CSS 変数経由（ハードコード色なし）          | OK   | grep（#hex は :root 定義のみ）    |
| B-2 | テーマ切替は :root の変数差し替えのみ（再起動不要）                | OK   | useThemeSync 実装＋E2E            |
| B-3 | 切替時に前テーマの変数をクリアしてから適用（残留防止）             | OK   | ALL_NIMBUS_CSS_VARS＋useThemeSync |
| B-4 | フォントファミリ/サイズ/行間も変数経由（既定値フォールバック付き） | OK   | buildCssVars テスト＋main.css     |

## 3. テーマ定義・ローダ

| #   | 項目                                                                       | 結果 | 確認方法            |
| --- | -------------------------------------------------------------------------- | ---- | ------------------- |
| C-1 | テーマ JSON スキーマ（VS Code workbench color key 準拠の命名）             | OK   | theme.test.ts       |
| C-2 | 内蔵 3 テーマ（Nimbus Dark / Nimbus Light / Cumulonimbus）が命名由来と整合 | OK   | themes/*.json 目視  |
| C-3 | 未知の色キーは無視（部分互換。「そのまま読める」とは謳わない §4 F-8 制約） | OK   | buildCssVars テスト |
| C-4 | ~/.nimbus/themes/*.json の自動認識・不正テーマのスキップ・.json 以外の無視 | OK   | ThemeService テスト |
| C-5 | 未知テーマ id 選択時は警告してフォールバック（§5 方針）                    | OK   | ThemeService テスト |

## 4. 切替・追従・設定

| #   | 項目                                                                     | 結果 | 確認方法                 |
| --- | ------------------------------------------------------------------------ | ---- | ------------------------ |
| D-1 | 'system' 選択で OS ダークモードに追従（nativeTheme.shouldUseDarkColors） | OK   | resolve テスト＋handlers |
| D-2 | OS ダークモード変更（nativeTheme 'updated'）で即時 push                  | OK   | themeHandlers 実装       |
| D-3 | settings.json の直接編集も反映（GUI と JSON の双方向 §5）                | OK   | settings.json watch 実装 |
| D-4 | settings.json 不在・破損時は既定値フォールバック                         | OK   | ConfigService テスト     |
| D-5 | フォント設定 GUI（ファミリ/サイズ/行間）→ 保存で即時反映                 | OK   | SettingsView＋saveFont   |

## 5. E2E（起動確認）

| #   | 項目                                                                    | 結果 | 確認方法                                 |
| --- | ----------------------------------------------------------------------- | ---- | ---------------------------------------- |
| E-1 | 起動時にテーマが適用される（theme applied ログ）                        | OK   | E2E ログ（nimbus-dark）                  |
| E-2 | **ホットリロード実発火**: 起動中に ~/.nimbus/themes へ JSON 追加 → push | OK   | E2E 2 回目（watcher 武装後）で発火を確認 |
| E-3 | テーマ関連エラー 0                                                      | OK   | E2E ログ grep                            |

## NG 記録と再実施

- **E-2 初回 NG**: 起動時に ~/.nimbus/themes が存在しないと fs.watch が武装されず、初回ユーザーはホットリロード不発だった。→ テーマ状態を組むたびに `rescan()`＋`startWatching()`（冪等）を再試行する修正を実装し、E2E を再実施して発火を確認
