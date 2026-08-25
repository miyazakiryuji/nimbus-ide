# セッションを画面分割で並べて見る（設計）

**タスク**: T-320（旧 T-315）/
**実装**: `extensions/nimbus/src/webview/WebviewViewHost.ts`（束縛面と宛先つき post）,
`src/cockpit/CockpitViewProvider.ts`（束縛面の復元と入力の向き先）, `src/extension.ts`（配線と入口） /
**テスト**: GUI ケース `58-session-beside.mjs`（`--with-claude`・別々の会話が並ぶ／入力がその面へ） /
**土台**: [editor-tabs](editor-tabs.md)・[cockpit-fullscreen](cockpit-fullscreen.md)

## なぜ

いまはコックピットの面（サイドバー・エディタタブ）がすべて**同じアクティブセッションの鏡**。
2 面開いても同じものが映るので、並列で走らせたセッションを**並べて見比べる**ことができない。
エディタグループに置く器（`openInEditor`）は既に有る — 残りは「どの面がどのセッションを
見るか」の配線の問題。

## 作り（3 段）

### 1. 面ごとの宛先（post の分割）

`WebviewViewHost` はいま「view と panel の両方へ同じ post」を送る。これを
**面（surface）ごとに `sessionId` の束縛を持てる**形にする:

- `Surface = { webview, boundSessionId?: string }`。`boundSessionId` が無い面は
  従来どおり「アクティブの鏡」（サイドバーは常にこれ。今の振る舞いを壊さない）
- `post(message, options?: { sessionId?: string })` — セッション向けのメッセージ
  （history / event / status / runSettings / sessionState）は、束縛の一致する面だけへ。
  枠（quota）や板のような**セッションに依らないもの**は全面へ

### 2. セッション別のスナップショット

`snapshot()` が返すもの（events / session / approvals / tabs / run / state）を
`snapshotFor(sessionId)` に一般化する。材料は既にある — 会話の控えは `archived`
（全セッションぶん）、承認は broker が sessionId 付きで持っている。
**`retained`（アクティブのぶん）の約束は変えない** — 束縛された面だけが `archived` から引く。

### 3. 入力と承認の向き先

束縛された面からの `send` / `interrupt` / 承認カードの答えは、**その面のセッション**へ。
`InboundMessage` に面の束縛を添える（webview 側は自分の `boundSessionId` を知っていて、
送るときに乗せるだけ。webview に新しい状態は持たせない）。

## 入口

- タブ列（または Home・T-314 の形に従う）の右クリック「横に並べて開く」→
  `openInEditor` を `ViewColumn.Beside` で開き、そのセッションに束縛
- 束縛された面のタイトルはセッション名（`タブ名 — Nimbus`）。タブ列は出さない
  （束縛面は 1 本を見続ける面。切り替えたいなら鏡の面を使う）

## 決めごと（先に決めておく）

- **束縛面は閉じても何も止めない**（見るのをやめるだけ）
- 束縛先のセッションが終わった・消えたら、面には「終わりました」を出したまま残す
  （黙って白紙にしない）
- 面の数に上限は置かない（エディタグループの管理は VS Code に任せる）

## 実装したこと（設計からの差分）

1. `WebviewViewHost.openBeside(viewType, title, sessionId)` — 束縛面は `boundPanels`
   （sessionId → panel）で持ち、鏡（view / panel）はそのまま。`postToSurface` で宛先つき送信
2. 束縛は **webview に持たせず**、`onResolved(surface, boundSessionId)` の閉包で持つ
   （設計では InboundMessage に添える案だったが、閉包のほうが webview を一切変えずに済む）
3. 束縛面の webview には sessions / quota / runSettings を送らない — タブ列・帯・+ は
   **出さないことで**「1 本を見続ける面」になる（webview のコードは無変更）
4. 入口はコマンド「セッションを横に並べて見る」（`view/title` の `...` とコマンドパレット）。
   下書き・前回のセッションは候補に出さない（並べて見る中身が無い）
5. 承認カードは束縛面にも、その面のセッションのぶんだけ配る
