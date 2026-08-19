# 配布と upstream 追従

macOS 向けに固めて配り、upstream（`microsoft/vscode`）の新しいリリースへ載せ替える手順
（フォーク F5）。機能ではなく**運用**の仕様。


## 固めるときは順番待ちをする（T-276）

出力先（`.build/extensions` / `out-vscode` / `../Nimbus-darwin-arm64`）は 1 つしかないので、
2 つのセッションが同時に固めると**相手が消した途中のファイルを踏んで落ちる**
（実測: `ENOENT: .build/extensions/pug`）。

```bash
bash nimbus/scripts/package-app.sh                     # 順番を待ってから固める
bash nimbus/scripts/package-app.sh --copy /tmp/my-app  # 固めたあと、自分用の写しを作る
```

- ロックは `mkdir`（不可分）で取る。持ち主の pid を残し、**居なくなっていたら引き取る**
- ロックの外で走っている `gulp` も待つ（素の `npm run gulp` を叩く人がいるため）
- 写しを作っておくと、GUI テスト（`NIMBUS_APP=<写し>`）が後から始まったビルドに壊されない。
  表示言語のケース（`38-display-language.mjs`）も同じ写しを見る

## 何を解決するのか

「修正のたびにアプリとして固める」運用をフォークでも回す（ルール本文は
[`CLAUDE.md`](../../../CLAUDE.md) の「修正したらアプリとして固める（毎回）」）。同時に、フォークの寿命は
upstream への追従コストで決まるので、**追従が手順として回る形**にしておく。

## 振る舞い

### パッケージと配布

```bash
npm run gulp vscode-darwin-arm64        # ../Nimbus-darwin-arm64/Nimbus.app
bash nimbus/scripts/make-dmg.sh 0.6.0   # .build/dist/nimbus-0.6.0-darwin-arm64.dmg
```

- 出力先は `Nimbus-darwin-arm64`。`VSCode-<platform>-<arch>` のままだと、作業ディレクトリの隣に
  "VSCode" という名前のフォルダが生えて紛らわしいので変えてある
- **署名は ad-hoc**（Apple Developer Program に入っていない）。そのため初回起動は
  「開発元を確認できないため開けません」になり、右クリック → 開く で回避する
- `make-dmg.sh` は **`Developer ID` / `Apple Development` の署名を検出したら中止する**。
  開発者の実名が署名に載るのを防ぐため（過去に実名が入った実績がある）
- 配布は GitHub Releases（`gh release create vX.Y.Z .build/dist/*.dmg`）

### upstream 追従

```bash
bash nimbus/scripts/sync-upstream.sh release/1.133
```

- 作業ツリーが汚れていたら実行しない（退避してから）
- 方針が「コア変更を最小に保ち、機能は `extensions/nimbus` に置く」なので、
  **衝突するのは基本的に `nimbus/docs/core-changes.md` に載っている数ファイルだけ**になる
- 衝突したら台帳を見ながら直し、**台帳の側も更新する**
- 載せ替え先は開発中の `main` ではなく**リリース系のブランチ／タグ**

### 追従後にやり直すこと

- `node nimbus/branding/apply-product-json.mjs` — 身元（`product.json`）を当て直す
- `node nimbus/branding/make-icon.mjs` — アイコンを作り直す
- `node nimbus/branding/apply-core-changes.mjs` — コアの Nimbus ブロックを再適用する

身元の差し替えは**手編集しない**。スクリプトで再適用できる形に保つ。

## 設計

- `nimbus/scripts/make-dmg.sh` — dmg 作成（署名の実名検出つき）
- `nimbus/scripts/sync-upstream.sh` — upstream 取得・載せ替え・チェック
- `nimbus/branding/*.mjs` — 身元・アイコン・コア変更の再適用
- `nimbus/branding/smoke-packaged.sh` — パッケージ版のスモーク
- `nimbus/docs/core-changes.md` — コアに入れた変更の台帳（追従のたびに読み返す）

## 受け入れ条件

- [x] パッケージビルドが通る
- [x] 署名に開発者の実名が入らない（`codesign -dv` が adhoc / TeamIdentifier not set）
- [x] 実名署名を検出したら dmg 作成が中止される
- [x] upstream 追従の手順とチェックスクリプトがある
- [ ] 追従を実際に一度回して記録する（`tasks.md` T-007・未実施）

確認記録: `nimbus/docs/testing/f3-f6.md` §5、`nimbus/docs/testing/f1-fork-build.md`

## 決めなかったこと・やらないこと

- **Apple の公証（notarization）** — 手順とスクリプトは入れた（[notarization](notarization.md)）。
  実行には Developer Program の登録と証明書が要るため、**通すのは利用者本人**
- **Windows / Linux 版** — 今は macOS arm64 のみ
- **ベースを upstream `main` に載せること** — ビルド基盤の変化が速く、追従コストが高い
