# 取り込みと押し上げ（pull --rebase → push）

**タスク**: T-306 /
**実装**: `extensions/nimbus/src/gitSync.ts`（判断と実行・VS Code 非依存）,
`src/extension.ts` の `syncBranch()`（画面）, `package.json` の `configurationDefaults`（既定） /
**テスト**: `src/test/gitSync.test.ts`（bare の origin ＋ クローン 2 つの実 git で確認） /
**隣**: [conflicts](conflicts.md)（競合したあとの手伝い）・T-307 の `git_sync`（同じ安全装置を通る）

## なぜ

Nimbus の作法は「コミットしたら `git pull --rebase` → `git push`」（CLAUDE.md）。
VS Code の Git 拡張は道具（同期ボタン・`postCommitCommand`）を持っているのに、
**既定が作法と合っていない**（merge で同期・コミット後に何もしない）。
一方で、並行セッションの作業ツリーで自動化してよいのは**他人の変更に触らない範囲**だけ。

## 標準の口を先に使う（作り直さない）

`configurationDefaults` で Git 拡張の既定を規約に合わせる:

| 設定 | 既定 | 意味 |
| --- | --- | --- |
| `git.postCommitCommand` | `sync` | コミットしたらそのまま同期 |
| `git.rebaseWhenSync` | `true` | 同期は merge ではなく rebase |
| `git.autofetch` | `true` | 遅れに早く気づく |

**`git.autoStash` は入れない。** 作業ツリーに残っている変更は他のセッションのものかもしれない。
stash は「触る」操作なので、自動でやらない。

## Nimbus 側のボタン（`nimbus.syncBranch`）

コックピットの `...`（`view/title` の nimbus グループ）とコマンドパレット。
`git pull --rebase` → `git push` を 1 押しで。**止まる条件はすべて言葉で返す**:

| 状態 | 振る舞い |
| --- | --- |
| 追跡中のファイルに未コミット変更 | **何もしない**。ファイル名を出し「他のセッションのものかもしれない。autostash はしません」 |
| 追跡先が無い | 何もしない。「公開する（push -u）」を選んだときだけ公開 |
| 取り込みで競合 | **rebase は止めたまま**。「コンフリクトの解決を手伝う」（T-115）か「取り消す（rebase --abort）」を選ばせる |
| 押し上げで失敗（保護ブランチ等） | 取り込みまでは残し、理由を出す |
| 何も無い | 「押し上げるものはありません」（壊れない） |

untracked ファイルは rebase を止めないので、あっても進む（触らない）。

## 確認すること

- [x] 取り込んで押し上げる（相手の変更と自分のコミットが両方通る） — `gitSync.test.ts`
- [x] 未コミットの変更が残っていたら、何もせず止まる（autostash しない） — `gitSync.test.ts`
- [x] 競合したら rebase を止めたまま返す（黙って続けない） — `gitSync.test.ts`
- [x] 追跡していないブランチでは公開せずにそう言う — `gitSync.test.ts`
- [x] 何も無いときに押しても壊れない — `gitSync.test.ts`
- [ ] 画面確認: コックピットの `...` から押せて、結果が通知で読める
