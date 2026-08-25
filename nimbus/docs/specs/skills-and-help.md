# スキルの一覧・検索と、ヘルプ（ゆあ）

「何が使えるのか」を見えるようにし、使い方を製品の中で聞けるようにする（フォーク F6）。

## 何を解決するのか

スキルは、探しに行かないと分からないものは使われない。そして「こんなことをしてくれるスキル、
ないかな？」という聞き方は、名前を知らないから曖昧になる。**曖昧な言葉で探せること**が要る。
使い方も同じで、ドキュメントを探しに行かせた時点で読まれない。

## 振る舞い

### スキル一覧（サイドバー「スキル」）

- 出どころで分類する
  - **プロジェクト** — `.claude/skills` / `.agents/skills`
  - **ユーザー** — `~/.claude/skills`
  - **セッション** — プラグイン提供など、ディスクに見つからないもの（init メッセージ由来）
- 行をクリックすると `SKILL.md` が開く
- 行の ▶（コックピットで使う）でコックピットへ `/<name>` を送る
- 見出しに「更新」と「探す」。フォルダを開き直したら作り直す

### スキルを探す（`nimbus.findSkill`）

QuickPick で絞り込む。**名前だけでなく説明文にも当てる**（`matchOnDescription` /
`matchOnDetail`）。「PDF」「スクリーンショット」「レビュー」のような、したいことの言葉で引ける。
スキルが 1 つも無いときは、置き場所（`.claude/skills` / `~/.claude/skills`）を案内する。

### ヘルプ（ゆあ）

- サイドバー「ヘルプ（ゆあ）」で、Nimbus の使い方を日本語で聞ける
- **ゆあにはツールを一切渡さない**（`allowedTools: []`）。リポジトリを触ることはできない
- Nimbus の説明そのもの（画面・承認・タスク・設定）をプロンプトに埋め込んでいる。
  **機能を足したらこの説明も更新する**（`help/yua.ts` の `NIMBUS_GUIDE`）
- 知らないことは推測せず「分からない」と言う。公式を騙らない

## 設計

- `extensions/nimbus/src/core/skills.ts` — SKILL.md の探索と frontmatter 解析（VS Code 非依存）
- `extensions/nimbus/src/skillsView.ts` — 一覧ツリー
- `extensions/nimbus/src/extension.ts` — `nimbus.findSkill` の QuickPick
- `extensions/nimbus/src/help/yua.ts` — ゆあのプロンプトと `NIMBUS_GUIDE`

frontmatter は `name` と `description` の 2 つしか要らないので、YAML パーサは持ち込まない。

## 受け入れ条件

- [x] プロジェクト／ユーザー／セッションの出どころ別に一覧が出る
- [x] 行のクリックで `SKILL.md` が開く
- [x] 曖昧な言葉（説明文にだけ含まれる語）で検索できる
- [x] 名前一致が説明一致より強い
- [x] ゆあが日本語で名乗り、Nimbus の仕様を正しく案内する
- [x] ゆあにツールが渡っていない
- [x] 画面確認（`nimbus/docs/testing/f3-f6.md` §6）— GUI ケース `11-help-yua.mjs` / `12-skill-quickpick.mjs`

確認記録: `nimbus/docs/testing/f3-f6.md` §4

## 決めなかったこと・やらないこと

- **ゆあにツールを渡すこと** — 使い方に答える以上のことをさせない。ここは変えない
- **サブエージェント・スラッシュコマンド・MCP ツールの検索** — 今は名前が並ぶだけ
  （`tasks.md` T-117）
