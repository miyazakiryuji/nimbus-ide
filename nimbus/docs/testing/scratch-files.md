# T-033 スクラッチファイル 確認チェックリスト

- 実施日: 2026-08-13
- 対象仕様: [`../specs/scratch-files.md`](../specs/scratch-files.md)
- 制約: 画面確認（§2）とパッケージ版スモーク（§3）は**未実施**。自動テストは全件通っている。
- 補足: シェルの既定 Node は 22.16.0 で、`npm run test-node` は Node 24 を要求して起動を拒否する。
  リポジトリ外の `10_products/.toolchain/node-v24.18.0-darwin-arm64/bin` に Node 24 があるので、
  `PATH` の先頭に足せば回る（`nimbus/scripts/test.sh` はこれを自動で行う）。

## 1. 静的検証・ロジック

| #   | 項目 | 結果 | 確認方法 |
| --- | --- | --- | --- |
| A-1 | `npm run typecheck-client`（`src/` 全体） | OK (0 errors) | 実行済み |
| A-2 | `npm run transpile-client`（7,838 ファイル） | OK | 実行済み |
| A-3 | **リポジトリ全体の単体テスト** | OK (13,177 passing / 0 failing / 191 pending) | `npm run test-node`（Node 24） |
| A-4 | ScratchFiles スイートが実際に実行されている | OK (5 passing) | 同上の出力で確認 |
| A-5 | 採番が `scratch.ts` → `scratch_1.ts` → `scratch_2.ts` → `scratch_3.ts` と進む | OK | 単体テスト |
| A-6 | 削除で空いた番号を再利用する（`scratch.ts`+`scratch_2.ts` → 次は `scratch_1.ts`） | OK | 単体テスト |
| A-7 | `scratch_1.ts` だけがある状態では `scratch.ts` を返す | OK | 単体テスト |
| A-8 | 拡張子ごとに独立して数える（`.ts` が埋まっていても `.py` は `scratch.py`） | OK | 単体テスト |
| A-9 | `extensionForLanguage` が先頭の拡張子を採り、空なら `.txt` に落ちる | OK | 単体テスト |
| A-10 | 並びが「更新の新しい順 → 名前順」になる | OK | 単体テスト |
| A-11 | `sortScratchFiles` が入力配列を破壊しない | OK | 単体テスト |
| A-12 | 50 連続生成しても名前が重複せず末尾が `scratch_49.txt` | OK | トランスパイル済み実コードに対して実行 |
| A-13 | `Cmd+Alt+Shift+S` が既存キーマップと衝突しない | OK | `grep` で `src/vs` 全体を確認（0 件） |

テスト本体は `src/vs/sessions/contrib/scratchFiles/test/common/scratchFiles.test.ts`。
`bash nimbus/scripts/test.sh unit` でも回る（Node 24 の PATH 設定込み）。

## 2. 画面確認（未実施）

Node 24 を入れて `npm run watch-client` → セッションウィンドウを起動して確認する。

| #   | 項目 | 結果 |
| --- | --- | --- |
| B-1 | `Cmd+Alt+Shift+S` で言語ピッカーが出る | 未 |
| B-2 | 言語を選ぶと空ファイルがエディタで開く | 未 |
| B-3 | 選んだ言語として色付けされ、補完が効く | 未 |
| B-4 | 同じ言語で 2 回作ると `scratch.ts` → `scratch_1.ts` になる | 未 |
| B-5 | 内容を保存し、**ワークスペースを切り替えて**から Open で開き直せる | 未 |
| B-6 | 一覧が更新の新しい順で、言語名と「Modified 〜」が出る | 未 |
| B-7 | スクラッチ 0 件で Open すると New のピッカーに進む | 未 |
| B-8 | Delete が確認ダイアログを出し、キャンセルで消えない | 未 |
| B-9 | File メニューに New / Open Scratch File... が出る | 未 |
| B-10 | 実ファイルが `<ユーザーデータ>/User/scratches/` にできる | 未 |
| B-11 | リポジトリの `git status` が汚れない | 未 |
| B-12 | Nimbus Dark / Nimbus Light の両方でピッカーの配色が破綻しない | 未 |

## 3. パッケージ版スモーク（未実施）

`npm run build:mac` 相当でパッケージし、`.app` から起動して B-1 / B-5 / B-10 を再確認する。
