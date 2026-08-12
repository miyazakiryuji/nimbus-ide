# 型定義の自動添付（T-175）

「`SessionManager.createSession` を直して」と書いたとき、エージェントはまず**その関数を探す**
ところから始める。grep して、ファイルを読んで、やっと本題に入る。見つからなければ
「たぶんこういう引数だろう」と推測して書く — 存在しない API を呼ぶ事故はここで起きる。

フォークの中では言語サーバーが答えを持っている。**送る前に実物を添えてしまえばいい。**
[verify-edits](verify-edits.md)（T-101）が「書いたあとに間違いを見つける」なら、こちらは
「書く前に正解を渡す」側。

## 振る舞い

1. コックピットに指示を書いて送る
2. Nimbus が指示の中の「シンボルらしい名前」を拾う
3. ワークスペース検索で場所を引き、hover でシグネチャを取る
4. 見出しつきで指示の末尾に添えて送る

```
（Nimbus が添付した実際のシグネチャ。推測せずこちらを使ってください）
- SessionManager.createSession — extensions/nimbus/src/session/SessionManager.ts:90
  async createSession(input: CreateSessionInput): Promise<string>
```

添付はコックピットの発言としてそのまま見える。**何が文脈に入ったかを説明できない状態にしない。**

## 実装

- `extensions/nimbus/src/core/mentions.ts` — 文から名前を拾い、添付する文を組み立てる（純関数）
- `extensions/nimbus/src/signatureAttachment.ts` — ワークスペース検索と hover
- `extensions/nimbus/src/extension.ts` — `send()` の中、送信前検査（T-075）の直後
- テスト: `extensions/nimbus/src/test/mentions.test.ts`

## 決めたこと

**拾いすぎない。** 関係ない語まで引くと、指示より添付の方が長くなって精度が落ちる。
確からしい順に、バッククォート → `Class.method` → 呼び出しの形（`foo(`）→ PascalCase（山が 2 つ以上）。
`The` / `This` のような語と、`Nimbus` / `Claude` のような固有名は落とす。
`SessionManager.close` を拾ったあとの `SessionManager` は重複として捨てる。既定 5 件まで。

**2.5 秒で諦める。** 添付は「あると嬉しい」もので、これのために送信が詰まるのは本末転倒。
時間切れなら黙って何も足さない。

**hover の 1 行目だけを取る。** 説明文まで入れると長い。要るのは**シグネチャ**。

**添付したことを隠さない。** 見出しを付けて、Nimbus が足したものだと分かる形にする。
黙って指示を書き換えるのは、この製品がいちばん避けたい振る舞い。

## 設定

| 設定 | 既定 | 意味 |
| --- | --- | --- |
| `nimbus.lsp.attachSignatures` | `true` | シグネチャを添える |
| `nimbus.lsp.maxAttachedSignatures` | `5` | 1 回に添える数の上限 |

## 確認すること

- [ ] `` `createSession` を直して `` と送ると、実際のシグネチャが添えられる
- [ ] 添付がコックピットの発言として見える
- [ ] 該当するシンボルが無い名前では何も添えられない
- [ ] 普通の日本語の文だけのときは何も添えられない
- [ ] 言語サーバーが遅いとき、送信が 2.5 秒以上待たされない
- [ ] `nimbus.lsp.attachSignatures` を `false` にすると添付されない
- [ ] フォルダを開いていないときに例外が出ない

## 残っていること

- 同名のシンボルが複数あるとき、ワークスペース検索の 1 件目を採る（どれかは選べない）
- 添付するのは**シグネチャの 1 行**だけ。型の定義そのもの（interface の中身）は渡らない
- ターミナル・テストからの自動投入（T-169 / T-039）にも同じ添付がかかる
