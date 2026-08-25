# Git をエージェントの口にする（nimbus_git）

**タスク**: T-307 /
**実装**: `extensions/nimbus/src/gitTools.ts`（MCP サーバー）,
`src/core/gitTools.ts`（読み解きと安全装置・VS Code 非依存）,
`src/core/secrets.ts`（承認の言い分け）, `src/gitSync.ts`（`git_sync` の中身・T-306 と共用） /
**テスト**: `src/test/gitTools.test.ts`, `src/test/safety.test.ts`（素通しの言い分け） /
**隣**: [commit-message](commit-message.md)（T-305 / T-309）・[git-sync](git-sync.md)（T-306）・
[commit-split](commit-split.md)

## 検討 — どこまでを口にするか

素の `git` は Bash で打てる。**ただのラッパーは選ぶ基準 1（Claude Code 単体でできることは
作らない）に引っかかる**ので、足したのは Nimbus 側にしか無いものだけ:

| 口 | Nimbus にしか無いもの | 承認 |
| --- | --- | --- |
| `git_status` | **自分が組んだ束**と**作業ツリー（他のセッションのものかもしれない）**を分けて返す。素の `git status` はこの区別を教えない | 素通し（読み取りのみ） |
| `git_stage` | **パス名指しのみ**。`-A` / `.` / フラグ / 範囲外は言葉で断る | 承認カード |
| `git_commit` | メッセージが**リポジトリの型**（T-309 と同じ物差し）に合うかを検査してから組む。競合が残っていれば断る。`-a` は無い | 承認カード |
| `git_sync` | `pull --rebase` → `push`。**T-306 のボタンと同じ安全装置**（autostash しない・競合で止まったまま返す） | 承認カード |

**口に出さないと決めたもの**（実装しない・引数にも無い）:

- **履歴を壊す操作** — force push / `reset --hard`
- **他人の変更に触る操作** — `stash` / `checkout --` / `git add -A` / `commit -a`
- **ブランチの切り替え** — 同じ作業ツリーで動いている他のセッションの足場ごと動かすことになる

## 承認の言い分け（重要）

`mcp__nimbus_*` は「読み取り専用の保証」として承認なしで素通しされる規則がある
（`permissions.ts` → `isNimbusReadOnlyTool`）。**書く 3 つ（stage / commit / sync）は
この保証に当てはまらない**ので、`core/secrets.ts` の `NIMBUS_WRITE_TOOLS` で素通しから外し、
普通の承認（会話の中のカード・T-266）に回す。押し上げのような外に出る操作が
名前の接頭辞だけで通る事故を、ここで塞いでいる。監査はツール呼び出しの記録がそのまま残る。

設定 `nimbus.git.enabled`（既定 true）でサーバーごと外せる（`nimbus.lsp.enabled` と同じ形）。

## 確認すること

- [x] porcelain を束と作業ツリーに分けて読む（リネーム・競合・追跡なし含む） — `gitTools.test.ts`
- [x] 返す文に「他のセッションのものかもしれない」の言い分けが入る — `gitTools.test.ts`
- [x] stage はまとめ指定・フラグ・範囲外を言葉で断る — `gitTools.test.ts`
- [x] 書く 3 つは素通しされない（status だけが素通し） — `safety.test.ts`
- [x] `git_sync` の安全装置（autostash しない・競合で止まる） — `gitSync.test.ts`（T-306 と共通の道）
- [ ] 画面確認: セッションが `git_status` を呼べて、`git_stage` で承認カードが出る
- [ ] 画面確認: `nimbus.git.enabled: false` でツールが渡らない
