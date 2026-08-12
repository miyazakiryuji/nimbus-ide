# マルチルートワークスペース対応（T-173）

フォルダを 2 つ以上開くと、拡張のあちこちが**黙って 1 つ目だけを見る**。
git の差分も、テストも、カバレッジも、そうなる。しかもエラーは出ない — 
「別のフォルダの結果が出ている」ことに気づけないのが、この問題のいちばん悪いところ。

## 使う側の入口は 2 つだけ

```ts
import { pickWorkspaceRoot, resolveWorkspaceRoot } from './workspaceRoots';

// 聞かずに決める（手がかりがあるとき・フォルダが 1 つのとき）
const folder = resolveWorkspaceRoot(editor.document.uri);

// 決まらないときだけ聞く
const folder = await pickWorkspaceRoot();
if (!folder) { return; }
```

**`pickWorkspaceRoot()` はフォルダが 1 つなら即座に返す。** 聞くのは
「2 つ以上あり、かつ手がかりでも決まらない」ときだけ。コミット前や競合の最中に
毎回ダイアログが出ると、道具として使えなくなる。

フォルダが 1 つも無いときは `pickWorkspaceRoot()` が「フォルダを開いてください」と伝えて
`undefined` を返すので、呼ぶ側でメッセージを出す必要は無い。

## 実装

- `extensions/nimbus/src/core/workspaceRoots.ts` — どのルートかを決める判断（純関数）
- `extensions/nimbus/src/workspaceRoots.ts` — VS Code の口（QuickPick）
- テスト: `extensions/nimbus/src/test/workspaceRoots.test.ts`

**入れ子のルートでは、いちばん深く一致するものを選ぶ。** モノレポの根とその中の
パッケージを両方開いている構成でも、近い方が当たる。

## 載せ替えの進みかた

`workspaceFolders[0]` を直に見ている箇所は、この機能を入れた時点で **39 箇所 / 31 ファイル**
あった。全部を一度に置き換えると、5 セッションで並行している他の作業と必ずぶつかる。

**T-236（ツリービューの共通土台）と同じく、各セッションが自分の持ち場を自分の番で載せ替える。**

- 載せ替え済み: `impactedTests` / `repoSummary` / `coverageDiff` / `refactorProgress` /
  `snapshotReview` / `bulkChange` / `conventions` / `decisions` / `apiDocs` / `equivalence` / `snippets`
- 残り: 28 ファイル（各担当セッションの持ち場）
- 既にマルチルート対応済み: `flutterTests`（いちばん近い `pubspec.yaml` を上へ辿る）

## 確認すること

- [ ] フォルダ 1 つのとき、どのコマンドでもフォルダを聞かれない
- [ ] フォルダ 2 つのとき、開いているファイルのあるフォルダが対象になる
- [ ] どのフォルダにも属さないファイルを開いていると、選択が出る
- [ ] フォルダを開いていないとき、「フォルダを開いてください」が出る
- [ ] 入れ子のルートで、深い方（パッケージ側）が選ばれる

## 残っていること

- **セッションの作業ディレクトリ（`workspaceCwd()`）は未対応。** ここを変えると
  実行中のセッションの前提が変わるので、担当セッションと相談してから
- 上の「残り 28 ファイル」
