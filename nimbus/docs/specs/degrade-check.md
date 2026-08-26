# デグレチェック（基準との突き合わせ）

**タスク**: T-335（利用者依頼 2026-08-26） / **実装**: `nimbus/scripts/degrade.mjs` /
**基準**: `nimbus/tests/baseline.json`（コミットされる） /
**テスト**: `nimbus/tests/scripts/degrade.test.mjs`（12 件）

## なぜ

CLAUDE.md は「手を入れる前に Before の結果を控え、After で同じだけ通ることを確認する」と
要求するが、その控えは**各セッションの頭の中にしか無かった**（Herdr 撤去では 1432 → 1423 を
手で数えた）。`regression-guard.mjs` は守りの**存在**を見る道具で、**数が減っていないか**は
誰も見ていなかった。ここがその控え帳になる。

## 使いかた

```bash
bash nimbus/scripts/test.sh degrade              # いつもの確認（ある程度実装したら）
node nimbus/scripts/degrade.mjs check --full     # 総合試験の締め（GUI 全件の通過数まで）
node nimbus/scripts/degrade.mjs check --json     # 機械が読む形式
node nimbus/scripts/degrade.mjs record           # いまを基準にする
```

減りがあれば一覧して **exit 1**。基準が無ければ「先に record」と言って exit 2。

## 測るもの（機械が確実に言えることだけ）

| 測るもの | 減り＝ | 言い分け |
| --- | --- | --- |
| 落ちるモジュールテストの数 | error | 「通過」で比べない — 通っているテストを消しただけでも減って見える（Herdr 撤去が実例）。**落ちる数**と**総数**に分け、各メッセージが 1 つの事実だけを言う |
| テストの総数 | error | テストが消えた ＝ 守りが消えた |
| GUI ケースの目録（ファイル名） | error | 同上 |
| 入口の目録（コマンド・ビュー・設定 ID） | error | 入口が消えると、利用者からは機能ごと消えたに見える |
| `core/*.ts` の export 名 | error | CLAUDE.md「既存の export を変えない（足すのは可）」の機械化。名前の消失だけを見る — シグネチャ差分まで見ると偽の指摘が増える |
| 仕様書の目録 | error | 記録が消えた |
| ドクター要対応の数 | error | 増えたら。減るのは自由 |
| 守りの無い完了の数（regression-guard） | **warn** | 新しい完了の直後は普通に増えるので、止めずに参考 |
| GUI 全件の通過数（`--full` のみ） | error | 両方に記録があるときだけ比べる |

**増えるのは常に自由**（足すのは自由、の数字版）。測れなかったもの（undefined）は比較しない —
無いものを 0 と偽らない。

## 意図した削減の通しかた

消す判断をしたとき（例: Herdr 撤去）は `check` が一度赤を出す。**それでよい。**
変更と同じコミットで `record` し直せば、**基準の diff に削減が残る** —
板の「消す理由を 1 行残す」と同じ運用が、数字の側にも通る。赤を握りつぶして record だけ
進めると、diff レビューでそれが見える（コミットに理由が要る）。

## 設計

- ドクターと同じ形: **純関数を export**（`compareBaseline` / `parseUnitSummary` /
  `parseGuiSummary` / `parseUnguarded` / `exportNames`）し、CLI は
  `import.meta.url === argv[1]` のときだけ走る。テストは直接 import
- 測定は既存の道具を**子プロセスで使い回す**（test.sh unit / doctor --json /
  regression-guard / GUI ランナー）。判定を二重に作らない
- 基準は 1 ファイル・コミットされる ＝ 全セッション共有。並行セッションが同時に record
  したら後勝ちだが、賭けているのは基準の鮮度だけ（コミットの diff で必ず見える）

## 見つかった抜け（作っている最中に）

**doctor.mjs の `--json` がパイプ越しだと途中で切れていた**（39265 文字 → 7424 文字で
「Unterminated string」）。`process.exit()` は書き込み先がパイプだと stdout のフラッシュ前に
死ぬ。`process.exitCode` に替えて直し、パイプ越しに JSON.parse が通ることを
`doctor.test.mjs` の守りにした。ファイルへのリダイレクトでは再現しない（同期 fd）ので、
手で叩いているだけでは見つからない種類の穴。

## 確認すること

- [x] 同じなら黙る・増えるだけなら黙る（両方向を対で・`degrade.test.mjs`）
- [x] 落ちが増えた／総数が減った を分けて言う（同）
- [x] GUI ケース・入口・core export・仕様書の消失で止まる（同）
- [x] 守りの無い完了の増は warn（止めない）（同）
- [x] 測れなかったものを 0 と偽らない（同）
- [x] 実機で record → check 緑 → 基準を偽装すると赤・exit 1 → record で戻る（手で確認済み）
- [x] `--full` は両方に記録があるときだけ比べる（`degrade.test.mjs`）
- [x] doctor --json がパイプ越しで切れない（`doctor.test.mjs`・実バグの守り）

## 決めなかったこと・やらないこと

- **性能（起動時間・応答時間）は測らない。** 揺れで偽の赤が出る。要るなら別の道具
  （`bench-parallel.mjs` の系譜）で
- **シグネチャの差分までは見ない。** 名前の消失だけ。型の書き換えは正当にある
- **自動で record しない。** 基準を進めるのは人（またはコミットする主体）の判断。
  勝手に進むと控え帳の意味が無い
