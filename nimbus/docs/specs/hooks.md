# フックの組み立てとドライラン

## 何を解決するのか

フックは `settings.json` に手で JSON を書くもので、書式を 1 文字間違えると**黙って動かない**。
動かないことにも気づけない。しかも SDK 実測で**イベントは 31 種類**あり、
一覧をそのまま出されても、どれを選べばいいか分からない。

対応する tasks.md の項目: T-026（Hooks の GUI ビルダー）/ T-161（フックのドライラン）。
発火した結果を見るビューア（T-027）は `session-activity.md`。

## 調べたこと — イベントは 31 種類で合っていた

タスクに「フックイベントは 31 種類あるとのこと・要確認」とあった件。
SDK 0.3.226 の `HookEvent` を数えると **31 種類**。タスクの記述は正しい。

`PreToolUse` / `PostToolUse` / `PostToolUseFailure` / `PostToolBatch` / `Notification` /
`UserPromptSubmit` / `UserPromptExpansion` / `SessionStart` / `SessionEnd` / `Stop` /
`StopFailure` / `SubagentStart` / `SubagentStop` / `PreCompact` / `PostCompact` /
`PermissionRequest` / `PermissionDenied` / `Setup` / `TeammateIdle` / `TaskCreated` /
`TaskCompleted` / `Elicitation` / `ElicitationResult` / `ConfigChange` / `WorktreeCreate` /
`WorktreeRemove` / `InstructionsLoaded` / `CwdChanged` / `FileChanged` / `DirectoryAdded` /
`MessageDisplay`

## 振る舞い

### 組み立てる（T-026）

コマンド **「Nimbus: フックを組み立てる」**（`nimbus.hooks`）。

- いま設定されているフックが一覧で出る。**選ぶと削除**、先頭の「フックを足す」で追加
- イベントは **実務で使う 5 つを先に**出す（`PreToolUse` / `PostToolUse` /
  `UserPromptSubmit` / `SessionStart` / `Stop`）。残り 26 は「すべてのイベントを表示」の先
- どのイベントも、**いつ走るかの説明を添える**（名前だけでは選べない）
- `matcher`（ツール名の正規表現）は、**ツールに紐づくイベントのときだけ**聞く
- 保存先は `.claude/settings.json`。**Nimbus 独自の置き場所は作らない** —
  Claude Code 本体が読む場所に書かないと、フックとして動かない
- 既存の設定は保ったまま `hooks` だけ差し替える

### 試す（T-161）

コマンド **「Nimbus: フックを試す（ドライラン）」**（`nimbus.hookDryRun`）。

- フックを選ぶと、**本番と同じ形の JSON** を標準入力へ渡して実行する
- 結果を Markdown で開く — 渡した入力・stdout・stderr・判定
- 判定は終了コードから。**`2` だけが「止めた」**で、それ以外の非ゼロは
  フック側の不具合（止まらない）
- 入力の中身は**作り物だと分かる値**にする（`session_id: nimbus-dry-run`、
  コマンドは `echo nimbus-dry-run`）。本物のパスを混ぜると、
  消す・送るフックが試すつもりで実際に動いてしまう
- 30 秒で打ち切る

## 設計

- `extensions/nimbus/src/core/hooks.ts` — イベント表・設定の組み立て・入力の生成・
  終了コードの解釈。VS Code 非依存
- `extensions/nimbus/src/hooksBuilder.ts` — QuickPick と `settings.json` の読み書き、実行

### 同じ matcher を分裂させない

同じイベント・同じ `matcher` で足したときは、**既にある入れ物へ足す**。
`matcher` ごとに配列が分かれると、どれが効くのか読めなくなる。
外したときに空になった入れ物は残さない（空の配列やキーが残ると、
`settings.json` を読んだ人が「何か設定されている」と誤解する）。

## 受け入れ条件

- [x] イベントが 31 種類あり、よく使う 5 つが先頭（単体テスト）
- [x] matcher を使うのはツールに紐づくイベントだけ（単体テスト）
- [x] 同じイベント・同じ matcher なら既存の入れ物へ足す（単体テスト）
- [x] 外したときに空の入れ物を残さない（単体テスト）
- [x] 無いものを外そうとしても壊さない（単体テスト）
- [x] 一覧はよく使う 5 つを先に並べる（単体テスト）
- [x] ドライランの入力が本番と同じ形で、中身は作り物と分かる（単体テスト）
- [x] 終了コード 2 だけが「止めた」（単体テスト）
- [ ] 画面確認: フックを足して `settings.json` に書かれる
- [ ] 画面確認: ドライランで止まるフックが「止めた」と出る

## 決めなかったこと・やらないこと

- **Webview のビルダーは作らない。** QuickPick の連鎖で足りる。
  作るとしても、まず「何を選ばせるか」が固まってから
- **フックの中身（スクリプト）は書かない。** 何を検査したいかは人にしか決められない。
  ここは書式を間違えないようにするところまで
- **ドライランで本物の入力は使わない**（上記）。試すつもりで実害が出るのが一番困る
- **`~/.claude/settings.json`（ユーザー設定）は触らない。** プロジェクトの
  `.claude/settings.json` だけを扱う。ユーザー設定を書き換えると、他のプロジェクトまで巻き込む
