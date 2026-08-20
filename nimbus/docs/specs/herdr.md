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
| 読む項目 | `pane_id` / `agent_status` / `terminal_title_stripped`（無ければ `terminal_title`）/ `foreground_cwd` |

状態の寄せかたは次のとおり。`blocked`（外部の入力待ち）が Nimbus の「許可待ち」と同じ意味になり、
**止まっているものを先に見せたい**という並べ替えの理由まで一致する。

| Herdr | Nimbus のタブ |
| --- | --- |
| `blocked` | 許可待ち |
| `working` | 作業中 |
| `done` | 完了 |
| `idle` | あなたの番 |
| `unknown` | 中断 |

### 項目名の突き合わせ（T-297）

公開されている socket API の文書と読み合わせたところ、**題名と作業場所の項目名が違っていた**。

| 読むもの | 直す前 | 実際（文書） |
| --- | --- | --- |
| 題名 | `title` | `terminal_title_stripped`（飾りを落とした OSC タイトル）/ `terminal_title` |
| 作業場所 | `cwd` | `foreground_cwd` |

そのままだと本物に繋いだとき**題名が `w1:p1` のまま**になり、作業場所も出ない。
古い名前も残してある（版が違っても落とさない）。
ソケットの置き場所・状態の綴り（`idle` / `working` / `blocked` / `done` / `unknown`）・
往復の形は文書と一致していた。

## 確かめかた

Herdr を入れずに確かめる — **文書どおりの受け答えをする偽のソケット**を立てて、読み手が通るかを見る
（`src/test/herdr.test.ts`）。居ないとき・答えないときに画面が止まらないことも同じところで見る。

**実機（本物の Herdr）との突き合わせは未実施。** 入れるかどうかは利用者の選択なので、
入れた人が最初に触ったときに分かるよう、一覧に出る形にしてある。
文書との突き合わせ（項目名・状態の綴り・ソケットの置き場所）は済んでいる（T-297）ので、
残るのは**実物の応答が文書どおりか**と、1.5 秒で足りるかの 2 点。

## 決めなかったこと

- **Herdr へ置き換える**のはやらない。持ち主が二重になる問題を解いていない
- **イベント購読**（`events.subscribe`）は使わない。1 往復で足りるうちは、繋ぎっぱなしにしない
- **CLI 経由**（`herdr workspace list`）は使わない。ソケットのほうが往復が軽く、
  バイナリの場所を探さずに済む
