# コミットメッセージの生成と型

**タスク**: T-305（生成ボタン）/ T-309（型の指定） /
**実装**: `extensions/nimbus/src/core/commitMessage.ts`（型の判定・指示文・整形）,
`src/commitMessage.ts`（SCM への配線）, `src/oneShot.ts`（使い捨ての 1 往復・評価と共用） /
**テスト**: `src/test/commitMessage.test.ts` /
**隣**: [commit-split](commit-split.md)（束ねかたの提案。こちらは**組んだあと**の文章）

## なぜ

差分を見ながらメッセージを打つのは、毎回同じ種類の要約作業になる。
一方で機械に任せきると、リポジトリごとの型（このリポジトリなら日本語 1 行目
`Nimbus: 〜（T-xxx）`）から外れた文が入り込む。**型に合わせて書かせ、人が読んでから使う。**

## 振る舞い

**「コミットメッセージを作る」**（`nimbus.generateCommitMessage`・`$(sparkle)`）。
置き場所は **SCM の入力欄**（`menus."scm/inputBox"` — 標準の Generate Commit Message と
同じ場所。Copilot を外しているのでこの口は空いている）。コマンドパレットからも呼べる。

1. **材料は `git diff --staged` だけ。** 空なら「先に組んでください」と言って終わる
   （束は [commit-split](commit-split.md) で組める）。**勝手に `git add` しない** —
   並行セッションでは他人の変更を巻き込む
2. **生成の前に「いまの型」を見せる**（T-309）。既定は過去 30 件の 1 行目から数えて当てる
   （過半数が Conventional なら Conventional、それ以外は「過去のコミットをまねる」）。
   違えば押す前に選び直せる。設定 `nimbus.commit.style` で固定もできる
3. 軽いモデル（既定 `haiku`・`nimbus.commit.model`）で 1 往復。使い捨てセッションなので
   **タブにも状態の帯にも出さない**（`oneShot.ts` の名簿で外す）。
   指定モデルが環境に無ければ、既定のモデルでやり直す
4. できた文は**入力欄に入れるだけ**。コミットも push もしない（人が読んでから）。
   入れる直前に必ずサニタイザを通す（公開リポジトリに資格情報・個人情報を載せない）

## 型（T-309）

| 型 | 中身 |
| --- | --- |
| `repo` | **過去のコミットをまねる**。最近の 1 行目を手本として渡す（形をコードに書き込まない — リポジトリごとに違う） |
| `conventional` | Conventional Commits（`type(scope): summary`） |
| `template` | `git config commit.template` のテンプレートに従う（**標準の口を読む。作り直さない**）。テンプレートが無ければ候補に出さない |

設定: `nimbus.commit.language`（auto / ja / en・auto は過去の 1 行目から当てる）/
`nimbus.commit.subjectMax`（既定 72）/ `nimbus.commit.body`（本文を書くか）/
`nimbus.commit.coAuthor`（`Co-Authored-By: Claude` を付けるか・既定 off）。

## 決めたこと

- **巨大な diff はファイルの境界で切る**。文字数で機械的に切ると hunk の途中で千切れる。
  入りきらないファイルは名前だけ残し、`--stat` の全体像は必ず渡す。切ったときは
  「一部は要約だけを材料にした」と言う
- **型の数え上げは `conventions.ts` と別**。conventions が数えているのはコードの書き方で、
  コミットの型は別の癖
- 返ってきた文の**前置きとコードフェンスは剥がす**（指示していても付くことがある。
  入力欄に入る直前の砦）
- git 拡張が居ない環境では、捨てずにクリップボードへ

## 確認すること

- [x] 型は過去のコミットから数えて当てる — `commitMessage.test.ts`
- [x] 巨大な diff はファイルの境界で切り、省いた名前を残す — `commitMessage.test.ts`
- [x] 前置きとコードフェンスを剥がす — `commitMessage.test.ts`
- [ ] 画面確認: staged が空のとき「先に組んでください」と出て何も起きない
- [ ] 画面確認: SCM の入力欄の上にボタンが出て、押すと型の選択 → 生成 → 入力欄に入る
- [ ] 画面確認: 生成中にタブが増えない（使い捨てセッションが漏れて見えない）
