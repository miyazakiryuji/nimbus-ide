# コックピットとタスク板をエディタタブで開く

**タスク**: T-258 / **実装**: `extensions/nimbus/src/webview/WebviewViewHost.ts`,
`src/cockpit/CockpitViewProvider.ts`, `src/tasks/BoardViewProvider.ts` /
**テスト**: `nimbus/tests/gui/cases/42-editor-tabs.mjs`

## なぜ

コックピットもタスク板もサイドバーの中にある。サイドバーは**幅が足りない** —
会話は折り返しだらけになり、板は列が縦に潰れる。腰を据えて読むときは、
エディタと同じ広さで開けたほうがよい。

## 決めたこと — 面は増やすが、状態は増やさない

いちばん危ないのは「サイドバーとタブで中身が食い違う」こと。
そこで**持ち主を増やさない**: 中身（イベント・タスク）は今までどおり拡張ホスト側が持ち、
Webview は描くだけ。タブを開いても増えるのは `postMessage` の宛先だけで、
同じものが両方へ届く。

| | 持ち主 |
| --- | --- |
| 会話のイベント・セッションの状態 | 拡張ホスト（`extension.ts`） |
| タスクの一覧 | `TaskService` ＋ 板の台帳（[task-board-shared](task-board-shared.md)） |
| サイドバーの面 / タブの面 | **どちらも描くだけ** |

- `WebviewViewHost.openInEditor(viewType, title)` で開く。既に開いていれば前面に出すだけ
- `retainContextWhenHidden` を付ける。タブを切り替えるたびに作り直すと、
  打ちかけの文や表示位置が消える
- 面の準備（メッセージの購読）は `onResolved(surface)` を両方から呼ぶ。
  サイドバー用とタブ用に別々の配線を書くと、片方だけ直して腐る

## 入口

- コマンド「Nimbus: コックピットをタブで開く」（`nimbus.openCockpitTab`）
- コマンド「Nimbus: タスク板をタブで開く」（`nimbus.openBoardTab`）

サイドバー側は**そのまま残す**。狭くてもすぐ見えることに価値があるので、
置き換えではなく「広く見たいときの逃げ道」として足す。
