# Herdr のセッションを読む

**タスク**: T-279（前提: T-280 の権利確認）/
**実装**: `extensions/nimbus/src/core/herdr.ts`（解釈）, `src/herdr.ts`（ソケット）,
`src/extension.ts`（一覧へ混ぜる）/ **テスト**: `src/test/herdr.test.ts` /
**権利**: [herdr-license-review](../history/herdr-license-review.md)

## なぜ

[Herdr](https://github.com/herdrdev/herdr) は「コーディングエージェントが乗る実行環境」で、
Nimbus が欲しかったものを 3 つ持っている。

| Herdr が持っているもの | Nimbus の対応する課題 |
| --- | --- |
| 常駐サーバが端末を保持し、閉じてもセッションが生き残る | 持ち主と「続きから」（[session-registry](session-registry.md)・T-247 / T-252） |
| エージェントの状態を working / blocked / idle / done で持つ | タブの色（[cockpit-fullscreen](cockpit-fullscreen.md)・T-269 ③） |
| ローカルソケット API と CLI で外から読める | — |

## 決めたこと — 置き換えず、並べて置く

Nimbus は SDK を**拡張ホストのプロセス内で直接**叩いている（`SessionManager` が `query()` を呼ぶ）。
Herdr は**端末の中で CLI を走らせる**前提なので、そのまま入れると**セッションの持ち主が二重になる**。
既存を壊さない原則から、まずは **Herdr 側で起きているものを読んで一覧に混ぜる**だけにする。

- **読むだけ。操作はしない。** 両方から触ると、どちらの前提も黙って壊れる
- **同梱しない。入っていれば使う**（権利の確認結果）。ソケットが無ければ、何も起きない
- 一覧では Herdr のぶんも**同じ記号**で状態を出す（読み手の頭を切り替えさせない）。
  選んでも開かない — Nimbus の持ちものではないことを伝えるだけ

## 読みかた（socket API）

| | |
| --- | --- |
| 置き場所 | `HERDR_SOCKET_PATH` → `HERDR_SESSION` の名前つき（`~/.config/herdr/sessions/<名前>/herdr.sock`）→ `~/.config/herdr/herdr.sock` |
| かたち | 改行区切り JSON。`{"id","method","params"}` → `{"id","result"}` / `{"id","error"}` |
| 使う口 | `agent.list`（1 往復・1.5 秒で諦める） |
| 読む項目 | `pane_id` / `agent_status` / 題名（下記）/ `foreground_cwd`（無ければ `cwd`）|

状態の寄せかたは次のとおり。`blocked`（外部の入力待ち）が Nimbus の「許可待ち」と同じ意味になり、
**止まっているものを先に見せたい**という並べ替えの理由まで一致する。

| Herdr | Nimbus のタブ |
| --- | --- |
| `blocked` | 許可待ち |
| `working` | 作業中 |
| `done` | 完了 |
| `idle` | あなたの番 |
| `unknown` | 中断 |

### 本物と突き合わせた結果（T-297 / T-299）

**herdr 0.8.2 を入れて実際に叩いた。** 文書だけを見て直した T-297 は、実物では外れていた。

実測の応答（エージェントを 1 つ立てた状態）:

```json
{"id":"nimbus-1","result":{"type":"agent_list","agents":[
  {"terminal_id":"term_…","name":"login-fix","agent":"claude","agent_status":"working",
   "workspace_id":"w1","tab_id":"w1:t1","pane_id":"w1:p1","focused":true,
   "cwd":"/w/app","foreground_cwd":"/w/app","revision":0}]}}
```

- **題名は `name`（人が付けた名前）**。`title` / `terminal_title*` は**端末が OSC で題名を
  出していないと入らない**ので、普通のエージェントのペインでは空になる。
  文書に載っていた `terminal_title_stripped` を先頭にしていたら、全部 `w1:p1` と出るところだった。
  並びは `name` → `title` → `terminal_title_stripped` → `terminal_title` → `display_agent` →
  `agent` → `pane_id`。**最後の砦は種類（`claude`）** — pane_id よりは何が動いているか分かる
- **作業場所は `foreground_cwd` → `cwd`。** どちらも返る（前面のプロセスの場所のほうが実態に近い）
- ソケットは `~/.config/herdr/herdr.sock`（`herdr status` の表示と一致）
- **往復は 105 ms**（諦める上限 1.5 秒に十分な余裕）
- 状態の綴りは `idle` / `working` / `blocked` / `done` / `unknown` — 寄せかたの表と一致。
  ただし**外から報告できるのは `idle` / `working` / `blocked` / `unknown`** の 4 つで、
  `done` はサーバーが導く（「idle でまだ見ていない」）

**偽のソケット（GUI ケース 48）も本物の形に直した。** 自分で書いた形に答えていたので、
食い違いを捕まえられない作りになっていた — これがズレを見逃した原因。

## 確かめかた

Herdr を入れずに確かめる — **文書どおりの受け答えをする偽のソケット**を立てて、読み手が通るかを見る
（`src/test/herdr.test.ts`）。居ないとき・答えないときに画面が止まらないことも同じところで見る。

**実機（本物の Herdr 0.8.2）との突き合わせは済み**（T-299・利用者の了解を得て導入）。
上の「本物と突き合わせた結果」がそれ。ふだんの回帰は偽のソケット（GUI ケース 48）が見る —
ただし**偽の形は本物に合わせて書く**こと。合っていない偽ソケットは、通っても何も守らない。

## 確認すること

- [x] ソケットの置き場所が実物と一致する — `herdr status` の表示と突き合わせ（T-299）
- [x] `agent.list` の応答の形と項目名 — 本物に繋いで実測（T-299・`herdr.test.ts` に写した）
- [x] 状態の綴りが一致する（`idle` / `working` / `blocked` / `done` / `unknown`）— スキーマと突き合わせ
- [x] 1.5 秒で足りる — 実測 **105 ms**（T-299）
- [x] パッケージ版の一覧に、本物のぶんが**同じ記号**で混ざる —
      `● login-fix　Herdr · 作業中` と出た（T-299）
- [x] **読むだけで操作しない** — 一覧から選んだあとも Herdr 側の
      `state_change_seq` / `revision` / ペイン数が変わらないことを確認（T-299）
- [x] Herdr を落としたときに一覧が止まらない — **本物で確かめた**（T-299）。
      止めるとソケットごと消えるので即座に空（0 ms）。ファイルだけが残った場合も
      繋げずに 1 ms で空（`古いソケットが残っていても、待たずに空で返す`・`herdr.test.ts`）

## 決めなかったこと

- **Herdr へ置き換える**のはやらない。持ち主が二重になる問題を解いていない
- **イベント購読**（`events.subscribe`）は使わない。1 往復で足りるうちは、繋ぎっぱなしにしない
- **CLI 経由**（`herdr workspace list`）は使わない。ソケットのほうが往復が軽く、
  バイナリの場所を探さずに済む
