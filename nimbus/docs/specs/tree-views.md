# ツリービューの共通土台

## 何を解決するのか

Nimbus のサイドバーには読み取り専用のツリーが 4 つ並んでいて（文脈 / セッションの中身 /
使用量 / MCP サーバー）、どれも「ノードの木を作って `TreeItem` に写す」だけの同じ形をしている。
`getTreeItem` が 4 回、`EventEmitter` の宣言が 4 回、空グループの言い回しが 2 回。
**ドクターの `duplication` が 4 箇所の重複として拾った**のがきっかけ。

対応する tasks.md の項目: T-236。

## 振る舞い

**利用者から見た振る舞いは変わっていない。** 内部の整理だけ。

## 設計

`extensions/nimbus/src/views/treeView.ts`:

- `TreeNode` — 各ビューが組み立てるノード（label / description / tooltip / children /
  icon / contextValue / resource）
- `NimbusTreeView` — `vscode.TreeDataProvider` の実装。継承側は **`nodes()` を実装し、
  中身が変わったら `refresh()` を呼ぶ**だけ
- `group()` — 見出し 1 つと、その下の一覧。空のときの言い回しもここに置く

Webview 側の `webview/WebviewViewHost.ts` と同じ考え方で、**表示の決めごとは持たない**。
何を出すかは各ビューが決め、土台は木の受け渡しと `TreeItem` への変換だけを引き受ける。

あわせて `core/toolInput.ts` を切り出した。「どのファイルを触ったか」の取り出しは
`core/activity.ts`（1 セッションを畳む）と `core/sessionFiles.ts`（全セッション横断）の
両方が要る。同じ取り出し方を 2 つ持つと、片方だけキー名を足したときにズレる。

### 折りたたみの状態を書き分けない

`children` があれば `Collapsed`、無ければ `None`。4 箇所で同じ三項演算子を書いていた。
土台に寄せたので、新しいビューを足すときに迷わない。

## 受け入れ条件

- [x] 4 つのビューすべてが土台を使っている（`activityView` / `contextView` / `mcpView` / `usageView`）
- [x] ドクターの `duplication` から、この 4 箇所の指摘が消えている
- [x] 単体テスト 498 件が通る（Before と同数以上）
- [x] GUI テストでビューが従来どおり並ぶ

## 決めなかったこと・やらないこと

- **Webview のビュー（コックピット / タスク / ヘルプ）は対象外。** 別の土台
  （`webview/WebviewViewHost.ts`）が既にある
- **表示の決めごとを土台に持たせない。** アイコンの選び方・並び順・空のときの文言は
  ビューごとに違う。共通化すると、揃えたくないものまで揃ってしまう
- **`TreeItem` を直接返す口は残していない。** 特殊なことをしたくなったら、
  そのときに土台へ足す（先回りして口を開けない）
