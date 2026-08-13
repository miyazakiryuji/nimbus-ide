# ブックマーク（ニーモニック付き）

## 何を解決するのか

大きなコードベースで「さっき見ていたあの行」に戻れない。VS Code に行ブックマークの標準機能が無く、
`Cmd+P` の履歴は開いたファイル単位なので、**ファイルの中のどこか**までは覚えていてくれない。
IntelliJ IDEA のブックマークと同じく、行に印を付けて一発で戻れるようにする。

## 振る舞い

### コマンド

| コマンド | ID | キー |
|---|---|---|
| Toggle Bookmark | `nimbus.bookmarks.toggle` | `Cmd+Alt+Shift+B` |
| Toggle Bookmark with Mnemonic... | `nimbus.bookmarks.toggleWithMnemonic` | — |
| Go to Bookmark... | `nimbus.bookmarks.goTo` | — |
| Go to Bookmark by Mnemonic | `nimbus.bookmarks.goToMnemonic` | — |
| Clear All Bookmarks | `nimbus.bookmarks.clearAll` | — |

### ニーモニック

`0`〜`9` と `A`〜`Z` の 36 個。**1 つのニーモニックは 1 か所だけを指す**ので、
既に使われているキーを別の行に付けると、元の行からは外れる（複製しない）。
外れた行はニーモニック無しのブックマークとして残る。

ニーモニックのピッカーは全 36 個を出し、使用中のものには「どこで使われているか」を、
空いているものには「Free」を出す。次に空いているキーには「(suggested)」が付く。

### キー 1 つでジャンプする

`nimbus.bookmarks.goToMnemonic` は**引数でニーモニックを受け取る**ので、
利用者が好きなキーに割り当てられる。36 個ぶんの既定キーバインドを勝手に占有しないための設計。

```json
{ "key": "ctrl+1", "command": "nimbus.bookmarks.goToMnemonic", "args": "1" }
```

引数無しで呼ぶと、割り当て済みのニーモニックだけを並べたピッカーが出る。

### ガターの見た目

- ニーモニック無し — 塗りつぶした丸
- ニーモニック有り — **そのキーの文字**（それが割り当ての意味なので、隠さず出す）

エディタごとのコントリビューションとして描くので、分割ビューでもそれぞれに出る。
色はテーマ変数から取る。

### 保存

`StorageScope.WORKSPACE` に JSON で保存する（キー `nimbus.bookmarks`）。
**このプロジェクトの行を指しているので、別のワークスペースへは持ち出さない**（持ち出しても死んだリンクになる）。

### エラー・境界

- テキストエディタにフォーカスが無いとき、トグル系は何もしない
- ブックマークが 0 件のとき Go to Bookmark は追加を促す通知を出す
- 保存後にファイルが縮んで行が消えていたら、その印は描画しない（データは残す）
- 壊れた保存データは読める分だけ残す。ニーモニックが重複していたら**先勝ちで後を降格**させ、
  「1 キー 1 か所」の規則を必ず保つ
- Clear All は件数付きの確認ダイアログを出す

## 設計

| ファイル | 役割 |
|---|---|
| `contrib/bookmarks/common/bookmarks.ts` | 型・36 個のニーモニック・純粋関数（`toggleBookmark` / `assignMnemonic` / `nextFreeMnemonic` / `isValidMnemonic` / `sortBookmarks` / `parseBookmarks`） |
| `contrib/bookmarks/browser/bookmarksService.ts` | ワークスペースストレージへの永続化と変更通知 |
| `contrib/bookmarks/browser/bookmarks.contribution.ts` | ガター描画（エディタコントリビューション）と 5 コマンド |
| `contrib/bookmarks/browser/media/bookmarks.css` | ガターの字形（36 個ぶんのルール） |
| `contrib/bookmarks/test/common/bookmarks.test.ts` | 純粋関数のテスト（9 件） |

すべて `src/vs/sessions/` 配下。起動経路は `sessions.common.main.ts` の `// Bookmarks` セクション。

状態遷移（トグル・付け替え・降格）はすべて純粋関数なので、モック無しでテストできる。

## 受け入れ条件

- [ ] 画面確認: `Cmd+Alt+Shift+B` でガターに丸が出て、もう一度で消える
- [ ] 画面確認: Toggle Bookmark with Mnemonic で `1` を選ぶとガターに `1` が出る
- [x] 別の行に同じ `1` を付けると、元の行の `1` が消えて丸になる — `a mnemonic points at exactly one place, so reusing it moves it` / `upgrades a plain bookmark in place and upper-cases the key` （`bookmarks.test.ts`）
- [ ] 画面確認: `goToMnemonic` にキーを割り当てると、1 打鍵でその行へ飛ぶ
- [x] 一覧がファイル順・行順 — `groups by file then by line` （`bookmarks.test.ts`）。※`[1]` の見せかたは画面確認
- [ ] 画面確認: 分割ビューの両側にガターの印が出る
- [x] 保存した形で往復でき、壊れた項目は捨てる（＝再起動しても残る） — `round-trips through storage` / `drops malformed entries and demotes a duplicated mnemonic` （`bookmarks.test.ts`）。※実際の再起動は画面確認
- [ ] 画面確認: 別のワークスペースを開くと出てこない
- [ ] 画面確認: Clear All が件数付きで確認を出し、キャンセルすると消えない
- [ ] 画面確認: Nimbus Dark / Light の両方でガターの字が読める

確認記録は `../testing/bookmarks.md`。

## 決めなかったこと・やらないこと

- **専用のサイドバービューは作らない** — 一覧はピッカーで足りる。ビューを足すとアクティビティバーが混む
- **編集に追従して行番号を動かさない** — 追従には行内容の追跡が要る。
  今は保存時の行番号を持ち、消えた行の印は描かないだけに留める
- **36 個ぶんの既定キーバインドは登録しない** — 他の機能のキーを奪う。
  引数付きコマンドにして割り当ては利用者に委ねた
- **ブックマークへのメモ付けは入れない** — 行の内容をプレビューとして持つので、まずはそれで足りる
