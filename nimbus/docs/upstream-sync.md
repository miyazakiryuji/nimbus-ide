# upstream 追従を一度実際に回した記録（T-007）

`nimbus/scripts/sync-upstream.sh` を **1.132.0 → `release/1.133`** で実際に回した。
手順書として書いてあったことと、実際に起きたことが**かなり違った**ので、
両方を残す（スクリプトはこの記録に合わせて直した）。

実施日: 2026-08-13 / 基点: `df53daab`（タグ `1.132.0`）/ 対象: `upstream/release/1.133`

---

## 分かったこと 1 — 一時ファイル 1 つで止まる

作業ツリーの汚れを `git status --porcelain` で見ていたので、
**追跡していないファイルが 1 つあるだけで実行できなかった**。
実際に止めたのは道具が置いた `.observer.lock` 1 個だけ。

rebase は追跡していないファイルに関与しないので、見る必要が無い。
**`--untracked-files=no` に変えた。** ついでに、止めたときは
どのファイルが汚れているのかを出すようにした（出さないと探しに行くことになる）。

## 分かったこと 2 — 基点が間違っていて、検査が毎回「全部変更あり」だった

もとの実装はこう書いていた:

```bash
CURRENT_BASE="$(git merge-base HEAD "$(git rev-parse --abbrev-ref --symbolic-full-name @{u} ...)" ...)"
```

`@{u}` は **`origin/nimbus`**（自分の公開先）で、upstream ではない。
しかもこの環境では `@{u}` が空を返し、フォールバックで `HEAD` になっていた。
結果 `CURRENT_BASE = HEAD` になり、比較が **「HEAD 対 upstream/1.133」** になる。

これだと**こちらが変えたファイルが全部「upstream 側で変更あり」に見える**。

| 基点 | 「変更あり」と出たコアファイル |
| --- | --- |
| もとの実装（実質 `HEAD`） | **9 / 9 件**（= 台帳に載っている全部。毎回全部出る） |
| 正しい分岐点（`1.132.0`） | **2 件** |

実際に upstream 側で変わっていたのは次の 2 つだけだった:

- `build/gulpfile.vscode.ts`（+16 行）
- `src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts`（+44 / −20 行）

**9 件出る検査は、0 件出る検査と同じくらい役に立たない。**
いま乗っているリリースは `package.json` の `version` から割り出すようにした。

## 分かったこと 3 — 衝突は「消したファイル」で起きる。台帳のファイルでは起きない

スクリプトの説明にはこう書いてあった:

> 衝突するのは基本的に nimbus/docs/core-changes.md に載っている数ファイルだけになる

**逆だった。** `git merge-tree` で先に併合してみた結果:

| 種類 | 件数 |
| --- | --- |
| `modify/delete` | 110 |
| `rename/delete` | 3 |
| **`content`（内容そのものの衝突）** | **0** |
| 合計 | **113** |

**台帳に載っているファイルは 1 つも衝突しなかった。**
上の 2 ファイルは自動で併合できた（`Auto-merging build/gulpfile.vscode.ts`）。
「コア変更を最小に保ち、機能は `extensions/nimbus` に置く」という方針が、
実際に効いていることの裏付けになっている。

代わりに衝突したのは、**Nimbus が消したファイルを upstream が変え続けている**もの:

- `extensions/copilot/**` — **110 件**（全体の 97%）
- `extensions/typescript-language-features/src/utils/generation.ts`
- `src/vs/platform/agentHost/common/agentTelemetryCorrelation.ts`
- `src/vs/platform/agentHost/node/copilot/modelIdentifiers.ts`

110 件は**消したままでよい**ので、1 行で片付く:

```bash
git status --porcelain | awk '/^DU |^UD /{print $2}' | xargs -r git rm -q --
git rebase --continue
```

残る 3 件だけは、**消してよいかを毎回確かめる**。とくに
`src/vs/platform/agentHost/**` は Nimbus のセッション層と役割が近いので、
upstream が何を足したのかを読んでから消す。

## いまのスクリプトがすること

**載せ替えはしない。** 何が起きるかを全部見せて、`rebase` は人が打つ。

1. 追跡中のファイルが汚れていないかを見る（追跡外は無視）
2. upstream を取得し、`package.json` の `version` から**いまの分岐点**を出す
3. 台帳のコアファイルのうち、**向こうが変えたもの**だけを挙げる
4. `git merge-tree --write-tree` で**作業ツリーを触らずに**併合を試し、衝突を種類別に数える。
   `extensions/copilot/` 配下は「`git rm` で片付く」とまとめ、**人の判断が要るものだけ**を名指しする
5. 打つべき `rebase` コマンドと、あとで必ずやることを出す

```
bash nimbus/scripts/sync-upstream.sh release/1.133
```

## まだ確かめていないこと

**実際の `rebase` は回していない。** 複数のセッションが同じ作業ツリーで
動いている最中に載せ替えると、全員の作業が壊れるため。

したがって次は未検証のまま残っている:

- `git rm` による一括解決が、本当に 110 件すべてを片付けるか
- `apply-core-changes.mjs` が 1.133 で当てられるか（当たらなければ失敗して気づける作り）
- 1.133 でビルドと梱包が通るか

**載せ替えを実際にやるときは、1 セッションだけにして、他が止まっているときに行う。**
