# LSP をエージェントのツールにする（T-098）

Claude Code 単体では、定義を探すのも参照を数えるのも `grep` の総当たりになる。同じ名前の
別物を拾うし、当たりを付けるだけで何度もファイルを読むので文脈も溶ける。

Nimbus は IDE のフォークなので、**言語サーバーはもう隣で動いている**。その答え（定義・参照・
型・呼び出し階層・診断）をそのまま Claude に渡す。`tasks.md` の選ぶ基準 2「VS Code ベースで
しか作れないものを優先する」に、いちばん素直に当てはまる機能。

## 何が入るのか

| ツール | 何を返すか | いつ使うか |
| --- | --- | --- |
| `definition` | 定義の位置（型定義・実装にも切り替え可） | 「この関数はどこで定義されているか」 |
| `references` | 参照している箇所すべて＋その行のソース | 変更の影響範囲を測る |
| `hover` | 型・シグネチャ・ドキュメント | 存在しない引数を思い込みで書く前に確かめる |
| `document_symbols` | ファイルのアウトライン（入れ子のまま） | 全文を読まずに構造だけ掴む |
| `read_symbol` | そのシンボルの**本体だけ** | 巨大ファイルの 1 関数だけを読む（T-099）|
| `workspace_symbols` | プロジェクト全体から名前で検索 | どのファイルにあるか分からないとき |
| `call_hierarchy` | 呼び出し元 / 呼び出し先 | 影響範囲・処理の流れを追う |
| `file_graph` | 依存している先 / 依存されている側 | 変更の影響範囲を構造で掴む（T-100）|
| `diagnostics` | 型エラー・lint の指摘 | 直した直後、テストを回す前 |

ツール名は `mcp__nimbus_lsp__<name>`。すべて**読み取りのみで副作用が無い**。

## 実装

- `extensions/nimbus/src/core/lsp.ts` — 入力の解決と結果の整形（VS Code に依存しない純関数）
- `extensions/nimbus/src/lspTools.ts` — SDK の in-process MCP サーバー（`createSdkMcpServer`）
- `extensions/nimbus/src/extension.ts` — `buildOptions()` で全セッションに渡す
- テスト: `extensions/nimbus/src/test/lsp.test.ts`

別プロセスの MCP サーバーは立てない。**拡張ホストの中で `vscode.commands` を直接呼ぶ**ので、
言語サーバーが持っている答えに追加のコストなしで届く（`vscode.executeDefinitionProvider` /
`executeReferenceProvider` / `executeHoverProvider` / `executeDocumentSymbolProvider` /
`executeWorkspaceSymbolProvider` / `prepareCallHierarchy` / `provideIncomingCalls` /
`provideOutgoingCalls` と `vscode.languages.getDiagnostics`）。

## 決めたこと

**行と桁は 1 起点で受け渡しする。** VS Code の `Position` は 0 起点だが、`Read` ツールの出力は
1 起点なので、モデルから見える面はそちらに揃える。変換は `toPosition()` の 1 か所だけで行う。

**位置は名前（`symbol`）で指定できる。** モデルは行番号ではなく名前で聞いてくる。
`Class.method` の入れ子指定も受け付ける。解決の順は アウトライン（完全一致 → 大文字小文字を
無視 → 末尾一致）→ 本文の走査。本文を走査するときは**宣言らしい行を優先する**（`const other = run`
のような参照を定義と取り違えないよう、手がかりの語は名前の直前にあるものだけを見る）。

**ワークスペースの外は断る。** 読み取りだけとはいえ、任意の場所のシンボル情報を引けるのは筋が
悪い。相対パスはワークスペースを起点に解決し、外に出るものは `resolveWorkspacePath()` が弾く。

**引数名は `file_path`。** `permissions.ts` の秘匿ファイル遮断（`findBlockedRead`）が見るキーに
揃えてある。`.env` や秘密鍵は、このツール経由でも読めない。

**承認は求めない。** `permissions.ts` の `mcp__nimbus_` 素通し規則に乗る。副作用が無く、
1 回の調査で何十回も呼ぶツールなので、そのたびにモーダルを出すと使い物にならない。
止めたいときは設定 `nimbus.lsp.enabled` を `false` にする（セッションに渡さなくなる）。

**空で返ってきたら一度だけ引き直す。** 言語サーバーは最初の問い合わせで温まるので、1 回目の
空を答えとして返すと「定義が無い」と誤解して grep に逃げてしまう（`WARMUP_RETRY_MS`）。

**返す件数は 40 件で切る。** 参照が 500 件ある関数を丸ごと渡しても読めない。切った分は
「…他 N 件」と明示する（黙って落とさない）。

**15 秒で諦める。** 返ってこないプロバイダでセッション全体を止めない。

**`alwaysLoad: true`。** ツール検索の後ろに隠れていると、結局 grep に流れてしまう。

**依存の解決に構文解析を持ち込まない（T-100）。** `import` 行の**引用符の中**か、`from` / `import`
の直後の語を指して**定義ジャンプさせる**。言語の数だけパーサを抱えずに、TypeScript も Dart も
Python も同じ経路で解ける。外れても「依存が 1 件減る」だけで済む。
`dependents`（依存されている側）は、そのファイルの top-level シンボルへの参照を集めて出す。
どちらも 40 か所で打ち切る（1 ファイルに import が 200 行あっても全部は追わない）。

**依存グラフの往復では引き直さない。** 空のときの再試行（`WARMUP_RETRY_MS`）は 1 回の問い合わせ
なら安いが、40 回繰り返すと待ち時間だけが積み上がる。

## 設定

| 設定 | 既定 | 意味 |
| --- | --- | --- |
| `nimbus.lsp.enabled` | `true` | LSP ツールをセッションに渡す |

## 確認すること

- [ ] `definition` が定義位置を返す（`symbol` 指定・`line` 指定の両方）
- [ ] `references` が参照とその行のソースを返す
- [ ] `hover` が型とシグネチャを返す
- [ ] `document_symbols` がアウトラインを入れ子のまま返す
- [ ] `read_symbol` が 1 つの関数の本体だけを返す（T-099）
- [ ] `workspace_symbols` が名前でプロジェクト全体から探せる
- [ ] `call_hierarchy` の incoming / outgoing がそれぞれ返る
- [ ] `file_graph` の dependencies / dependents がそれぞれ返る（T-100）
- [ ] `diagnostics` が型エラーを返す（ファイル指定・全体の両方）
- [ ] ワークスペース外のパスが断られる
- [ ] `.env` を `file_path` に指定すると承認を求めずに拒否される
- [ ] `nimbus.lsp.enabled` を `false` にするとツールが渡らない

## 残っていること

- 言語サーバーの起動待ち（コールドスタート）は一度の引き直しでしか吸収していない。
  大きなプロジェクトの初回は空が返ることがある
- `T-101 型情報による即時検証`（生成直後に `diagnostics` を自動で回して差し戻す）はこの上に載る
- `T-175 型定義の自動添付`（呼ぼうとしている API の実物を先に渡す）も同じ土台
