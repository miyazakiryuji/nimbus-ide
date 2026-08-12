# Nimbus — 作業ルール

Nimbus 固有のルールだけを置く。VS Code コードベース側の作法は
[`.github/copilot-instructions.md`](.github/copilot-instructions.md)（`.claude/CLAUDE.md` はそこへのシンボリックリンク）。
開発の原則は [`README.md`](README.md)、やること・やりたいことは [`tasks.md`](tasks.md)。

## Git — 細かくコミットし、必ず push する

- **コミットとプッシュは細かく、必ず実施する。** 意味の通る単位ができた時点でコミットし、溜め込まない
- 1 コミット = 1 つの意図。無関係な変更を混ぜない
- **コミットしたら、その都度 push する** — `git pull --rebase origin nimbus` → `git push`。
  複数の AI が同じブランチ `nimbus` を同時に触るので、ローカルに溜めるほど競合が解けなくなる
- 他のセッションの未コミット変更を `git stash` / `git checkout --` / `git reset --hard` で消さない
- 公開リポジトリ（`miyazakiryuji/nimbus-ide`）なので、個人情報・実名・資格情報を含めない

## 実装したら記録も直す

実装と**同じコミットで** `nimbus/docs/specs/` の仕様書と [`tasks.md`](tasks.md) を直す。
コア（`src/vs/**`）に触ったら `nimbus/docs/core-changes.md` にも記録する。
（詳細は README「実装したら仕様書を直す」「複数の AI で並行開発する」）
