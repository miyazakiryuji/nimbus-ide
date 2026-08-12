# 確認チェックリスト — 上部メニューバー／アクティビティバー＋コード補完

- 実施日: 2026-08-11
- 指示: 「フォルダを開くなどのメニュータブは上部に。Windows の VS Code を参考に」「自身でプログラムを書く可能性があるのでコード補完も使えるように」
- 方針: NIMBUS_SPEC.md §9「テスト方針」に従い、自動テスト＋細分化チェックリストの両方を消化する

## 1. 自動テスト

| #   | 項目                          | 結果         | 確認方法                          |
| --- | ----------------------------- | ------------ | --------------------------------- |
| A-1 | vitest 全件パス               | OK (184/184) | menu 7 件・monacoSetup 6 件を追加 |
| A-2 | typecheck / ESLint / Prettier | OK           | エラー・警告 0                    |

## 2. 上部メニューバー（Windows VS Code 参照）

| #   | 項目                                                                    | 結果 | 確認方法                  |
| --- | ----------------------------------------------------------------------- | ---- | ------------------------- |
| B-1 | 画面上部に「ファイル / 表示 / ヘルプ」のメニュータブ                    | OK   | MenuBar＋スクショ         |
| B-2 | 「フォルダを開く」をステータスバーから **ファイルメニューへ移設**       | OK   | MenuBar / StatusBar       |
| B-3 | ドロップダウンにショートカット表記（⌘O / ⌘S / ⌘1..⌘5 / ⌘,）             | OK   | MenuBar                   |
| B-4 | 外側クリック・Escape で閉じる、ホバーでメニュー間を移動                 | OK   | MenuBar 実装              |
| B-5 | **ネイティブメニューも同一アクション体系**（OS のショートカットが効く） | OK   | menu.ts＋テスト 7 件      |
| B-6 | 編集メニューは role ベース（コピー/貼り付けが OS 標準で動作）           | OK   | menu テスト               |
| B-7 | ヘルプ → GitHub リポジトリを外部ブラウザで開く                          | OK   | menu テスト＋openExternal |
| B-8 | 左アクティビティバー（6 ビューのアイコン列・選択中を強調）              | OK   | ActivityBar＋スクショ     |
| B-9 | ステータスバーは状態表示に専念（課金モード・実行中数・ワークスペース）  | OK   | StatusBar                 |

## 3. コード補完（TypeScript / JavaScript）

| #   | 項目                                                                                 | 結果 | 確認方法                  |
| --- | ------------------------------------------------------------------------------------ | ---- | ------------------------- |
| C-1 | TS/JS 言語サービスを有効化（compilerOptions・JSX・allowJs・strict）                  | OK   | configureLanguageServices |
| C-2 | **monaco 0.56 の新 API**（トップレベル `typescript` 名前空間）を実型定義で確認       | OK   | 型定義を実測して修正      |
| C-3 | 開いたファイルを `file://<root>/<path>` モデルにして同一プロジェクトの解決を効かせる | OK   | modelUriFor テスト        |
| C-4 | 同じファイルは同じモデルを再利用（URI 一意性）                                       | OK   | monacoSetup テスト        |
| C-5 | 補完系オプション（suggestOnTriggerCharacters / tabCompletion / parameterHints）      | OK   | EDITOR_DEFAULTS テスト    |
| C-6 | 依存パッケージの型が無い環境で「モジュールが見つからない」を抑制                     | OK   | diagnosticCodesToIgnore   |
| C-7 | 自動閉じ括弧・括弧色分け・貼り付け整形など IDE 相当の既定                            | OK   | EDITOR_DEFAULTS           |
| C-8 | ルート切替時にそのルートのモデルを破棄（リーク防止）                                 | OK   | ExplorerBody              |

## 4. E2E

| #   | 項目                                           | 結果 | 確認方法               |
| --- | ---------------------------------------------- | ---- | ---------------------- |
| D-1 | メニューバー・アクティビティバー付きで正常描画 | OK   | スクリーンショット目視 |
| D-2 | renderer エラー 0（Monaco 言語サービス込み）   | OK   | 起動ログ               |
| D-3 | build:mac＋パッケージ版スモーク                | OK   | パッケージ DB 検証     |

## NG 記録と再実施

- **monaco 0.56 で `monaco.languages.typescript` が deprecated スタブ化**していた（型エラーで検出）→ 実型定義を確認し、トップレベル `typescript` 名前空間（`monaco-editor` から named import）へ修正
- ユニットテストから monacoSetup を import すると `self is not defined` で失敗 → worker 登録を `typeof self` でガード（renderer 専用コードの Node 安全性を確保）
- ESLint「effect 内の同期 setState」2 件: カウンタ＋effect をやめ、ボードのフォーム開閉をストア state に変更／保存要求は前回値比較で発火する形に修正（抑制コメントなしで解消）
