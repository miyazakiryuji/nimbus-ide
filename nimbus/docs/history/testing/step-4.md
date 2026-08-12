# Step 4 確認チェックリスト — 接続設定（F-7: BYO Claude Code）

- 実施日: 2026-08-11
- 方針: NIMBUS_SPEC.md §9「テスト方針」に従い、自動テスト＋細分化チェックリストの両方を消化する

## 1. 自動テスト

| #   | 項目                    | 結果       | 確認方法                                                               |
| --- | ----------------------- | ---------- | ---------------------------------------------------------------------- |
| A-1 | vitest ユニット全件パス | OK (68/68) | ConfigService 7 件＋CredentialVault 6 件＋ConnectionService 8 件を追加 |
| A-2 | typecheck (node / web)  | OK         | `npm run typecheck` エラー 0                                           |
| A-3 | ESLint / Prettier       | OK         | エラー・警告 0                                                         |

## 2. 大原則（認証を代行しない・預からない）

| #   | 項目                                                                      | 結果 | 確認方法                 |
| --- | ------------------------------------------------------------------------- | ---- | ------------------------ |
| B-1 | ログインフォームを実装していない（CLI でのログイン方法を案内するのみ）    | OK   | SettingsView 目視        |
| B-2 | claude-cli 方式では資格情報に一切触れない（env を渡さない）               | OK   | ConnectionService テスト |
| B-3 | 機密の取得 API が存在しない（renderer へは hasStoredSecret の真偽値のみ） | OK   | connectionHandlers 目視  |

## 3. 資格情報の保存（§6-1）

| #   | 項目                                                                  | 結果 | 確認方法                 |
| --- | --------------------------------------------------------------------- | ---- | ------------------------ |
| C-1 | API キーは safeStorage（非同期 API・Electron 42+ 推奨形）で暗号化保存 | OK   | CredentialVault＋テスト  |
| C-2 | 平文がファイルに書かれない（ファイル内容の直接検証）                  | OK   | vault テスト（raw read） |
| C-3 | 暗号化不可の環境では保存を拒否（平文フォールバック禁止）              | OK   | vault テスト             |
| C-4 | Linux basic_text（実質平文）は「保存不可」扱い（§10 検証の罠対応）    | OK   | vault テスト             |
| C-5 | キーローテーション（shouldReEncrypt）で再暗号化・再保存               | OK   | vault テスト             |
| C-6 | profiles.json に機密を書けない（機密らしい env 名を保存時拒否）       | OK   | ConfigService テスト     |

## 4. プロファイルと環境変数合成

| #   | 項目                                                                                                                                                        | 結果 | 確認方法                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------ |
| D-1 | 複数プロファイル登録・切替・削除（削除時はアクティブが次へ移動）                                                                                            | OK   | ConfigService テスト     |
| D-2 | api-key → ANTHROPIC_API_KEY / bedrock → CLAUDE_CODE_USE_BEDROCK=1 / vertex → VERTEX=1 / foundry → FOUNDRY=1＋ANTHROPIC_FOUNDRY_API_KEY（§10 検証 8 の実名） | OK   | ConnectionService テスト |
| D-3 | env は「置換」仕様のため必ず process.env をスプレッド（§10 検証 7）                                                                                         | OK   | テストで PATH 継承を確認 |
| D-4 | 壊れた profiles.json は警告して既定値へフォールバック（§5）                                                                                                 | OK   | ConfigService テスト     |
| D-5 | 共有既定オブジェクトの汚染バグ（テストが検出）→ deep copy 修正                                                                                              | OK   | NG 記録参照              |

## 5. バイナリ選択・接続テスト・課金表示

| #   | 項目                                                                                                                | 結果 | 確認方法                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| E-1 | システム claude の自動検出（which）＋バージョン表示（claude --version）                                             | OK   | ConnectionService＋設定画面                                                                                                              |
| E-2 | binary=system＋customBinaryPath → pathToClaudeCodeExecutable（§10 検証 7 の実名）                                   | OK   | ConnectionService テスト                                                                                                                 |
| E-3 | 接続テスト: 軽量 1 クエリ→init からモデル/バージョン/認証/MCP/プラグイン表示。persistSession:false で履歴を汚さない | OK   | ConnectionService 実装                                                                                                                   |
| E-4 | ステータスバーに課金モード常時表示（apiKeySource=oauth → サブスク / その他 → API キー従量課金＋累計 $）             | OK   | StatusBar 実装＋renderer が session-init(apiKeySource) を受信することを E2E で確認。表示文字列の目視は Step 8 スクリーンショット時に実施 |
| E-5 | 課金モード判定は §10 検証で確定した enum（'user'\|'project'\|'org'\|'temporary'\|'oauth'）に基づく                  | OK   | shared/profiles.ts billingModeLabel                                                                                                      |

## 6. E2E（起動確認）

| #   | 項目                                                          | 結果 | 確認方法     |
| --- | ------------------------------------------------------------- | ---- | ------------ |
| F-1 | Step 4 変更後も全イベント配信・sandbox フラグ維持・エラー 0   | OK   | 起動ログ     |
| F-2 | プロファイル未作成時は ~/.nimbus を作らない（設定を汚さない） | OK   | ls ~/.nimbus |

## NG 記録と再実施

- **D-5**: ConfigService が `DEFAULT_PROFILES_FILE` を参照返ししており、upsert が共有既定オブジェクトを汚染（「壊れた JSON フォールバック」テストが検出）。`structuredClone` による deep copy に修正し、全テストを再実施して全件パス
- ESLint: SessionsPanel の disable 対応と同種の誤検知が SettingsView では発生せず、既置きの disable が「未使用」警告に → disable 行を削除して再実施
