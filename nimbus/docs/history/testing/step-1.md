# Step 1 確認チェックリスト — プロジェクト初期化

- 実施日: 2026-08-11
- 対象コミット: Step 1 完了コミット（このファイルを含むコミット）
- 方針: NIMBUS_SPEC.md §9「テスト方針」に従い、自動テスト＋細分化チェックリストの両方を消化する

## 1. 自動テスト

| #   | 項目             | 結果     | 確認方法                                          |
| --- | ---------------- | -------- | ------------------------------------------------- |
| A-1 | vitest 全件パス  | OK (3/3) | `npm test` — security.test.ts（§6-5 フラグ 3 件） |
| A-2 | typecheck (node) | OK       | `npm run typecheck:node` エラー 0                 |
| A-3 | typecheck (web)  | OK       | `npm run typecheck:web` エラー 0                  |
| A-4 | ESLint           | OK       | `npm run lint` 警告・エラー 0                     |
| A-5 | Prettier         | OK       | `npx prettier --check .` 全ファイル準拠           |

## 2. 構成

| #    | 項目                                                                                                                    | 結果 | 確認方法                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------- |
| B-1  | electron-vite 5.0.0（§10 検証の推奨 scaffold）で構築                                                                    | OK   | package.json / インストール実測                         |
| B-2  | Vite が ^7 のまま（8 に上げていない。electron-vite 5 の peer 制約）                                                     | OK   | vite 7.3.6 を実測                                       |
| B-3  | Electron 43.3.0（safeStorage 非同期 API 要件 42+ を満たす現行 stable）                                                  | OK   | node_modules/electron/package.json                      |
| B-4  | React 19 / TypeScript 5.9 / vitest 4                                                                                    | OK   | 実測（19.2.8 / 5.9.3 / 4.1.10）                         |
| B-5  | §3 ディレクトリ構成（main/services・ipc・db、preload、renderer/features×6・components・theme・stores、shared、themes/） | OK   | `find src themes -type d`                               |
| B-6  | TypeScript strict モード（tsconfig.node / tsconfig.web 両方に明示）                                                     | OK   | tsconfig 2 ファイル＋typecheck パス                     |
| B-7  | ESLint flat config ＋ Prettier 設定                                                                                     | OK   | eslint.config.mjs / .prettierrc.yaml                    |
| B-8  | package.json: name=nimbus-code（§7 名前衝突対策）/ engines node>=22 / MIT                                               | OK   | package.json                                            |
| B-9  | electron-builder.yml: appId=dev.idris.nimbus / productName=Nimbus / 不要な publish・カメラ等の entitlement 削除         | OK   | electron-builder.yml                                    |
| B-10 | `@shared` エイリアスが main / preload / renderer / vitest の 4 箇所で一致                                               | OK   | electron.vite.config.ts / tsconfig×2 / vitest.config.ts |

## 3. セキュリティ（§6-5）

| #   | 項目                                                                                        | 結果 | 確認方法                                           |
| --- | ------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------- |
| C-1 | sandbox: true が実効                                                                        | OK   | dev 起動ログ実測 `[nimbus:preload] sandboxed=true` |
| C-2 | contextIsolation: true が実効                                                               | OK   | 同上 `contextIsolated=true`                        |
| C-3 | nodeIntegration: false                                                                      | OK   | SECURITY_WEB_PREFERENCES＋unit test（A-1）         |
| C-4 | セキュリティフラグが単一定数（src/main/security.ts）に集約され、テストで回帰を防止          | OK   | コード＋security.test.ts                           |
| C-5 | preload が raw な ipcRenderer / Node API を renderer に公開していない（window.nimbus のみ） | OK   | src/preload/index.ts 目視                          |
| C-6 | contextIsolation が無効なら preload が例外を投げて起動失敗する                              | OK   | src/preload/index.ts のガード                      |
| C-7 | CSP メタタグ（default-src 'self'）が index.html に存在                                      | OK   | src/renderer/index.html                            |
| C-8 | 外部送信の経路なし（テレメトリなし・electron-builder の publish 設定削除）                  | OK   | electron-builder.yml / 依存一覧                    |

## 4. 起動確認

| #   | 項目                                                           | 結果 | 確認方法                                                               |
| --- | -------------------------------------------------------------- | ---- | ---------------------------------------------------------------------- |
| D-1 | `npm run dev` で main / preload / renderer がビルドされる      | OK   | dev ログ「built successfully」×2＋dev server 起動                      |
| D-2 | ウィンドウが表示され preload が実行される                      | OK   | preload ログが renderer コンソール経由で出力された                     |
| D-3 | sandbox 化された preload で外部モジュール require が発生しない | OK   | 初回 NG→修正→再実施 OK（下記記録）                                     |
| D-4 | dev 起動ログにアプリ由来のエラーなし                           | OK   | grep（終了時の GPU/network ノイズのみ＝kill による正常シャットダウン） |

## NG 記録と再実施

- **D-3 初回 NG**: `sandbox: true` の preload では外部モジュールを require できず、テンプレート由来の `@electron-toolkit/preload` が `module not found` になった（§10 検証の build-stack 項 5 で予見されていた制約）。
- **対処**: `@electron-toolkit/preload` を依存から削除し、raw ipcRenderer を公開しない自前の `window.nimbus` API に置換（§3 設計原則 1 にも適合）。
- **再実施**: 修正後、チェックリスト全体（自動テスト A-1〜A-5・起動確認 D-1〜D-4）を再実施し全項目 OK。

## 未消化・次 Step 送り

- 多重セッション検証（§3 原則 5）: セッション機構自体が Step 2 で入るため、Step 2 のチェックリストから開始する
