# Step 2 確認チェックリスト — Claude Agent SDK 疎通＋イベント正規化＋最小チャット UI

- 実施日: 2026-08-11
- 方針: NIMBUS_SPEC.md §9「テスト方針」に従い、自動テスト＋細分化チェックリストの両方を消化する

## 1. 自動テスト

| #   | 項目                            | 結果       | 確認方法                                               |
| --- | ------------------------------- | ---------- | ------------------------------------------------------ |
| A-1 | vitest ユニット全件パス         | OK (16/16) | AsyncMessageQueue 5 件＋normalize 8 件＋security 3 件  |
| A-2 | typecheck (node / web)          | OK         | `npm run typecheck` エラー 0                           |
| A-3 | ESLint                          | OK         | `npm run lint` 警告・エラー 0（prettier 整形後）       |
| A-4 | Prettier                        | OK         | `npx prettier --check .`                               |
| A-5 | 実 SDK 統合テスト（オプトイン） | OK         | `RUN_SDK_SMOKE=1 npx vitest run` — 1 往復 10.3s で成功 |

## 2. SDK 型の裏取り（推測実装の排除）

| #   | 項目                                                                                                             | 結果 | 確認方法                     |
| --- | ---------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------- |
| B-1 | `SDKUserMessage` の実形 = `{ type:'user', message: MessageParam, parent_tool_use_id }`（ドキュメント例と異なる） | OK   | sdk.d.ts L4772 実測          |
| B-2 | `apiKeySource` enum = `'user'\|'project'\|'org'\|'temporary'\|'oauth'`（§10 の未確定項目を解消）                 | OK   | sdk.d.ts L124 実測           |
| B-3 | `total_cost_usd`/`modelUsage` は streaming input セッションでは累積値（合算せず最新値を読む）                    | OK   | sdk.d.ts の doc コメント実測 |
| B-4 | `Query.interrupt()` / `setPermissionMode()` の存在                                                               | OK   | sdk.d.ts 実測                |
| B-5 | Options キー（cwd / resume / forkSession / permissionMode / canUseTool / env / pathToClaudeCodeExecutable）      | OK   | sdk.d.ts 実測                |

## 3. 実装構造

| #   | 項目                                                                                             | 結果 | 確認方法                                    |
| --- | ------------------------------------------------------------------------------------------------ | ---- | ------------------------------------------- |
| C-1 | 正規化イベント型が shared/events.ts に zod スキーマとして定義され、全イベントが sessionId を持つ | OK   | events.ts＋normalize テスト                 |
| C-2 | SDK 型への依存が normalize.ts / SessionManager.ts に閉じている（§3 原則 3）                      | OK   | renderer/shared に SDK import なし（grep）  |
| C-3 | SessionManager は `Map<sessionId, ManagedSession>`（§3 原則 5。シングルトン API なし）           | OK   | SessionManager.ts 目視                      |
| C-4 | IPC 入出力が zod で検証される（main 側 parse＋renderer 側 safeParse の二重）                     | OK   | sessionHandlers.ts / ChatView.tsx           |
| C-5 | preload は依存ゼロの ipc-channels のみ import（sandbox 制約対応）し、raw ipcRenderer を非公開    | OK   | preload/index.ts 目視                       |
| C-6 | イベントは全ウィンドウへブロードキャスト（多重ウィンドウ前提）                                   | OK   | sessionHandlers.ts                          |
| C-7 | 中断 API（interrupt）が UI から呼べる                                                            | OK   | ChatView「中断」ボタン＋E2E では未実施（※） |

## 4. 動作確認（実 SDK 1 往復）

| #   | 項目                                                                        | 結果 | 確認方法                                       |
| --- | --------------------------------------------------------------------------- | ---- | ---------------------------------------------- |
| D-1 | Node 単体で SDK 1 往復（NIMBUS_OK 応答・init/user/assistant/result 正規化） | OK   | A-5 の統合テスト                               |
| D-2 | E2E: アプリ起動＋自動セッションで main がイベントを受信                     | OK   | NIMBUS_SMOKE=1 起動ログ `[nimbus:main] event`  |
| D-3 | E2E: renderer が IPC 経由で同じイベント列を受信（全経路疎通）               | OK   | 起動ログ `[nimbus:renderer] event`             |
| D-4 | E2E: sandbox/contextIsolation フラグが Step 2 変更後も維持                  | OK   | 起動ログ `sandboxed=true contextIsolated=true` |
| D-5 | 全イベントの sessionId 一致（§3 原則 5）                                    | OK   | 統合テストの assertion                         |

## 5. 多重セッション（§3 原則 5 の初回検証）

| #   | 項目                                                          | 結果 | 確認方法                                  |
| --- | ------------------------------------------------------------- | ---- | ----------------------------------------- |
| E-1 | ストアが sessionId キーの辞書（単一セッション前提の状態なし） | OK   | sessionStore.ts 目視                      |
| E-2 | 同時 2 セッションの実走テスト                                 | 保留 | Step 3（一覧 UI・永続化）到達時に必ず実施 |

## NG 記録と再実施

- なし（初回で全項目 OK。※C-7 の interrupt 実走は running 状態のセッションが必要なため、Step 3 の多重セッション実走テストと合わせて実施する）

## 備考

- 実 SDK テストはユーザーのサブスク利用枠を微量消費する（短い 1 往復のみ）。CI では実行しない設計（RUN_SDK_SMOKE ゲート）
- SDK ドキュメントの簡略例（`{role, content}` を yield）と実型定義の差異を検出。実装は index.d.ts（実測）に従った
