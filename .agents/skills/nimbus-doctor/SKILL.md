---
name: nimbus-doctor
description: Nimbus の健康診断。不要ファイル・どこからも辿れないモジュール・使われていない依存・宣言と実装のズレ・台帳の記載漏れを機械的に洗い出し、直すところまでを扱う。リポジトリの掃除や、実装後の後片付けに使う。
---

# ドクター（健康診断）

## いつ使うか

- 機能を実装したあと、置き去りのファイルや宣言が残っていないか確かめたいとき
- リポジトリが散らかってきた気がするとき
- upstream へ追従したあと（台帳と実際の差分がズレやすい）

## 走らせる

```bash
node nimbus/scripts/doctor.mjs           # 全部
node nimbus/scripts/doctor.mjs contributes ledger   # 検査を選ぶ
node nimbus/scripts/doctor.mjs --json    # 機械で読む
```

見る範囲は **Nimbus が書いた部分だけ**（`extensions/nimbus/` と `nimbus/`）。
upstream の `src/vs` まで見ると指摘が洪水になり、肝心の問題が埋もれる。

## 検査の中身と、出たときの直しかた

| 検査 | 何を見るか | 出たらどうするか |
| --- | --- | --- |
| `orphans` | どこからも import されていない `.ts` | 本当に使っていないなら消す。使うつもりなら入口から繋ぐ |
| `deps` | 宣言されているのに import されていない依存 | 消す。同梱物は少ないほどよい |
| `contributes` | package.json の宣言 ⇄ 実装（コマンド/ビュー/設定） | **宣言と実装のどちらが正しいか**を決めてから合わせる。片方を消すだけで済ませない |
| `assets` | 参照されていない `media/` `resources/` `themes/` | 消す。テーマやアイコンは package.json 経由の参照も見ている |
| `artifacts` | git に入り込んだ `out/` `dist/` `.DS_Store` 等 | `git rm --cached` して `.gitignore` に足す |
| `ledger` | upstream のファイルへの変更 ⇄ `nimbus/docs/core-changes.md` | **台帳に追記する**。コア変更を記録しない運用は追従で必ず破綻する |
| `docs` | README・ゆあのガイド・docs の設定名／リンクの実在 | 実装に合わせて文書を直す（逆ではないことが多い） |

## 判断のしかた

- **「要対応」は落とさない。** 消すか、繋ぐか、記録するかの 3 択で必ず片づける
- **「参考」は放置してよい。** 例: 宣言はあるが読んでいない設定（説明のためだけに置くことがある）
- 指摘が誤りなら、**ドクター側を直す**。誤検出を放置すると、次から誰も見なくなる
  （実際に「upstream 自身のコミットを我々の変更と誤認する」不具合が出て、基点コミットを
  `core-changes.md` の `<!-- nimbus:base ... -->` に明記する形へ直した）

## 直したら

- コア変更を足したなら `nimbus/docs/core-changes.md` の表に 1 行足す
- 掃除で振る舞いが変わったなら `nimbus/docs/specs/` と README も直す（同じコミットで）
- `bash nimbus/scripts/test.sh` を通してからコミットする
