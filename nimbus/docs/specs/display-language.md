# 表示言語（既定を日本語にする）

## 何を解決するのか

Nimbus は日本語で使う道具として作っているのに、**画面は英語で立ち上がっていた**。
拡張側の文言（`package.nls.json`）は日本語なので、Nimbus のビューだけ日本語で、
コマンドパレット・メニュー・設定画面といったコア側は英語という、ちぐはぐな状態になる。

原因は upstream の既定値そのもの。`src/main.ts` の `getUserDefinedLocale()` は、
`--locale` も `argv.json` の `locale` も無いとき `undefined` を返す。
すると `resolveNLSConfiguration()` が**呼ばれず**、英語のまま起動する。
OS が日本語でも変わらない。

## 振る舞い

- 何も指定しなければ**日本語**で起動する
- `--locale en` や `argv.json` の `"locale": "en"` は今までどおり優先される（変えたい人は変えられる）
- 日本語の文言そのものは、同梱の言語パック **`MS-CEINTL.vscode-language-pack-ja`** が持つ
- 言語パックが無い環境では upstream どおり英語に落ちる。**壊れない**

### 真っさらな設定で初回だけ英語になる

言語パックの所在は、利用者データの `languagepacks.json` を見て解決する。
このファイルは**拡張を走査したあとに書かれる**ので、真っさらな設定フォルダでの
**1 回目の起動だけ英語**になり、2 回目から日本語になる。

これは言語パックを入れたときの upstream の挙動そのもので、Nimbus 固有の不具合ではない。
1 回目から日本語にするには翻訳をアプリ本体に焼き込む必要があり、
そのための翻訳パイプライン（XLF）を持ち込むことになるので、いまはしない。

## 設計

| 変更 | 場所 |
| --- | --- |
| 指定が無いときの既定を `ja` に | `src/main.ts` の `getUserDefinedLocale()`（Nimbus ブロック） |
| 言語パックの同梱 | `product.json` の `builtInExtensions` |

コア変更は台帳 [core-changes](../core-changes.md) に記載。再適用は
`nimbus/branding/apply-core-changes.mjs`、ハッシュの固定は
`nimbus/branding/sync-builtin-extension-hashes.mjs` が行う。

言語パックも他の同梱拡張と同じく **Open VSX から取得し、VSIX の中身で
publisher / name / version を確かめてからハッシュを固定する**。

## 受け入れ条件

- [x] 素の設定で起動すると、コア側の画面も日本語になる（GUI ケース `38-display-language.mjs`）
- [x] `--locale en` を渡すと英語のままになる（同上）
- [x] 言語パックがパッケージに同梱される（同上）

## 決めなかったこと・やらないこと

- **翻訳をアプリ本体に焼き込まない。** 初回だけ英語になるのを消せるが、
  XLF の翻訳パイプラインを抱えることになる。追従のたびに翻訳の面倒を見る負担のほうが大きい
- **英語版を別に出さない。** `--locale en` で足りる
