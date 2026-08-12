# 品質コマンド（ドクター・テスト）

## 何を解決するのか

機能は増えるのに、不要ファイル・置き去りの宣言・古くなった記述は誰も気づかないまま溜まる。
並行開発だとなおさらで、**古い記述を正しい仕様だと思って次のセッションが動き出す**のがいちばん怖い。
機械で言えることは機械に言わせ、人は判断だけをする。

## 振る舞い

### ドクター

```bash
node nimbus/scripts/doctor.mjs [検査名...] [--json]
```

見る範囲は `extensions/nimbus/` と `nimbus/` のみ（upstream まで見ると指摘が埋もれる）。
検査は 7 つ。`error`（要対応）が 1 件でもあれば終了コード 1。

| 検査 | 内容 |
| --- | --- |
| `orphans` | 入口（`extension.ts` / テスト / esbuild entryPoints）から辿れない `.ts` |
| `deps` | 宣言されているのに import されていない依存 |
| `contributes` | package.json の宣言 ⇄ 実装（コマンド・ビュー・設定・メニュー参照） |
| `assets` | 参照されていない `media/` `resources/` `themes/` |
| `artifacts` | git に入り込んだ `out/` `dist/` `.tsbuildinfo` `.DS_Store` |
| `ledger` | upstream のファイルへの変更 ⇄ `core-changes.md` の台帳 |
| `docs` | README・ゆあのガイド・docs が触れる設定名とリンクの実在 |

`ledger` の基点は `core-changes.md` の `<!-- nimbus:base <sha> -->` を正とする。
`merge-base` で求めると upstream 自身のコミットまで我々の変更に混ざる（実測）。
**新規追加したファイルは台帳不要**。台帳が要るのは upstream のファイルを変更・削除したときだけ。

### テスト

```bash
bash nimbus/scripts/test.sh            # モジュールテスト＋ドクター
bash nimbus/scripts/test.sh unit|doctor|gui|all
bash nimbus/scripts/test.sh gui --with-claude
```

- **モジュールテスト**: `extensions/nimbus/src/test/*.test.ts` を `node --test` で実行。VS Code は起動しない
- **GUI テスト**: `nimbus/tests/gui/` の Playwright ハーネスが Electron ごと起動し、
  使い捨てのプロファイルとワークスペースで操作する。ケースは `cases/*.mjs` に 1 ファイル 1 件
- **GUI は既定に含めない**。ウィンドウが前面に出て利用者の作業を邪魔するため、明示したときだけ走る
- 実セッション（課金あり）は `--with-claude` を付けたときだけ

## 設計

- `nimbus/scripts/doctor.mjs` — 依存なし。git は `execFile` で直接呼ぶ
- `nimbus/scripts/test.sh` — 入口。必要なときだけコンパイルしてから走らせる
- `nimbus/tests/gui/run.mjs` — 起動・ケース読み込み・スクリーンショット・後片付け
- `nimbus/tests/gui/cases/*.mjs` — `export default { name, run(page, ctx) }`
- スキル: `.agents/skills/nimbus-doctor` `spec-drift` `nimbus-test`（`.claude/skills` はここへのリンク）

`NODE_OPTIONS` は必ず外して起動する。子の Node プロセスが引き継ぐと、
Electron がウィンドウを出さないまま無言で止まる（実測）。

## 受け入れ条件

- [x] ドクターが 7 検査を実行し、要対応 0 件で終了コード 0 を返す
- [x] ドクターが実在するズレを検出できる（初回実行で台帳の記載漏れ 5 件を検出し、追記して解消）
- [x] 誤検出を見つけたらドクター側を直す（upstream のコミットを我々の変更と誤認 → 基点を明示して解消）
- [x] `test.sh unit` がモジュールテストを実行する
- [x] `run.mjs --list` が起動せずにケース一覧を出す
- [ ] `test.sh gui` が実際に GUI を操作して通る（**未実施** — 利用者の作業を邪魔しないため保留）

## 決めなかったこと・やらないこと

- **未使用の export の検出はしない** — 誤検出が多く、消してよいかは人が読まないと決められない。
  「たぶん不要」を並べると、要対応の指摘まで読まれなくなる
- **upstream（`src/vs`）は検査しない** — 我々が保守する対象ではない
- **ドクターを製品機能にしない** — これはリポジトリの保守道具であって、利用者のプロジェクトに
  効くものではない（言語ごとの前提が違いすぎる）
