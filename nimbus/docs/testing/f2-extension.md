# F2 確認チェックリスト — Nimbus コア機能を組み込み拡張として移植

- 実施日: 2026-08-12
- 完了条件: **フォーク内で実 Claude セッションが動く**
- 方針: GUI を人手で操作できない前提でも経路全体を通せるよう、拡張ログで各段を確認したうえで、
  最後にスクリーンショットで目視検品する

## 1. 移植

| #   | 項目                                                    | 結果 | 確認方法                        |
| --- | ------------------------------------------------------- | ---- | ------------------------------- |
| A-1 | SessionManager / normalize / AsyncMessageQueue を移植    | OK   | `extensions/nimbus/src/session/` |
| A-2 | sanitizer を移植（ログに鍵・ホームパスを残さない）        | OK   | `sanitizeString` をログ経路に適用 |
| A-3 | IPC 用 zod スキーマを素の型に置換（プロセス境界が無い）   | OK   | `src/events.ts`                  |
| A-4 | TypeScript のコンパイルが通る                            | OK   | `compile-extension:nimbus` 0 errors |

## 2. 実セッション（SDK 疎通）

| #   | 項目                                                     | 結果 | 確認方法                          |
| --- | -------------------------------------------------------- | ---- | --------------------------------- |
| B-1 | 拡張ホストを介さずに 1 往復できる（エンジン単体）        | OK   | ヘッドレス実行で `NIMBUS_OK` を受信 |
| B-2 | イベントが正規化される（init/user/assistant/turn-result） | OK   | 種別カウントで確認                 |
| B-3 | コストが積算される                                       | OK   | `totalCostUsd` が返る              |
| B-4 | 状態遷移 starting → running → awaiting-input             | OK   | status イベント                    |

## 3. IDE 内での動作

| #   | 項目                                                        | 結果 | 確認方法                     |
| --- | ------------------------------------------------------------ | ---- | ---------------------------- |
| C-1 | 拡張が有効化される                                          | OK   | exthost ログに `_doActivateExtension idris.nimbus` |
| C-2 | コックピット（Webview）が生成される                          | OK   | 拡張ログ                     |
| C-3 | **Webview から `ready` が返る**（HTML・CSP・スクリプトが正常） | OK   | 拡張ログ                     |
| C-4 | ワークスペースの cwd で実セッションが動く                    | OK   | 拡張ログにターン終了とコスト |
| C-5 | ステータスバーに状態と累計コストが出る                       | OK   | スクリーンショット           |
| C-6 | ユーザー発言・セッション開始・Claude の応答が並ぶ            | OK   | スクリーンショット           |
| C-7 | 未信頼フォルダでは拡張ごと無効（Claude を走らせない）        | OK   | 未信頼だと有効化されないことを確認 |

## 4. パッケージ版

| #   | 項目                                            | 結果 | 確認方法                       |
| --- | ------------------------------------------------- | ---- | ------------------------------ |
| D-1 | `extensions/nimbus` が同梱される                 | OK   | app 内を確認                   |
| D-2 | Agent SDK が node_modules として同梱される       | 記録参照 | `packagedDependenciesByExtension` |
| D-3 | パッケージ版で実セッションが動く                  | 記録参照 | `nimbus/branding/smoke-packaged.sh` |

## NG 記録と対処

| 事象 | 原因 | 対処 |
| --- | --- | --- |
| **最初のユーザー発言がコックピットに出ない** | `createSession` の await 中に発火する `user-text` を、アクティブなセッション ID が未確定のため購読側が捨てていた | セッション ID を先に決めて active にしてから `reuseSessionId` で作る |
| 拡張が有効化されない | ワークスペースが未信頼（Restricted Mode）。Nimbus は `untrustedWorkspaces.supported: false` | 仕様として正しい。確認時は `--disable-workspace-trust` を使う |
| 拡張がコンパイルされない | `build/gulpfile.extensions.ts` の `compilations` は**手書きの一覧** | 一覧に `extensions/nimbus/tsconfig.json` を追加 |
| `sanitize` が存在しないと型エラー | 移植元の API 名は `sanitizeString` | 呼び出し側を修正 |

## 未了（F3 以降）

- [ ] 永続化（イベント・コスト・セッション再開）。旧版の SQLite をそのまま持ち込むか、
      VS Code の storage API に寄せるかは F3 で判断する
- [ ] 承認の一覧化（現在は都度モーダル。横断キューは F3）
- [ ] Claude の編集を標準 diff で見せる（F3）
- [ ] 複数セッションの並列運用（F4）
