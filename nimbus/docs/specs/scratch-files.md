# スクラッチファイル

## 何を解決するのか

エージェントに投げるプロンプトの下書き、ログの切り貼り、JSON の整形確認 — **どのプロジェクトにも属さない
書き捨てのバッファ**を置く場所が無い。VS Code の Untitled はウィンドウを閉じれば消え、
リポジトリに `tmp.md` を作れば `git status` を汚す。IntelliJ IDEA のスクラッチファイルに相当する、
**プロジェクトの外で永続する作業用バッファ**を用意する。

## 振る舞い

### 置き場所

`<ユーザーデータ>/scratches/` 配下（macOS なら `~/Library/Application Support/Nimbus/User/scratches/`）。
プロジェクトの外なので、**ワークスペースを切り替えても、ウィンドウを閉じても残る**。
リポジトリには一切書き込まないので `git status` は汚れない。

### コマンド

いずれもコマンドパレット（カテゴリ `Scratch`）から。

| コマンド | ID | キーバインド | 動き |
|---|---|---|---|
| New Scratch File... | `nimbus.scratchFiles.new` | `Cmd+Alt+Shift+S` | 言語を選ぶ → 空ファイルを作ってエディタで開く |
| Open Scratch File... | `nimbus.scratchFiles.open` | — | 既存の一覧から選んで開く |
| Delete Scratch File... | `nimbus.scratchFiles.delete` | — | 選んで削除（確認ダイアログあり） |

New / Open は **File メニュー**にも出る（`1_new` / `2_open` グループ）。

### 言語の選択と命名

- 言語ピッカーには、**拡張子を 1 つ以上登録している言語だけ**を名前順で並べる。拡張子が無い言語は
  ファイル名を決められないため除外する。説明欄に既定の拡張子を出し、説明文でも絞り込める
- ファイル名は IntelliJ IDEA と同じ採番 — `scratch.ts` → `scratch_1.ts` → `scratch_2.ts` …
- **削除で空いた番号は詰めて再利用する**（`scratch.ts` と `scratch_2.ts` がある状態なら次は `scratch_1.ts`）
- 拡張子ごとに独立して数える（`scratch.ts` があっても Python の初回は `scratch.py`）
- 言語が拡張子を持たない場合の保険として `.txt` を使う

### 一覧の並びと表示

**更新が新しい順**。同時刻はファイル名順（呼ぶたびに並びが変わらないようにするため）。
スクラッチファイルの名前は意味を持たないので、見分けるための手がかりを添える —
ラベルにファイル名、説明に言語名、詳細に「Modified 3 minutes ago」。

### エラー・境界

- スクラッチファイルが 1 つも無い状態で Open を実行した場合、空の一覧を見せずに **そのまま New に進む**
- Delete は確認ダイアログを出す（`type: 'warning'`）。ごみ箱を経由せず完全に削除するため
- `scratches/` フォルダはファイル作成時に自動で作られる

## 設計

コアに実装する（拡張ではない）。エディタとエディタサービスへの依存があり、
セッションウィンドウのコマンドとして登録する必要があるため。

| ファイル | 役割 |
|---|---|
| `src/vs/sessions/contrib/scratchFiles/common/scratchFiles.ts` | サービス定義と**純粋関数**（`nextScratchName` / `extensionForLanguage` / `sortScratchFiles`） |
| `src/vs/sessions/contrib/scratchFiles/browser/scratchFilesService.ts` | `IFileService` / `ILanguageService` / `IEnvironmentService` を使った実装 |
| `src/vs/sessions/contrib/scratchFiles/browser/scratchFiles.contribution.ts` | 3 つの `Action2`、キーバインド、File メニュー、シングルトン登録 |
| `src/vs/sessions/contrib/scratchFiles/test/common/scratchFiles.test.ts` | 純粋関数のテスト |

起動経路への登録は `src/vs/sessions/sessions.common.main.ts` の `// Scratch Files` セクション。

**採番・拡張子解決・並び替えは純粋関数に切り出してある。** サービス本体はファイル I/O の配線だけを持つので、
ロジックはモックを使わずにテストできる。

### 配色について

独自 CSS は書いていない。ピッカーもダイアログもワークベンチのテーマ変数をそのまま使うので、
Nimbus Dark / Nimbus Light（T-001 の Claude を思わせる配色）に自動的に従う。
**新しい配色を足さないことが、この機能でのデザイン判断**。

## 受け入れ条件

- [ ] `Cmd+Alt+Shift+S` で言語ピッカーが出て、選ぶと空ファイルがエディタで開く
- [ ] 開いたファイルが選んだ言語として色付けされ、補完が効く
- [ ] 同じ言語で 2 回作ると `scratch.ts` → `scratch_1.ts` と採番される
- [ ] 別の言語で作ると `scratch.py` から始まる（`.ts` の番号に影響されない）
- [ ] `scratch_1.ts` を消してもう一度作ると `scratch_1.ts` が再利用される
- [ ] 書いた内容を保存し、**ワークスペースを切り替えて** Open Scratch File で開き直せる
- [ ] 一覧が更新の新しい順で、言語名と「Modified 〜」が出る
- [ ] スクラッチが 0 件のとき Open を実行すると New のピッカーが出る
- [ ] Delete は確認ダイアログを出し、キャンセルすると消えない
- [ ] File メニューに New Scratch File... と Open Scratch File... が出る
- [ ] リポジトリの `git status` が汚れない

確認記録は `../testing/scratch-files.md`。

## 決めなかったこと・やらないこと

- **ツリービュー（IntelliJ の「Scratches and Consoles」）は作らない** — まずコマンドで完結させる。
  一覧の需要が出てから足す。エクスプローラーに 2 つ目のルートを足すのは影響範囲が大きい
- **リネーム機能は入れない** — 名前に意味を持たせない設計にしたので、必要なら普通に保存し直せばよい
- **同期しない** — Settings Sync に載せると書き捨ての気軽さが失われる。端末ローカルに閉じる
- **`Cmd+Alt+Shift+Insert`（IntelliJ 同一）にはしない** — macOS に Insert キーが無い。
  `Cmd+Alt+Shift+S` は既存キーマップと衝突しないことを確認済み
