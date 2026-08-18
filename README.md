# Nimbus

**エージェントを操縦するためのコックピット。** Claude Code のセッション・承認・並列タスク・コストを
ひとつの IDE の中で見渡し、操作できるようにすることを目指しています。

> ⚠️ **これは Anthropic 非公式・Microsoft 非公式の独立プロジェクトです。**
> Anthropic からも Microsoft からも承認・後援・提携を受けていません。

## できること

エディタ・ファイルツリー・SCM・検索・拡張機能といった IDE の土台は
[Code - OSS](https://github.com/microsoft/vscode) のものをそのまま使い、Nimbus は
「**エージェントをどう操縦するか**」に集中しています。

- **コックピット** — Claude との会話。状態・ターン数・所要時間・累計コストが常に見える
- **承認の前に差分** — Claude がファイルを書き換える前に、**適用後の内容を差分エディタで開いてから**
  許可・拒否を選べます。実ファイルにはまだ書き込まれていません
- **並列タスク** — タスクごとに git worktree を切るので、同じリポジトリで複数の Claude を
  同時に走らせても互いの作業を壊しません。**完了時に未コミットの成果はブランチへ自動保存**します
- **文脈の可視化** — 課金モード・モデル・作業ディレクトリ・権限モード・ツール・スキル・
  スラッシュコマンド・MCP サーバー・CLAUDE.md の階層を一覧できます
- **スキル検索** — 「PDF を扱えるやつある？」のような曖昧な聞き方でスキルを探せます
- **ヘルプ（ゆあ）** — 使い方を製品の中で聞けます。ゆあにはツールを渡していないので、
  リポジトリを触ることはありません

## ダウンロードと実行（macOS / Apple Silicon）

### リリースから入れる

[Releases](https://github.com/miyazakiryuji/nimbus-ide/releases) から `.dmg` を落とし、
`Nimbus.app` を「アプリケーション」へドラッグします。

初回起動時、**「開発元を確認できないため開けません」と出ます**。Apple の開発者証明書で
署名していない（ad-hoc 署名の）ビルドのためです。次の手順で開いてください。

1. Finder で `Nimbus.app` を **右クリック → 開く**
2. 確認ダイアログで、もう一度 **開く**

以降は通常どおりダブルクリックで起動できます。

**Claude Code が必要です。** Nimbus は Claude Code 本体を同梱していません
（プラットフォーム別バイナリだけで 280MB あるうえ、利用者はすでに認証済みのものを
持っていることがほとんどのため）。未インストールならまず Claude Code を入れてください。
`PATH` や `~/.local/bin` から自動で探します。見つからない場合は設定
`nimbus.claudeCodeExecutable` にパスを指定できます。

### 手元でビルドする

```bash
git clone https://github.com/miyazakiryuji/nimbus-ide.git
cd nimbus-ide

# Node を .nvmrc（24.18.0）に合わせる（nvm を使う場合: nvm install && nvm use）
node --version   # v24.18.0

npm install                        # Xcode Command Line Tools と Python が必要
npm run compile
./scripts/code.sh                  # 開発ビルドを起動

npm run gulp vscode-darwin-arm64   # 配布形式（.app）を作る
bash nimbus/scripts/make-dmg.sh 0.6.0   # .dmg にする
```

## 使いかた

1. フォルダを開く（信頼していないフォルダでは**画面は開きますが Claude は実行しません**。
   実行しようとすると理由と「このフォルダを信頼する」ボタンが出ます）
2. アクティビティバーの雲アイコン → **コックピット**に指示を書いて Enter
   （サイドバーに常設するのは コックピット / タスク / 承認待ち / レビュー / 文脈 の 5 つ。
   診断は下部パネル「Nimbus 診断」、スキル・CLAUDE.md・設定はアクティビティバーの
   **歯車の雲アイコン「Nimbus 設定」**にまとめてあります）
3. Claude がファイルを書き換えようとすると差分が開くので、内容を見てから許可・拒否
4. 複数の作業を同時に進めたいときは **タスク**から「新しいタスク」

主な設定:

| 設定 | 既定 | 説明 |
| --- | --- | --- |
| `nimbus.claudeCodeExecutable` | 自動探索 | 使う Claude Code の実行ファイル |
| `nimbus.permissions.autoApproveReadOnly` | false | 読み取り専用ツールを確認なしで許可 |
| `nimbus.permissions.showDiffBeforeApproval` | true | 承認の前に差分を開く |
| `nimbus.tasks.maxConcurrent` | 2 | 同時に走らせるタスクの上限 |

**表示言語は日本語が既定です。** 英語で使いたいときは `--locale en` で起動するか、
`argv.json` に `"locale": "en"` を書きます。真っさらな設定フォルダでは、
言語パックの読み込みの都合で**1 回目の起動だけ英語**になります（2 回目から日本語）。

## 拡張機能について

Nimbus は拡張機能を **[Open VSX](https://open-vsx.org/)**（Eclipse Foundation）から取得します。
Microsoft の Visual Studio Marketplace は、利用規約により Microsoft 製品以外での利用が
認められていないためです。Marketplace にしか無い拡張は入りません（VSIX の手動導入は可能です）。

なお Open VSX の拡張は Microsoft の署名を持たないため、署名検証は既定で無効にしてあります。
代わりに Eclipse が管理する「無効化すべき拡張」のリストを参照しています。

## リモートで使う（SSH 先・コンテナの中）

**リモート拡張ホストでの動作は確認済みです**（2026-08-13 / 確認記録
[remote-dev-verification](nimbus/docs/testing/remote-dev-verification.md)）。
サーバー版を起動してブラウザから繋ぎ、**Nimbus のサイドバーがすべて出て、
スキルと CLAUDE.md が繋いだ先のファイルから読めている**ところまで見ています。
**SSH 越しの接続そのものは未確認**です（SSH は経路が違うだけで、拡張ホストは同じものです）。

Nimbus は Code - OSS のリモート拡張ホストをそのまま持っているので、土台はあります。
ただし Microsoft の Remote-SSH / Dev Containers は**利用規約によりフォークでは使えません**。
[Open VSX](https://open-vsx.org/) にある OSS のリモート拡張を入れる形になります。
**どれを使うかは書きません** — Nimbus が特定の拡張を薦めると、その拡張のメンテ状況を
Nimbus が背負うことになるためです。

繋いだときに知っておくべきことが 1 つあります。

> **Nimbus の拡張はリモート側で動きます。**

これは狙いどおりです（Claude Code はコードのある側で走ってほしいので）。
その結果、次のものは**すべて繋いだ先のもの**が使われます。

- Claude Code の実行ファイル — **手元に入れても使われません**
- 認証（`~/.claude`）
- ターミナル・テスト・git

見つからないときは、Nimbus が「繋いだ先に入れてください」と言い分けます。
設定 `nimbus.claudeCodeExecutable` にパスを書く場合も、**リモート側のパス**を指定してください。

### Claude が動かないとき

**「制限モード（Restricted Mode）」を疑ってください。** 開いたフォルダは初回に信頼を聞かれ、
答えるまで制限モードのままです。制限モードでは Nimbus は**画面は開きますが Claude を実行しません**
（フォルダの中でコマンドを実行しファイルを書き換えるため）。

送信しようとすると理由と「このフォルダを信頼する」ボタンが出るので、そこから信頼できます。
画面下の「制限モード」からでも同じです。

> 以前は制限モードだと**アクティビティバーからアイコンごと消えて**いました
> （`untrustedWorkspaces.supported: false` だったため）。「フォルダを開いたら Nimbus が無くなった」
> という報告を受けて、消えない形に変えています。

## 出自とライセンス

- ベース: **Code - OSS**（<https://github.com/microsoft/vscode>）— MIT License,
  Copyright (c) 2015 - present Microsoft Corporation。ライセンス全文は [`LICENSE.txt`](LICENSE.txt)、
  同梱物の告知は [`ThirdPartyNotices.txt`](ThirdPartyNotices.txt) にあります
- ベースにしたブランチ: **`release/1.132`**
- Nimbus 側の変更も MIT で提供します
- **「Visual Studio Code」「VS Code」の名称・ロゴ・アイコンは使用していません。** アイコンは
  [`nimbus/branding/make-icon.mjs`](nimbus/branding/make-icon.mjs) で生成した独自の意匠です
- GitHub Copilot は同梱していません（Code - OSS には同梱されていますが、除去しています）

## 開発の原則

1. **コア（`src/vs/**`）への変更は最小限に。** 機能は組み込み拡張 `extensions/nimbus/` として実装する
2. コアに手を入れるときは `// --- Start Nimbus ---` / `// --- End Nimbus ---` で囲み、
   [`nimbus/docs/core-changes.md`](nimbus/docs/core-changes.md) に必ず記録する
3. 身元の差し替えは手編集せず、`nimbus/branding/*.mjs` のスクリプトで再適用できる形にする
4. ベースは開発中の `main` ではなく**リリース系のブランチ／タグ**に載せる
5. やること・やりたいことは [`tasks.md`](tasks.md) に集約する。**このファイルは随時更新する**
6. **機能を実装したら、同じコミットで仕様書を直す**（下記「実装したら仕様書を直す」）
7. **機能を実装したら、テストコードと GUI の確認項目も同じコミットで作る**（下記「実装したらテストも作る」）
8. **既存の機能を壊す修正はしない。** 足すのは自由、既にあるものを変えるのは頼まれたときだけ
   （下記「既存の機能を壊さない」）

upstream への追従は [`nimbus/scripts/sync-upstream.sh`](nimbus/scripts/sync-upstream.sh) を参照。
テストは `node --test "extensions/nimbus/out/test/*.test.js"`。

### タスクは tasks.md にある

やること・やりたいことは、粒度を問わず [`tasks.md`](tasks.md) に集めています。
**このファイルは随時更新します** — 思いついたら Inbox に 1 行足し、着手したら 進行中 へ移し、
終わったら 完了 へ移す。「こんなことをしたい」程度の思いつきも、整える前にそのまま書いてよい場所です。

作業を始める前に `tasks.md` を読み、終わったら必ず状態を反映してください。
ここが最新でないと、次に作業する人（あるいは別の AI）は同じことを二度やることになります。

### 既存の機能を壊さない

**動いているものを壊す修正は、原則として行いません。** Nimbus は「足していく」開発であって、
「作り直す」開発ではありません。F1〜F6 で入れた機能、テーマ、IntelliJ IDEA 由来で足していく
IDE 基礎機能（スクラッチファイルなど）— これらの振る舞いを、頼まれてもいないのに変えないこと。

- **足すのは自由。既にあるものの改変・削除は、明示的に頼まれたときだけ。**
  「ついでに直しました」「こちらの方が綺麗なので」は理由になりません
- 共有モジュール（`sanitizer.ts` / `permissions.ts` / `core/*`）の**既存の関数シグネチャや
  `export` を変えない**。足すのは可。変えるなら呼び出し元をすべて直し、既存テストを全部通す
- コア（`src/vs/**`）は `// --- Start Nimbus ---` ブロックの中だけ。upstream の行は書き換えない
- 手を入れる前に既存テストを走らせて **Before の結果を控え、After で同じだけ通ることを確認する**
- 既存の振る舞いを変えるべきだと思ったら、**黙って変えずに提案する**。変えると決まったら、
  仕様書・確認項目・`tasks.md` を同じコミットで揃える
- 消す判断をしたら、理由を `tasks.md` の「保留・やらないと決めたこと」に 1 行残す

複数の AI が並行で触るので、「壊れていないのに直す」は他のセッションの前提を崩します。
リファクタしたくなったら、それ自体を `tasks.md` のタスクとして立て、合意してから着手してください。

### 実装したら仕様書を直す

**機能を足した／振る舞いを変えたら、実装と同じコミットで仕様書を直します。**
コードだけ進んでドキュメントが取り残されると、次のセッションが古い記述を「正しい仕様」として
作業を始めてしまう。並行開発では、ここが最初に壊れます。

実装のたびに見直すもの:

1. [`nimbus/docs/specs/`](nimbus/docs/specs/) の `<機能名>.md` — その機能の仕様（無ければ新しく作る）
2. [`nimbus/docs/core-changes.md`](nimbus/docs/core-changes.md) — コア（`src/vs/**`）に触ったときは必ず
3. `nimbus/docs/testing/` — 受け入れ条件と、それをどう確認したかの記録
4. この README の「できること」と設定の表 — 利用者から見た振る舞いが変わったとき
5. [`tasks.md`](tasks.md) — 該当タスクを 完了 へ移す。残った宿題は新しい行として Inbox に足す

「あとでまとめて書く」は成立しません（まとめて書くまでの間に、他のセッションが古い前提で動き出す）。

### 実装したらテストも作る

**機能を足したら、テストコードと GUI の確認項目を、実装と同じコミットで用意します。**
「動いたから完了」は完了ではありません。あとで誰か（別の AI かもしれません）が壊したときに
気づける形を残して、はじめて完了です。

1. **テストコード** — `extensions/nimbus/src/test/` に足し、
   `node --test "extensions/nimbus/out/test/*.test.js"` で回る状態にする。
   VS Code API に依存しないロジックは `extensions/nimbus/src/core/` に切り出せば単体で検証できます
   （`core/claudeMd.ts` などが既にその形です）
2. **GUI の確認項目** — 画面を触らないと確かめられないものは、
   `nimbus/docs/testing/<機能名>.md` にチェックリストとして書く。**実施前でも項目は先に書く**
   （未実施は `- [ ]` のまま残す。何を確認すべきかが残っていれば、後から誰でも実施できます）
3. **仕様書の受け入れ条件と 1 対 1 で対応させる** — 受け入れ条件 1 つに、テストか確認項目が 1 つ。
   対応が付かない受け入れ条件は、そもそも確かめようのない書き方になっています
4. **パッケージ版でも確かめる** — `.app` にしないと出ない不具合があります
   （`nimbus/branding/smoke-packaged.sh`）

書けなかったときは、**なぜ書けなかったかを [`tasks.md`](tasks.md) に 1 行残す**（環境が無い、
API が用意されていない、など）。黙って飛ばすと「テスト済み」と区別が付かなくなります。

### 複数の AI で並行開発する

このリポジトリは、**複数の AI セッション（Claude Code など）が同じ作業ブランチ `nimbus` を
同時に触る**前提で運用しています。ひとりが順番に書く前提の作法では壊れるので、次を守ってください。

**作業を分ける**

- 機能は原則 `extensions/nimbus/src/<機能>/` の中で完結させる。ファイルが分かれていれば衝突しない
- コアは `// --- Start Nimbus ---` ブロックだけを触り、`nimbus/docs/core-changes.md` に**追記**する
- 長い作業や実験は git worktree を切る（`git worktree add ../nimbus-<topic> nimbus`）。
  同じチェックアウトで 2 つのセッションが同時にビルドすると `out/` を奪い合います

**始めかたと終わりかた**

1. `git status` を見る。**汚れていたら他のセッションが作業中**かもしれない。
   他人の未コミット変更を `git stash` / `git checkout --` / `git reset --hard` で消してはいけない
2. `tasks.md` の該当行を 進行中 へ移し、担当と日付を書いてから着手する（これが唯一の「札」です）
3. コミットは小さく、1 コミット = 1 つの意図。終わったらすぐ
   `git pull --rebase origin nimbus` → `git push`。
   **コミットは `git commit -- <パス>` のパス指定で行う。** index はセッション間で共有されるので、
   `git add` 済みの他人の変更を自分のコミットに巻き込んでしまいます
   （巻き込んだら、push 前なら `git reset --soft HEAD~1` で戻せます）
4. ローカルに溜め込まない。溜め込むほど競合は解けなくなります

**衝突しやすい場所と、その直しかた**

| 場所 | 直しかた |
| --- | --- |
| `product.json` | 手で直さない。`node nimbus/branding/apply-product-json.mjs` で当て直す |
| `nimbus/branding/out/` などの生成物 | 手で直さない。`node nimbus/branding/make-icon.mjs` で作り直す |
| `package-lock.json` | 片方を採用し、`npm install` で作り直す |
| `extensions/nimbus/package.json` の `contributes` | **両方の追加を残す。** 相手の commands / views / themes を消さない |
| `nimbus/docs/core-changes.md` | **両方の記録を残す。** 追従マージのための台帳なので、消すと後で詰む |
| `tasks.md` | **両方の行を残す。** ID が重複したら、後からコミットする側が採番し直す |
| 実装コード | 相手の意図を読んでから統合する。片方を捨てるなら、捨てた理由を `tasks.md` の「保留」に 1 行残す |

**解決の手順**

```bash
git pull --rebase origin nimbus   # まず rebase で取り込む
git status                        # 衝突したファイルを確認する

# 生成物は作り直す。台帳・contributes・tasks.md は「両方残す」で解決する
git add <解決したファイル>
git rebase --continue

npm run compile                                      # 型とビルドを確認
node --test "extensions/nimbus/out/test/*.test.js"   # Nimbus 側のテスト
```

どちらが正しいか判断できない衝突は、**推測で片方を捨てず `git rebase --abort` して人間に聞く。**
消えた作業は git からも復元できないことがあります。
