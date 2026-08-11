# Nimbus

**エージェントを操縦するためのコックピット。** Claude Code のセッション・承認・並列タスク・コストを
ひとつの IDE の中で見渡し、操作できるようにすることを目指しています。

> ⚠️ **これは Anthropic 非公式・Microsoft 非公式の独立プロジェクトです。**
> Anthropic からも Microsoft からも承認・後援・提携を受けていません。

## Nimbus とは

エディタ・ファイルツリー・SCM・検索・拡張機能といった IDE の土台は [Code - OSS](https://github.com/microsoft/vscode)
のものをそのまま使い、Nimbus は「**エージェントをどう操縦するか**」に集中します。

- **セッション** — 複数の Claude セッションを同じプロジェクトで並列に回す
- **承認** — エージェントの操作を実行前に握り、許可・拒否を判断する
- **並列タスク** — git worktree でタスクを隔離し、進行をボードで俯瞰する
- **コストと文脈の可視化** — 何にいくら使い、何を文脈に入れているかを常に見える場所に置く

現在の状態: **F1 完了**（フォークが Nimbus として起動する）。機能の実装は F2 から。
計画は [`nimbus/README.md`](nimbus/README.md) と、コア変更の台帳
[`nimbus/docs/core-changes.md`](nimbus/docs/core-changes.md) を参照してください。

## ダウンロードと実行（macOS / Apple Silicon）

> リリースはまだありません（F1 時点）。手元でビルドする手順を書いておきます。
> 配布用の `.dmg` を出すのは F5 です。

### ビルドして動かす

```bash
# 1. 取得
git clone https://github.com/miyazakiryuji/nimbus-ide.git
cd nimbus-ide
git checkout nimbus

# 2. Node を .nvmrc（24.18.0）に合わせる
#    nvm を使う場合: nvm install && nvm use
node --version   # v24.18.0 であること

# 3. 依存を入れる（Xcode Command Line Tools と Python が必要）
npm install

# 4. ビルドして起動
npm run compile
./scripts/code.sh

# 5. 配布形式（.app）にする場合
npm run gulp vscode-darwin-arm64
open ../VSCode-darwin-arm64/Nimbus.app
```

macOS で「開発元を確認できないため開けません」と出た場合は、**右クリック →「開く」**を選んでください
（署名していないビルドのため）。

### 拡張機能について

Nimbus は拡張機能を **[Open VSX](https://open-vsx.org/)**（Eclipse Foundation）から取得します。
Microsoft の Visual Studio Marketplace は、利用規約により Microsoft 製品以外での利用が認められていないためです。
Marketplace にしか無い拡張は入りません（VSIX を手動で入れることは可能です）。

## 出自とライセンス

- ベース: **Code - OSS**（<https://github.com/microsoft/vscode>）— MIT License,
  Copyright (c) 2015 - present Microsoft Corporation。ライセンス全文は [`LICENSE.txt`](LICENSE.txt)、
  同梱物の告知は [`ThirdPartyNotices.txt`](ThirdPartyNotices.txt) にあります
- ベースにしたタグ: **1.132.0**
- Nimbus 側の変更も MIT で提供します
- **「Visual Studio Code」「VS Code」の名称・ロゴ・アイコンは使用していません。** アイコンは
  [`nimbus/branding/make-icon.mjs`](nimbus/branding/make-icon.mjs) で生成した独自の意匠です
- Microsoft がビルドして配布する Visual Studio Code は独占ライセンスの製品であり、本プロジェクトとは別物です

## 開発の原則

1. **コア（`src/vs/**`）への変更は最小限に。** 機能は組み込み拡張 `extensions/nimbus/` として実装する
2. コアに手を入れるときは `// --- Start Nimbus ---` / `// --- End Nimbus ---` で囲み、
   [`nimbus/docs/core-changes.md`](nimbus/docs/core-changes.md) に必ず記録する
3. 身元の差し替えは手編集せず、`nimbus/branding/*.mjs` のスクリプトで再適用できる形にする
4. ベースは開発中の `main` ではなく**リリースタグ**に載せる
