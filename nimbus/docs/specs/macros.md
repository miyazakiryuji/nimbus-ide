# マクロ（記録・再生）

## 何を解決するのか

「行末にカンマを足して、次の行へ、また足して」のような**手数の多い定型編集**を、毎回手で繰り返している。
エージェントに投げるほどではないが、手でやるには回数が多い。VS Code には標準のマクロ機能が無い。
一度記録すれば名前で呼び出せるようにする。

## 振る舞い

### コマンド

コマンドパレット（カテゴリ `Macro`）から。

| コマンド | ID | 出る条件 |
|---|---|---|
| Start Recording | `nimbus.macros.startRecording` | 記録していないとき |
| Stop Recording and Save... | `nimbus.macros.stopRecording` | 記録中 |
| Cancel Recording | `nimbus.macros.cancelRecording` | 記録中 |
| Play Macro... | `nimbus.macros.play` | 常時 |
| Delete Macro... | `nimbus.macros.delete` | 常時 |

### 記録中であることの提示

**記録はモードであり、入っていることを忘れたモードは罠になる。** そのためステータスバー右に
`$(record) Recording macro (12)` を常時出し、手数がリアルタイムで増える。
このエントリ自体が停止ボタンを兼ねる（クリックで Stop Recording）。
コンテキストキー `nimbusMacroRecording` でコマンドの出し分けも行う。

### 記録される操作・されない操作

`ICommandService.onWillExecuteCommand` を購読し、実行されたコマンドを順に積む。
次のものは**記録しない**。

- `nimbus.macros.` で始まるもの — 再生が自分自身を呼ぶ再帰になる
- `workbench.action.reloadWindow` / `quit` / `closeWindow` — 再生でウィンドウが落ちる
- `workbench.action.showCommands` / `quickOpen` / `quickOpenNavigate*` / `gotoLine` / `openSettings`
  — ピッカーが開いて入力待ちになり、再生がそこで止まる

引数は JSON を往復できるものだけを保存する。エディタインスタンスのような**生のオブジェクトを含む
呼び出しはステップごと捨てる**（間違った値で再生するより、入っていない方が安全）。
捨てた数は保存時に通知で伝える。

### 保存と命名

`StorageScope.PROFILE` / `StorageTarget.USER` に JSON で保存する（キー `nimbus.macros`）。
名前が衝突したら ` (2)` ` (3)` と連番を付けて**両方残す**（黙って上書きしない）。
名前の入力をキャンセルしても記録は続いたままなので、取り消しにはならない。

### 再生

`Play Macro...` で選ぶと、記録した順にコマンドを再実行する。
**再生中は記録を一時停止する**ので、記録しながら再生しても二重に積まれない。

### エラー・境界

- マクロが 1 つも無い状態で Play / Delete を実行すると、記録を促す通知を出す
- 空の名前で保存しようとすると警告を出し、記録は続行する
- 保存データが壊れていても、読める分だけ残す（壊れた 1 件で全滅させない）
- Delete は確認ダイアログを出す

## 設計

| ファイル | 役割 |
|---|---|
| `src/vs/sessions/contrib/macros/common/macros.ts` | サービス定義と純粋関数（`isRecordableCommand` / `serializableArgs` / `uniqueMacroName` / `parseMacros` / `stringifyMacros`） |
| `src/vs/sessions/contrib/macros/browser/macroService.ts` | 記録・保存・再生の実装 |
| `src/vs/sessions/contrib/macros/browser/macros.contribution.ts` | 5 コマンド、ステータスバー表示、コンテキストキー、シングルトン登録 |
| `src/vs/sessions/contrib/macros/test/common/macros.test.ts` | 純粋関数のテスト |

起動経路への登録は `src/vs/sessions/sessions.common.main.ts` の `// Macros` セクション。

判定・整形・命名・永続化の解釈はすべて純粋関数に寄せてあるので、モック無しでテストできる。

### 配色について

独自 CSS は書いていない。ステータスバーは `kind: 'prominent'` を使い、配色はテーマに委ねる。
Nimbus Dark / Light（T-001 の Claude 配色）にそのまま乗る。

## 受け入れ条件

- [ ] 画面確認: Start Recording でステータスバーに `Recording macro (0)` が出る
- [ ] 画面確認: 編集するたびに手数が増える
- [ ] 画面確認: ステータスバーをクリックすると名前の入力が出る
- [ ] 画面確認: 保存したマクロが Play Macro... の一覧に手数付きで出る
- [ ] 画面確認: 再生すると記録どおりの編集が起きる
- [x] 同じ名前で 2 回保存すると ` (2)` が付いて両方残る — `suffixes a counter so saving twice never silently replaces` （`macros.test.ts`）
- [x] 記録中にコマンドパレットを開いても、その操作は記録されない — `records editor work but never recursion, window teardown, or blocking pickers` （`macros.test.ts`）
- [ ] 画面確認: Cancel Recording で破棄され、ステータスバーが消える
- [ ] 画面確認: 名前の入力をキャンセルしても記録が続いている
- [ ] 画面確認: Delete は確認ダイアログを出し、キャンセルすると消えない
- [x] 保存した形で往復できる（＝再起動しても残る） — `round-trips through storage` / `drops malformed entries instead of losing every macro` （`macros.test.ts`）。※実際の再起動は画面確認

確認記録は `../testing/macros.md`。

## 決めなかったこと・やらないこと

- **マクロへのキーバインド割り当ては入れない** — 動的なコマンド登録が要るので、需要が出てから。
  今はコマンドパレットから名前で呼ぶ
- **編集の再生速度・ステップ実行は作らない** — デバッグ用途は想定していない
- **記録した内容の編集画面は作らない** — 撮り直した方が速い
- **引数が再生できない操作を「引数なしで再生」しない** — 違う対象に作用する事故の方が高くつく
