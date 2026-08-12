# リモート拡張ホストでの動作確認（T-084 ②）

**日付**: 2026-08-13 / **確認者**: @session-c / **前提の調査**:
[remote-dev-investigation](../history/remote-dev-investigation.md)

調査（「入れられるか」）の次の段。**「入れられること」と「動くこと」は別**なので、
実際に動かして確かめた記録。

## SSH を使わずに確かめた理由

②の狙いは「**Nimbus 拡張がリモート拡張ホストで動くか**」で、SSH は**そこへ至る経路の 1 つ**でしかない。
SSH で繋いでも、拡張が載るのは同じリモート拡張ホスト（`vs/server`）。

このマシンには繋げる SSH 先が無く（`localhost:22` は閉じており、Remote Login の有効化は
管理者権限が要るシステム設定の変更なので、頼まれていない変更として行わなかった）、
代わりに**フォークに同梱されているサーバー版**を起動して、ブラウザから繋いだ。
これで拡張ホストは本番のリモートと同じものになる。

```bash
TC=<toolchain>/node-v24.18.0-darwin-arm64/bin
env -u NODE_OPTIONS PATH="$TC:$PATH" NODE_ENV=development VSCODE_DEV=1 \
  node scripts/code-server.js --port 9889 --without-connection-token \
  --accept-server-license-terms --disable-workspace-trust
```

ブラウザで `http://localhost:9889/?folder=<リポジトリ>` を開く。

**踏んだ落とし穴が 2 つ**（次に走らせる人のために残す）:

- `scripts/code-server.sh` は `build/lib/node.ts` を実行するため **Node 24 以上**が要る
  （22 では `ERR_UNKNOWN_FILE_EXTENSION`）。`.toolchain/` の Node を使う
- `.build/node/` に「リモート用 node」が無いと、`code-server.sh` が
  `npm run gulp node` でダウンロードしに行く。`scripts/code-server.js` を
  直接叩けば省ける

## 確かめたこと

| 見たもの | 結果 |
| --- | --- |
| サーバーが上がるか | ✅ `Extension host agent started` |
| ワークベンチが出るか | ✅ `Welcome — Nimbus — Code - OSS Dev` |
| **Nimbus がアクティビティバーに出るか** | ✅ 出る（信頼したフォルダのとき） |
| **コックピットが描けるか**（webview がリモート越しに動くか） | ✅ 入力欄・「送信」「中断」まで出る |
| タスク / 承認待ち / レビュー | ✅ すべて出る |
| **スキルが繋いだ先から読めるか** | ✅ プロジェクト 6 件・ユーザー 7 件を列挙 |
| **CLAUDE.md が繋いだ先から読めるか** | ✅ 節まで展開（約 1035 トークンと表示） |
| 文脈 / セッションの中身 / 時系列 / 使用量 / MCP / 設定 / ヘルプ | ✅ すべて出る |
| ステータスバー | ✅ 「Nimbus」「Hello 🌐」が出る |
| **Nimbus 由来のコンソールエラー** | ✅ **0 件** |

**セッションの起動（実際に Claude Code を走らせるところ）までは試していない。**
サーバー側に Claude Code を入れる話になり、それは README に書いたとおり「繋いだ先のものが使われる」。
ここで確かめたかったのは**拡張が載るか**なので、そこまでで止めた。

## いちばん大きな発見: 既定は制限モード

**信頼していないフォルダを開くと、Nimbus はアイコンごと出ない。**

初回は制限モードのまま開き、Nimbus のアイコンが**アクティビティバーに現れなかった**。
`package.json` の `capabilities.untrustedWorkspaces.supported: false` によるもので、
仕様どおりの正しい挙動だが、**利用者からは「入れたのに何も起きない」ように見える**。

信頼の対話は「**14 extensions are disabled or have limited functionality**」と出す。
信頼すれば（または `--disable-workspace-trust` で起動すれば）すべて出る。

**README に「繋いだのに Nimbus が出ないとき」の節を足した。**
リモートでは初回に必ず通る道なので、ここでつまずく人は多いはず。

## 出たエラー（すべて Nimbus 由来ではない）

1. `vscode.mermaid-markdown-features` が `legacyToolReferenceFullNames` を使えない — upstream の同梱拡張
2. `productService.builtInExtensionsEnabledWithAutoUpdates is not iterable` — 開発サーバーの `product.json` に無い項目
3. `No default agent registered` — Chat パネル（Nimbus のコックピットとは別物）

**どれも upstream 側**なので、Nimbus としては直さない。

## 残り

- **SSH 越しの接続そのもの**（`open-remote-ssh` などを入れて実際に繋ぐ）。
  拡張ホストは同じなので**動作の確認としては上で足りている**が、
  「繋ぐところ」の手順は別途確かめる価値がある
- **devcontainer 経由**（`docker` はこのマシンに入っている）。同じ理由で後回し

## 片付け

サーバーは停止し、開発サーバーが作ったプロファイル（`~/.nimbus-server-dev`）は削除した。
**利用者の設定・信頼済みフォルダには何も残していない**（信頼は永続化せず、
起動フラグ `--disable-workspace-trust` で回避した）。
