# Search Everywhere

## 何を解決するのか

VS Code は「探す」が入口ごとに割れている — ファイルは `Cmd+P`、コマンドは `Cmd+Shift+P`、
シンボルは `Cmd+T`。**何を探すかを決めてからでないと、どのキーを押すか決められない。**
IntelliJ IDEA の Search Everywhere と同じく、1 枚の入口から全部にあたれるようにする。

## 振る舞い

### 開きかた

- **Shift を 2 回**（IntelliJ と同じ）
- `Cmd+Alt+O`
- コマンドパレットの `Search Everywhere`

Shift 2 回は、キーバインドの仕組みに二度押しの概念が無いので専用に検出している。
**2 回の Shift の間に他のキーが押されたら成立しない**ので、大文字を続けて打っても開かない。
猶予は 400ms。

### 探せるもの

1 回の入力で次を横断し、カテゴリごとに区切って出す。

| カテゴリ | 出どころ | 上限 |
|---|---|---|
| Calculator | 入力が式として読めるとき | 1 |
| Actions | コマンドパレットに出るコマンド（`when` 句を評価済み） | 10 |
| Files | ワークスペースのファイル検索 | 15 |
| Symbols | ワークスペースシンボル | 10 |

**上限を設けているのは、これが一望して選ぶ画面だから。**全件出すと読めなくなる。

### 絞り込み

Quick Open の作法に合わせた接頭辞を使う。

- `>` — アクションだけ
- `#` — シンボルだけ
- 何も付けない — 全部

### 電卓

入力が算術式として読めるときだけ、先頭に結果を出す。Enter でクリップボードにコピー。

- 四則演算・`%`・`^`（右結合で乗除より強い）・括弧・単項マイナス
- 関数 `sqrt` `sin` `cos` `tan` `abs` `ln` `log` `floor` `ceil` `round`
- 定数 `pi` `e`
- 16 進 `0xff` / 2 進 `0b1010` / 8 進 `0o17`

**`eval` は使わず自前で構文解析している** — 入力欄の文字列をそのままワークベンチ内で評価するのは
避けるべきなので。演算子・関数・定数・非 10 進リテラルのいずれも含まない入力（`42` など）は
検索語とみなし、電卓の行を出さない（「42 = 42」は雑音）。
0 除算・未閉じ括弧・未知の関数は結果を出さない。

### エラー・境界

- 入力するたびに前の問い合わせをキャンセルするので、結果が入れ替わらない
- ワークスペースが開かれていなければファイル検索は黙って飛ばす
- 検索が失敗しても一覧を空にするだけで、ピッカーは閉じない

## 設計

| ファイル | 役割 |
|---|---|
| `src/vs/sessions/contrib/searchEverywhere/common/searchEverywhere.ts` | 接頭辞の解釈、カテゴリ判定、上限値、**電卓（字句解析＋再帰下降パーサ）**、数値の整形 |
| `src/vs/sessions/contrib/searchEverywhere/browser/searchEverywhere.contribution.ts` | 各カテゴリの収集、ピッカー、コマンド、Shift 2 回の検出 |
| `src/vs/sessions/contrib/searchEverywhere/test/common/searchEverywhere.test.ts` | 純粋関数のテスト（8 件） |

起動経路への登録は `src/vs/sessions/sessions.common.main.ts` の `// Search Everywhere` セクション。

各カテゴリが自前で絞り込むので、ピッカー側の照合は切ってある（`matchOnLabel = false`）。

### 配色について

独自 CSS は書いていない。ピッカーはテーマ変数に従うので Nimbus Dark / Light（T-001 の Claude 配色）に
そのまま乗る。カテゴリはセパレータで、種別はアイコンで区別する。

## 受け入れ条件

- [ ] 画面確認: Shift 2 回でピッカーが開く（キー入力の受け取りは単体では見られない）
- [ ] 画面確認: 大文字を続けて打っても開かない（`AB` と入力しても出ない）
- [ ] 画面確認: `Cmd+Alt+O` でも開く
- [ ] 何か打つと Actions / Files / Symbols が区切り付きで出る
- [x] `>` を付けるとアクションだけになる — `parseQuery('>')` （`searchEverywhere.test.ts`）
- [x] `#` を付けるとシンボルだけになる — `splits the Quick Open sigils off the search term` （`searchEverywhere.test.ts`）
- [x] `2 + 3 * 4` が `14` になる — `precedence: 14` （`searchEverywhere.test.ts`）。※Enter でコピーされるところは画面確認が要る
- [x] `0xff + 1` が `256` になる — `hexArithmetic: 256` （`searchEverywhere.test.ts`）
- [x] `42` だけでは電卓の行が出ない — `bareInteger` / `treats a bare number or plain text as a search term, not a sum` （`searchEverywhere.test.ts`）
- [ ] 画面確認: ファイルを選ぶとエディタで開く
- [ ] 画面確認: シンボルを選ぶとその位置にジャンプする
- [ ] 画面確認: 素早く打ち替えても古い結果が出ない
- [ ] 画面確認: Nimbus Dark / Light の両方で配色が破綻しない

確認記録は `../testing/search-everywhere.md`。

## 決めなかったこと・やらないこと

- **Tab によるタブ切り替えは作らない** — Quick Pick に Tab を渡す口が無い。
  接頭辞（`>` `#`）で代替している
- **テキスト全文検索は入れない** — 既存の検索ビュー（`Cmd+Shift+F`）の方が結果を読みやすい。
  ここに混ぜると上限に収まらない
- **同義語解決は入れない** — 辞書の維持コストに見合わない。曖昧検索は fuzzy 照合で足りる
- **設定項目の検索は入れない** — 設定は専用の検索が既にあり、二重に持つ価値が薄い
