# セッションを画面分割で並べて見る（設計）

**タスク**: T-320（旧 T-315）/ **状態**: 設計。実装は T-314（タブ・Home）と T-318（復元）が
落ち着いてから — 同じ配線（`CockpitViewHost` の post 経路）を触るため /
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

## 実装の順番（T-314 / T-318 の後）

1. `WebviewViewHost` に surface 束縛と宛先つき post（既存呼び出しは無変更で通る形）
2. `snapshotFor(sessionId)`（`snapshot()` はそれの「アクティブ版」として残す）
3. 入力の向き先（InboundMessage に束縛を添える）
4. 入口（右クリック）と GUI ケース（2 本走らせ、並べた面が別々の会話を映すこと）
