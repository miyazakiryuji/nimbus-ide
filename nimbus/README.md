# Nimbus — Code - OSS フォーク

このディレクトリは **Nimbus 固有の追加物**だけを置く場所です。upstream（`microsoft/vscode`）には存在しないため、
定期的な追従マージでコンフリクトしません。

```
nimbus/
├── README.md              # このファイル
├── branding/              # 身元の差し替え（product.json・アイコン）
│   ├── apply-product-json.mjs
│   └── make-icon.mjs
└── docs/
    └── core-changes.md    # upstream のファイルに入れた変更の一覧（必ずここに記録する）
```

## Nimbus とは

Claude Code のエージェントを操縦するためのコックピットを、VS Code（Code - OSS）の上に構築したものです。
エディタ・ファイルツリー・SCM・拡張機能といった IDE の土台は Code - OSS のものをそのまま使い、
Nimbus は「セッション」「承認」「並列タスク」「コスト可視化」に集中します。

## 出自とライセンス

- ベース: [Code - OSS](https://github.com/microsoft/vscode)（MIT License, Copyright (c) 2015 - present Microsoft Corporation）
- ベースにしたタグ: **1.132.0**
- Nimbus は Microsoft とは無関係の独立プロジェクトです。Microsoft の承認・後援を受けていません
- 「Visual Studio Code」「VS Code」の名称・ロゴ・アイコンは使用していません（アイコンは `nimbus/branding/make-icon.mjs` で生成した独自のもの）
- 拡張機能は **Open VSX**（Eclipse Foundation）から取得します。Microsoft Marketplace は利用規約により
  フォークでの利用が認められていないためです

## 開発の原則

1. **コア（`src/vs/**`）への変更は最小限に。** 機能は組み込み拡張（`extensions/nimbus/`）として実装する
2. コアに手を入れるときは必ず `// --- Start Nimbus ---` / `// --- End Nimbus ---` で囲み、
   `nimbus/docs/core-changes.md` に記録する（追従マージのたびに読み返す台帳になる）
3. ベースは開発中の `main` ではなく**リリースタグ**に載せる

## ビルド

```bash
# Node は .nvmrc（24.18.0）に合わせる
npm install
npm run compile          # もしくは npm run watch
./scripts/code.sh        # 開発ビルドを起動

node nimbus/branding/apply-product-json.mjs   # 追従マージ後に身元を当て直す
node nimbus/branding/make-icon.mjs            # アイコンを作り直す（out/ に生成）
```
