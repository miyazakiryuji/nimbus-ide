# 公証（notarization）

初回起動の「右クリック → 開く」を要らなくする（T-006）。

## 何を解決するのか

いまの配布物は ad-hoc 署名なので、初めて開くときに
「開発元を確認できないため開けません」と出る。右クリック → 開く で回避できるが、
**配る相手に手順を説明しないと使ってもらえない**。

## 先に決めること（トレードオフ）

公証には **Developer ID 証明書**が要る。この証明書で署名すると、配布物の署名に
**チーム名（多くの場合は個人名）が載る**。`codesign -dv` を打てば誰でも読める。

これは Apple の仕組み上避けられない。**「誰が配ったか分かる」ことが、警告を出さない
理由そのもの**だから。匿名のまま警告を消すことはできない。

そのため `make-dmg.sh` は既定の動きを変えていない:

| 環境変数 `NIMBUS_SIGN_IDENTITY` | 署名 | 実名の確認 | 公証 |
| --- | --- | --- | --- |
| 未設定（**既定**） | ad-hoc のまま | **実名が載っていたら止める**（従来どおり） | しない |
| 設定あり | Developer ID | しない（載るのを承知で選んでいる） | する |

**既定の動きは 1 文字も変えていない。** 公証は明示的に選んだときだけ動く。

## 使いかた

準備（1 度だけ）:

```bash
xcrun notarytool store-credentials "nimbus" \
  --apple-id "<Apple ID>" --team-id "<Team ID>" --password "<App 用パスワード>"
```

App 用パスワードは appleid.apple.com で作る（Apple ID の本体パスワードではない）。

配布物を作る:

```bash
export NIMBUS_SIGN_IDENTITY="Developer ID Application: ..."
export NIMBUS_NOTARY_PROFILE="nimbus"
bash nimbus/scripts/make-dmg.sh 0.6.0
```

## 中でやっていること

1. **前提の確認** — `notarytool` / `stapler` があるか、証明書がキーチェーンにあるか
2. **署名** — `--options runtime`（Hardened Runtime）付き。これが無いと公証は通らない。
   `.app` は `--deep`、`.dmg` は包みだけ
3. **提出** — `notarytool submit --wait`。`--wait` を付けないと、通ったかを別途取りに行くことになる
4. **添付（staple）** — **これをしないと、ネットワークの無い環境で初回起動が弾かれる**。
   公証の結果は Apple のサーバにあるので、成果物の中へ写しておく
5. **確認** — `spctl -a -vv -t install` が `accepted` を返すか。**配る前にここで見る**

**`.app` と `.dmg` の両方を通す。** `.app` だけ通しても、配る対象は `.dmg` なので、
ダウンロード直後に警告が出る。

## 確かめかた（証明書が無くても）

```bash
NIMBUS_DRY_RUN=1 bash nimbus/scripts/notarize.sh <path>
```

打つコマンドを全部出したうえで、前提（`notarytool` / `stapler`）の確認までは実際に走る。

## 受け入れ条件

- [x] 既定（`NIMBUS_SIGN_IDENTITY` 未設定）の動きが従来と同じ
- [x] Hardened Runtime 付きで署名する
- [x] `.app` と `.dmg` の両方を通す
- [x] staple してから配る
- [x] `spctl` で受け入れを確認してから終わる
- [x] 資格情報が無ければ、その旨を言って**止まる**（終了コード 1）
- [x] dry run が証明書なしで通る（実測: 終了コード 0）
- [ ] **実際の公証（未実施）** — Apple Developer Program の登録と証明書が要る。
      持っているのは利用者なので、ここから先は本人にしか実行できない

## 決めなかったこと・やらないこと

- **証明書の自動取得** — 個人の資格情報を扱う。スクリプトに持たせない
- **匿名のまま警告を消す** — できない。上の「先に決めること」のとおり
