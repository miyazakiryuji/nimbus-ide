# 他のツールの設定を取り込む（T-068）

Cursor や Copilot を使っていた人には、既に**書き溜めた指示**がある。
それを書き直させるのは移行の壁でしかないし、書き直す過程で必ず抜ける。

形式はどれも「Markdown で書かれたルール」なので、**出どころを添えて並べれば足りる**。

## 振る舞い

コマンド **「他のツールの設定を取り込む」**（`nimbus.importOtherToolRules`）:

1. 次のファイルを探す
   - `.cursorrules` / `.cursor/rules/*.mdc`（Cursor）
   - `.github/copilot-instructions.md` / `.github/instructions/*.instructions.md`（GitHub Copilot）
   - `.windsurfrules`（Windsurf）
2. 見つかったものを一覧で見せ、確認を取る
3. `CLAUDE.md` の**末尾に足す**（無ければ作る）。開いて結果を見せる

足される形:

```markdown
## 他のツールから取り込んだ指示

（2026-08-13 に Nimbus が取り込みました。**中身は変換していません。**
そのまま使えるか、書き直すか、消すかを判断してください）

### .cursorrules（Cursor）

（元の中身がそのまま）
```

## 実装

- `extensions/nimbus/src/core/importRules.ts` — 見分けと変換（純関数）
- `extensions/nimbus/src/importRules.ts` — 探索と追記
- テスト: `extensions/nimbus/src/test/importRules.test.ts`

## 決めたこと

**中身は変換しない。** 「Claude Code 向けに書き直す」ことはしない。
言い回しを機械が変えると、**元の意図が消える**。判断は人に残す。

**出どころを必ず書く。** どこから来た指示か分からないルールは、あとで消せなくなる
（「これは要るのか？」に誰も答えられない）。取り込んだ日付も書く。

**追記だけ。既存の CLAUDE.md は書き換えない。** 末尾に節として足す。

**frontmatter は落とす。** `.mdc` の `---` で囲まれた見出しは Cursor 固有で、
Claude Code は読まない。残すと本文と混ざる。

**確認を取ってから書く。** モーダルで、何が足されるかを見せてから。

## 確認すること

- [ ] `.cursorrules` があるリポジトリで実行すると、一覧に出る
- [ ] 確認して進めると `CLAUDE.md` の末尾に節が足される
- [ ] `CLAUDE.md` が無いリポジトリでは新規作成される
- [ ] 既存の記述が消えない
- [ ] `.mdc` の frontmatter が落ちている
- [ ] 設定が無いリポジトリでは、探した先を添えて「見つかりません」と出る

## 残っていること

- MCP サーバー設定（`.cursor/mcp.json` など）は取り込んでいない。ルールだけ
- ユーザー階層（`~/.cursor` など）は見ていない。ワークスペースの中だけ
