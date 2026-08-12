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

1. フォルダを開く（**信頼していないフォルダでは Nimbus は動きません**。Claude を実行する以上、
   意図的にそうしています）
2. アクティビティバーの雲アイコン → **コックピット**に指示を書いて Enter
3. Claude がファイルを書き換えようとすると差分が開くので、内容を見てから許可・拒否
4. 複数の作業を同時に進めたいときは **タスク**から「新しいタスク」

主な設定:

| 設定 | 既定 | 説明 |
| --- | --- | --- |
| `nimbus.claudeCodeExecutable` | 自動探索 | 使う Claude Code の実行ファイル |
| `nimbus.permissions.autoApproveReadOnly` | false | 読み取り専用ツールを確認なしで許可 |
| `nimbus.permissions.showDiffBeforeApproval` | true | 承認の前に差分を開く |
| `nimbus.tasks.maxConcurrent` | 2 | 同時に走らせるタスクの上限 |

## 拡張機能について

Nimbus は拡張機能を **[Open VSX](https://open-vsx.org/)**（Eclipse Foundation）から取得します。
Microsoft の Visual Studio Marketplace は、利用規約により Microsoft 製品以外での利用が
認められていないためです。Marketplace にしか無い拡張は入りません（VSIX の手動導入は可能です）。

なお Open VSX の拡張は Microsoft の署名を持たないため、署名検証は既定で無効にしてあります。
代わりに Eclipse が管理する「無効化すべき拡張」のリストを参照しています。

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

upstream への追従は [`nimbus/scripts/sync-upstream.sh`](nimbus/scripts/sync-upstream.sh) を参照。
テストは `node --test "extensions/nimbus/out/test/*.test.js"`。
