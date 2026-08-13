# 構造検索・置換（SSR）

## 何を解決するのか

`foo(...)` の呼び出しを全部書き換えたいだけなのに、正規表現では書けない。
`foo\((.*)\)` は `foo(bar(1, 2))` の最初の `)` で止まるし、文字列やコメントの中の
`foo(1)` にも当たってしまう。**入れ子を数えられない**のが正規表現の限界。
IntelliJ IDEA の構造検索と同じ `$name$` 記法で、コードの形で探せるようにする。

## 振る舞い

### コマンド

| コマンド | ID |
|---|---|
| Structural Search... | `nimbus.structuralSearch.find` |
| Structural Replace... | `nimbus.structuralSearch.replace` |

どちらも**アクティブなエディタ 1 ファイル**が対象。

### パターンの書きかた

普通のコードの中に `$name$` を置く。`$name$` は**釣り合いの取れたコード 1 かたまり**に当たる。

```
foo($x$)              → foo(bar(1, 2)) 全体に当たる（x = "bar(1, 2)"）
$a$ + $a$             → x + x に当たる。x + y には当たらない（同じ名前は同じコード）
if ($c$)              → if(ready) にも if  (  ready  ) にも当たる
```

- `$$` はドル記号そのもの
- `$` が対になっていないパターンは**黙って literal 扱いにせず警告する**（打ち間違いを見逃さない）

### 何に当たらないか

**文字列とコメントの中は構造として扱わない。**

```
const m = "foo(1)";   → 当たらない
// foo(1)             → 当たらない
# foo(1)              → 当たらない
/* foo(1) */          → 当たらない
```

**空白は緩いが、単語は割らない。** `if ($c$)` は `if(ready)` にも当たるが、
`i f (ready)` には当たらない。

### 検索

一致箇所の一覧が出る。各行に「その行の内容 / 行番号 / 束縛された値（`$x$ = bar(1, 2)`）」。
選ぶとその範囲を選択してジャンプする。

### 置換

パターン → 置換テンプレートの順に入力する。テンプレートでは同じ `$name$` を参照でき、
**何度でも使える**（`[$x$, $x$]` のように複製もできる）。
テンプレートに無い名前を書いた場合は**空にせず `$name$` のまま残す** — 打ち間違いが
プレビューで目に見えるようにするため。

適用前に確認ダイアログが出る。件数と、**1 件目の置換前後を実物で**見せる
（構造置換はパターンから受ける印象より広い範囲を書き換えることがあるため）。

全件を 1 回の編集として適用するので、**Undo 一回で全部戻る**。

### 上限・境界

- 1 ファイルあたり 500 件で打ち切る
- エディタが開いていないときは案内を出す
- 一致 0 件のときはパターンを添えて知らせる（パターン不正と区別できるように）

## 設計

| ファイル | 役割 |
|---|---|
| `contrib/structuralSearch/common/structuralSearch.ts` | パターン解析、コードの帯域分類（コード／文字列／コメント＋括弧の深さ）、マッチング、置換 |
| `contrib/structuralSearch/browser/structuralSearch.contribution.ts` | 2 コマンド、一覧、確認、編集の適用 |
| `contrib/structuralSearch/test/common/structuralSearch.test.ts` | マッチャのテスト（9 件） |

**言語ごとのパーサは持たない。** 代わりに、`//` と `#` の行コメント、ブロックコメント、
`'` `"` `` ` `` の文字列を理解する 1 本のスキャナで全ファイルを扱う。
C 系言語と主要なスクリプト言語を 1 つの実装でカバーするための割り切り。

スキャナは文書ごとに 1 回だけ走らせ（O(n)）、各文字が「コード／文字列／コメント」の
どれかと、その位置の括弧の深さを覚える。プレースホルダは
**深さが元に戻り、かつコード上にある位置でしか終われない** — これが入れ子を数える仕組み。

## 受け入れ条件

- [x] `foo($x$)` が `foo(bar(1, 2))` 全体に当たる — `a placeholder takes a whole balanced expression, not up to the first bracket` （`structuralSearch.test.ts`）
- [x] 文字列・コメントの中には当たらない — `never matches structure that only exists inside a string or a comment` （`structuralSearch.test.ts`）
- [x] `$a$ + $a$` が `x + x` に当たり `x + y` に当たらない — `the same placeholder twice means the same code twice` （`structuralSearch.test.ts`）
- [x] `if ($c$)` が空白の違いを超えて当たる — `formatting differences do not break a match, but words are not split` （`structuralSearch.test.ts`）
- [x] `i f (ready)` には当たらない（語は割らない） — 同上 （`structuralSearch.test.ts`）
- [ ] 画面確認: 一覧から選ぶとその範囲が選択される
- [ ] 画面確認: 置換の確認に 1 件目の置換前後が出る
- [ ] 画面確認: 置換後、Undo 一回で全部戻る
- [x] 不正なパターンは推測せず何も見つけない — `a malformed pattern finds nothing rather than guessing` （`structuralSearch.test.ts`）。※警告の見せかたは画面確認

確認記録は `../testing/structural-search.md`。

## 決めなかったこと・やらないこと

- **ワークスペース全体の検索は今は入れない** — 全ファイルを読むので、
  パターンの literal 部分でテキスト検索して絞ってから構造検証する段取りが要る。
  まず 1 ファイルで使い勝手を確かめてから足す
- **言語ごとの AST は使わない** — 言語の数だけパーサが要る。
  入れ子と文字列・コメントを正しく扱えれば、日々の書き換えの大半は足りる
- **型や継承による絞り込み（IntelliJ のスクリプト制約）は入れない** — 型情報が要る。
  LSP をエージェントのツールにする T-098 が入ったら再検討する
- **正規表現との併用は入れない** — 記法が二重になって読めなくなる
