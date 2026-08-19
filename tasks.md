# Nimbus タスク

Nimbus の「やること」と「やりたいこと」を 1 か所に集めたファイル。**思いついたら、まず Inbox に 1 行足す。**
整えるのは後でよい。ここに無いものは、誰の頭の中にも無いものとして扱う。

## 書きかた（複数の AI が同時に触るための約束）

- **追記はセクションの末尾に、1 タスク 1 行。** 既にある行は書き換えず、状態が変わったら**行ごと別のセクションへ移す**
  — 行単位の変更なら、競合しても機械的にマージできる（→ README「[複数の AI で並行開発する](README.md#複数の-ai-で並行開発する)」）
- **状態は置き場所で表す** — Inbox → 次にやる → 進行中 → 完了。`[x]` は完了の印
- 温めておく場所は 2 つ — **やりたいこと**（① 〜 ⑧ の層。実装の面で分ける）と
  **アイデア（視点別）**（体験・運用の切り口）。どちらか迷うものは Inbox に置いて後で振る
- **ID は `T-001` から通し番号。** コミットメッセージや会話で参照する。欠番は埋めない。
  ID が重複したら、**後からコミットする側が採番し直す**
- **着手するときは 進行中 へ移し、担当と開始日を書く**（例: `@session-a 2026-08-13`）。二重作業はこれで防ぐ
- 優先度は必要なときだけ行末に付ける — `[P1]` 今やる / `[P2]` 次の波 / `[P3]` いつか
- 1 行に収まらなくなったら仕様書（`nimbus/docs/specs/<機能名>.md`）に切り出し、ここからリンクして 1 行に戻す
- 実装したら仕様書も直す（→ README「[実装したら仕様書を直す](README.md#実装したら仕様書を直す)」）

## 選ぶ基準

数が増えるほど、要るのは足す基準ではなく**捨てる基準**。着手を決めるときはこの 3 つで測る。

1. **Claude Code 単体でできることは作らない。** これだけで候補はかなり削れる
2. **VS Code ベースでしか作れないものを優先する** — LSP・デバッガ・テストランナー・Git 統合。
   素の Claude Code では取りづらい情報をエージェントに渡せることが、エディタの上に乗る本質的な価値
3. **自分が毎日使うものから着手する** — Flutter の実務に効くものを先に作ると、開発が続く

## Inbox（未整理）

思いついたことをここへ。整った文章でなくてよい。「〜したい」「〜が気になる」で十分。
優先度や置き場所は後で決める。
- [x] T-274 文字のスキルを足す（`design-philosophy` の型ラムが決めない「どのフォントで出るか」を、日本語の側から補う）— 2026-08-19 / `.agents/skills/typography/SKILL.md`。積みに日本語があるか・太さが実体か合成か・行間・和欧の字面の 4 原則。`ergonomics` と同じく upstream を触らず Nimbus 側の横断レイヤーとして置く
- [x] T-271 **コックピットを VS Code のチャット画面の作りに寄せる** — 今の見た目は素の textarea と
      プレーンテキストで、Markdown もコードブロックも出ない。VS Code のチャットと同じ構造
      （行＝アバター＋名前＋本文 / 丸めた 1 枚の入力欄にツールバー同居）に作り直し、機能も揃える:
      Markdown 描画・コードブロックの操作（コピー / エディタへ挿入 / 新規ファイル / ターミナルで実行）・
      ツール呼び出しの折りたたみ・思考の折りたたみ・実行中の経過表示・応答ごとの操作・空のときの案内・
      添付・送信⇄停止の切り替え・入力履歴・スラッシュコマンド。
      **コア側チャット（`src/vs/workbench/contrib/chat/` 932 ファイル）は使わない** — ワークベンチ内部
      なので拡張の webview からは参照できず、寄せると Nimbus の作りごと変わる。構造値とテーマトークン
      （`chat.requestBackground` / `chat.avatarBackground` など）だけを借りる。
      ヘルプ（ゆあ）も同じ実装を使い回しているので、**両方が壊れないこと**を確認した
      — 2026-08-19 / 仕様 [cockpit-chat](nimbus/docs/specs/cockpit-chat.md) /
      解析は `src/core/chatMarkdown.ts`（モジュールテスト 9 件）・操作は `src/cockpit/codeActions.ts`・
      GUI ケース 45。**コア側チャットは使わなかった**（拡張の webview から参照できないため。
      構造値とテーマ色だけ借りた）[P1]
- [x] T-238 **右の CHAT パネル（Build with Agent）が出ている** — `chat.disableAIFeatures` はエージェントホストの有効・無効を決めるだけで、CHAT のビューコンテナは別に登録されていた。コンテナをアクティビティバー／補助バーの一覧から外し、あわせて `workbench.secondarySideBar.defaultVisibility` の既定を `hidden` に（そのままだと**中身が無いまま帯だけ残る**）。登録は消していないのでコマンドからは呼べる — 2026-08-18 / コア台帳 #26・#27（実装済み・コミット待ち）
- [x] T-249 **Claude 用のデバッグをアクティビティバーに置く** — 検討の結果、挙がっていた 3 案
      （例外で止まった場所を渡す・起動構成を作る・ブレークポイントを提案する）は**どれもプログラムの**
      デバッグで、標準の F5 が既に持っている。抜けていたのは**エージェントの**デバッグのほうだったので、
      そちらを入口にした。アイコンは雲＋虫。面は 4 段（いま／失敗／繰り返し／ツール呼び出し）で、
      失敗の件数はアイコンのバッジに出す。行を押すと中身が開き、失敗はそのままコックピットへ投げられる。
      生の入力はサニタイザを通してから出す — 2026-08-18 / 仕様 [debug-view](nimbus/docs/specs/debug-view.md) /
      `src/core/debugInsight.ts`（モジュールテスト 9 件）・GUI ケース 37。
      **プログラムのデバッガ側は T-254 に残す**（止まった場所をセッションへ渡すボタン）[P1]
- [ ] T-281（旧 T-276・ID が重複したので採番し直し）**枠の残り（5 時間 / 週）をコックピットの入力欄の下に常時出す** — いま使用量は
      **下のパネル**（ターミナルと同じ場所の「診断」コンテナ内の使用量ビュー・T-017 / T-037）にしか
      出ておらず、走らせている最中に見えない。数字はもう取れている（`SessionManager` の実験的 API を
      ターンごとに取り直し・仕様 [usage](nimbus/docs/specs/usage.md)）ので、足すのは**出す場所**だけ。
      入力欄の下は視線がいちばん通る場所なので **1 行に収める**（5 時間の枠・週の枠。文脈の内訳と費用は
      今のビューに残す）。枠が無い環境（API キー / Bedrock / Vertex）と取得に失敗したときは、
      黙って空欄にせず 1 行を消すか理由を出す。パネルのビューを残すか畳むかは実物を見て決める。
      T-268 / T-269 と同じ webview を触るので順番を合わせる [P1]

## 進行中
















<!-- 着手したら 次にやる / やりたいこと からこの下へ行ごと移し、担当と開始日を書く -->


      聞き間違える前提で、危ないことは音声で実行しない。`core/voiceCommands.ts` `src/voiceCommands.ts` を確保
      @yua が進めています（`core/voiceInput.ts` で録音＋書き起こしまで）。
      @session-c は重複を取り下げ、`core/voiceCommands.ts` を削除しました 2026-08-13 [P3]










      `nimbus/scripts/headless.mjs` `src/mcpToolRunner.ts` を確保済み @session-a 2026-08-13 [P2]





      `core/ambiguity.ts` `core/settingsHistory.ts` `core/highlights.ts` を確保済み @session-a 2026-08-13 [P2]


      ※T-068 は別セッションが先に実装済み（`core/importRules.ts`）@session-a 2026-08-13 [P2]

      `core/recovery.ts` を確保済み @session-a 2026-08-13 [P2]





      実装前に claim @session-b 2026-08-13 [P2]


































## 次にやる



## やりたいこと

構想は **8 つの層**で捉えている — ① オーケストレーション（並列）② コンテキスト可視化 ③ レビュー
④ 制御 ⑤ ラボ ⑥ IDE との統合 ⑦ コードの理解と生成の精度 ⑧ 対話の質。
④ が体験としての差別化、⑥ ⑦ は「フォークにした意味」が出る層、⑧ は事故を防ぐ層。

### コックピットとセッション履歴


### ① オーケストレーション層（並列セッション・ここが主戦場）

Nimbus が狙うのは「1 人の Claude を速く回す」ことではなく、**複数のエージェントで同時に同じプロジェクトを
開発できること**。このセクションの項目は優先して考える。
**worktree の自動切り出しと「1 タスク = 1 セッション」の並列実行、同時実行上限つきのタスクキューは
F4 で実装済み**（`extensions/nimbus/src/tasks/`）。ここに残るのはその先。
（Nimbus 自身を複数の AI で開発するときの作法は README「複数の AI で並行開発する」。こちらは**製品の機能**の話）


### ② コンテキスト可視化層（文脈とコスト）


### ③ レビュー層

**承認前に差分エディタで見せる仕組みは F3 で実装済み**（`core/editPreview.ts`）。ここに残るのはその先。


### ④ 制御層（Hooks・権限・MCP・設定）

**一番の差別化になりそうな層。**


### ⑤ ラボ層（スキル・サブエージェント・コマンド）

**スキルの一覧と検索は F6 で実装済み** — サイドバーの「スキル」ビュー（出どころ別に分類・行をクリックで
`SKILL.md` が開く・▶ でコックピットへ `/<name>` を送る）と、見出しの「探す」（曖昧な言葉で絞り込む
QuickPick・説明文にも当たる）。`extensions/nimbus/src/skillsView.ts` と `nimbus.findSkill`。


### ⑥ IDE との統合（フォークにした旨味が出る場所）

（Inbox の T-014「ターミナルの多分割」もこの層の話。整理したらここへ移す）

### ⑦ コードの理解と生成の精度（エンジン側）

UI ではなく「**エージェントがどれだけ正確に読めて、正確に書けるか**」の層。
LSP・型情報・デバッガ・テストはフォークならプロセス内にあるので、ここは ⑥ と地続き。

**読ませる**


**書かせる**


**デバッグ**


**動作確認**


**リファクタ・移行**


### ⑧ 対話の質（人間とエージェントの間）

**「何を作るか」ではなく「どう頼むか／どう返すか」の層。** ここが弱いと、他が良くても事故る。


### IntelliJ IDEA 由来の IDE 基礎機能

IntelliJ IDEA 2026.2 の機能一覧（公式ドキュメント全 1,273 トピックから起こしたもの）を Code OSS と
突き合わせ、**IntelliJ にあって VS Code に無いもの**だけを残した。章番号は調査書のもの。
土台に既にある機能（エディタ・補完・デバッグ・SCM・テスト・階層表示・Sticky Scroll・Local History・
Screencast Mode）は除外済み。**新しい配色は足さず、Nimbus Dark / Light のテーマ変数に従う**方針
（T-001 の Claude 配色。スクラッチファイル T-033 の判断と揃える）。

**第一波（T-033 / T-224〜T-231）は実装済み。** 完了セクションを参照。


### 配布・運用


### upstream 追従・コア


### ドキュメント・テスト

## アイデア（視点別）

層（① 〜 ⑥）が「何を作るか」の分けかたなら、こちらは「**どの視点から見るか**」の引き出し。
やると決めたものは、行ごと上の層のセクションへ移す。

### 🎓 学習・教育


### 👥 チーム・社会性


### ⏰ 時間軸


### 📱 デスクを離れる


### 🛡 事故る前に


### 📄 コード以外の成果物


### 🎨 自分だけの相棒にする


### 📊 自分を観測する


### 🔀 乗り換え・共存


### 🌐 コミュニティ


### 📱 モバイル開発


### 🔐 コンプラ・機密


### 🏚 巨大・レガシーリポ


### 🧪 「本当に動いたの？」


### 🖥 環境まわり


### 🧠 メンタル・集中


### 🌏 日本語まわり


### 🧩 拡張性


### 🔄 バージョン追従


### 🎮 続けたくなる


### 📦 依存・ビルド


### 🌐 API・スキーマ


### 🗄 データ・DB

      必ず人間承認にする（④ の権限ルールと繋げる）[P2]

### ⚡️ パフォーマンス


### 🔁 CI/CD


### 🌿 ブランチ運用

**worktree の自動管理は F4 で実装済み** — タスクごとに切り、完了時は未コミットの変更を WIP コミットで
保存してから `git worktree remove` する（`core/worktree.ts`）。ここに残るのはその先。


### 📊 コード品質


### 🧬 型・生成コード


### 🧯 運用・障害対応


## 保留・やらないと決めたこと

**理由を 1 行必ず残す。**同じ議論を別のセッションが蒸し返さないために置いてあるセクション。

- GUI ケース `10-context-tree.mjs` / `18-review.mjs` を削除した（T-267）。確かめていたのは
  **サイドバーに出ている状態**で、そのビュー自体を UI から外したので成り立たない。
  中身の判定は単体テスト（`context.test.ts` / `review*.test.ts` 9 本）が押さえている。
  タブ（T-258）などで出し直すときに作り直す

- リモート開発の **SSH / devcontainer で「繋ぐところ」**（T-084 ② の残り）— 接続には Open VSX の OSS リモート拡張を先に入れる必要があり、薦める拡張を決めない方針なので利用者の選択が要る。**※「リモート拡張ホストで Nimbus が動くか」は 2026-08-13 に確認済み**（[確認記録](nimbus/docs/testing/remote-dev-verification.md)）。同梱のサーバー版なら拡張ホストは同じものなので、linux 版 REH のビルドは不要だった
- Claude Code 本体の同梱 — バイナリだけで 280MB あり、利用者はすでに認証済みのものを持っていることが多い（README「ダウンロードと実行」）
- Microsoft Visual Studio Marketplace の利用 — 利用規約により Microsoft 製品以外での利用が認められていない（README「拡張機能について」）
- ベースを upstream の `main` に載せる — ビルド基盤の変化が速く追従コストが高い。安定リリースタグに載せる（`nimbus/docs/history/vscode-fork-migration.md` 5-7）

## 完了

新しい順。日付と、あれば確認記録へのリンクを添える。溜まってきたら `nimbus/docs/history/` へ退避する。

- [x] T-272 コックピットの意匠を役割と段に乗せた。文字は型ラム（heading3 / body1-2 / label1-2・
      太さは 400 と 600 だけ）、角丸は段（Control 4px / Inner 6px）。11px〜15px と 0.9em / 0.92em の
      混在、2px / 3px / 4px / 6px の混在を 30 箇所ぶん寄せた。焦点の色は焦点にだけ使う
      （承認カードが常時 `focusBorder` を着ていたのをやめた）。序列は T-271 の作り替えで解けている
      — 2026-08-19 / 仕様 [cockpit-chat](nimbus/docs/specs/cockpit-chat.md) / パッケージ版 GUI 46/46

- [x] T-273 フォントを日本語前提で決め直した。**同梱せず、積みで名指しする** — 0 バイトで効き、
      入っていない環境では今までどおり落ちるだけ。先頭は VS Code の変数のままなので利用者の設定が勝つ。
      Hiragino Sans を名指しすることで `600` が実体で出る（合成太字にならない）。板にも同じ積みを当てた
      — 2026-08-19 / 仕様 [typography](nimbus/docs/specs/typography.md)


- [x] T-275 コックピットの入力欄を 3 行ぶんにし、幅も使えるようにした（別セッションが実装）。
      1 行だと主戦場が検索欄に見えるうえ、2 行目を打った瞬間に下のツールバーごと動いていた
      — 2026-08-19 / パッケージ版 GUI 46/46 のスクリーンショットで確認


- [x] T-279 Herdr で動いているセッションを読んで一覧に混ぜた。**置き換えず、並べて置く**
      （Nimbus は SDK をプロセス内で叩き、Herdr は端末で CLI を走らせる前提なので、
      そのまま入れると持ち主が二重になる）。同梱せず「入っていれば使う」。`blocked` は
      Nimbus の「許可待ち」と同じ意味なので記号も揃えた。**実機の Herdr との突き合わせは未実施**で、
      確かめかたは文書どおりに答える偽のソケット（モジュールテスト 5 件・GUI ケース 48）
      — 2026-08-19 / 仕様 [herdr](nimbus/docs/specs/herdr.md) / パッケージ版 GUI 46/46

- [x] T-281 仕様書の索引を実態に揃えた（154 本のうち **68 本が索引から漏れていた**）。
      リンク切れも直し、ドクターの docs 検査が緑になった。台帳照合（ledger）も緑
      — 2026-08-19 / [仕様書の索引](nimbus/docs/specs/README.md)


- [x] T-276 固め直しを順番待ちにした（`nimbus/scripts/package-app.sh`）。出力先は 1 つしかないので、
      2 セッションが重なると相手が消した途中のファイルを踏んで落ちていた。`mkdir` の不可分性でロックを取り、
      持ち主が居なくなっていたら引き取る。ロックの外の `gulp` も待つ。`--copy` で自分用の写しを作れる
      （GUI テストはそれを見るので、後から始まったビルドに壊されない）
      — 2026-08-19 / 仕様 [distribution](nimbus/docs/specs/distribution.md) / パッケージ版 GUI 45/45


- [x] T-280 Herdr の権利まわりを確認した（Apache-2.0・NOTICE 無し・LICENSE の著作権者名はひな形のまま・
      商標方針の記載なし・cargo-deny / about の設定が無いので孫ライセンスは未確認）。
      **結論: 「入っていれば使う」なら問題なし。同梱は保留**（配布物に何が入るか確かめてから）。
      全社台帳（`00_hq/ledger/ip-register.md`）にも登録
      — 2026-08-19 / 確認記録 [herdr-license-review](nimbus/docs/history/herdr-license-review.md)


- [x] T-269 / T-270 コックピットを全画面で使えるようにし、セッションをタブで切り替えられるようにした
      （2 本以上のときだけ列を出す・並びは始めた順で固定・状態は記号と色の両方・許可待ちが最優先）。
      右半分にはワークベンチの実物を置く（コマンドの写しの端末 / HEAD との差分）。切り替えれば右も追従する
      — 2026-08-19 / 仕様 [cockpit-fullscreen](nimbus/docs/specs/cockpit-fullscreen.md) /
      パッケージ版 GUI 45/45（表示言語の 1 件は別セッションのビルドと重なったためで、ケース側を直した）

- [x] T-274 / T-278 直したものが戻らないようにした。回帰テストに T 番号を書く規約（CLAUDE.md）＋
      守りの無い完了を出す `regression-guard.mjs` ＋ 台帳照合を警告から**赤**へ（コアの Nimbus 変更が
      落ちていたら落とす）。初回の棚卸しで 61 本のテストに番号を書き足し、守りのある完了は 160 → 222 件。
      内蔵チャットの入口が戻っていないことも見るようにした（T-238 の守り）
      — 2026-08-19 / 仕様 [regression-guard](nimbus/docs/specs/regression-guard.md)


- [x] T-273（旧 T-267。T-271・T-272 も別セッションが使ったため 273 へ）**承認待ち・レビュー・文脈を UI から外す** —
      `visibility: hidden` は既定値でしかなく、一度見たことのあるプロファイルには効かない。
      `contributes.views` から外して、どのプロファイルでも出ないようにした（別セッションが実装）。
      **後始末**: 宣言から外したビューに `createTreeView` が残っており、起動のたびに
      「No view is registered with id: …」がエラー通知で 2 つ出ていた。宣言を正として、
      載っていないビューにはツリーを作らないようにした — 2026-08-19

- [x] T-268 送信のたびにポップアップが出るのをやめた（曖昧さの確認は既定 off・資格情報の検出は既定 on）。
      出荷時の既定値は `src/test/settingsDefaults.test.ts` で固定（別セッションが実装）— 2026-08-19


- [x] T-263 承認待ちの一覧は残し、役割を「**いま見ていないセッション・別ウィンドウのぶんを拾う**」に
      絞った（前面のぶんは T-266 のカードに出る）。カードで受けられないときは今までどおり全件を出す。
      ステータスバーの件数は全件のまま（気づくためのもので、答える場所ではない）
      — 2026-08-18 / 利用者の判断 / 仕様 [approvals-and-diff](nimbus/docs/specs/approvals-and-diff.md)


- [x] T-266 承認を会話の中のカードで受けるようにした（入力欄のすぐ上・許可 / このセッションは許可 /
      常に許可 / 拒否・押した瞬間に消える・別セッションのぶんは出どころを添える）。
      窓ごと止まるモーダルは、コックピットの面が無いときだけの逃げ道にした。
      固めた `.app` で実セッションの Write 承認まで確認
      — 2026-08-18 / 仕様 [approval-in-conversation](nimbus/docs/specs/approval-in-conversation.md)


- [x] T-267 当たらないパターンなら、名前を聞く前に断るようにした（置き換えの追跡）。
      名前を聞いてから数えていたので、当たらないときは打ったものが捨てられるだけだった
      — 2026-08-18 / 仕様 [refactor-progress](nimbus/docs/specs/refactor-progress.md)

- [x] T-255 / T-256 / T-257 / T-265 サイドバーの整理（文脈とレビューを既定から外す・タスクを
      アクティビティバーへ独立・板の状態表記を英語に・ヘルプを「Nimbus 設定」へ）
      — 別セッションが実装。2026-08-18 にパッケージ版の GUI テスト 43/43 で確認 /
      仕様 [views-layout](nimbus/docs/specs/views-layout.md)


- [x] T-247 / T-251 / T-252 / T-253 セッションの台帳をプロセスの外へ出した（1 セッション 1 ファイル・
      持ち主は心拍で決める・同時実行は台帳で横断的に数える・持ち主のいない記録から「続きから」・
      作業ディレクトリの重なりを知らせる）。固めた `.app` で台帳の一覧と重なりの知らせまで確認
      — 2026-08-18 / 仕様 [session-registry](nimbus/docs/specs/session-registry.md)

- [x] T-250 監査ログを追記だけにした。**実測で 800 行中 797 行が消えていた**（→ 0 件）。
      ファイルが育っても 1 行の追記が遅くならない
      — 2026-08-18 / 計測 [parallel-load](nimbus/docs/testing/parallel-load.md)

- [x] T-248 並列時の破損と遅延を**先に実測**してから直した。書き込みの直列化と面の間引きは
      「測ったら要らなかった」として見送り、理由を残した
      — 2026-08-18 / 計測 [parallel-load](nimbus/docs/testing/parallel-load.md)

- [x] T-259 / T-260 / T-261 / T-262 板をウィンドウ横断で持つようにした（5 秒ごとの突き合わせ・
      担当ウィンドウの記録・進捗の追記とカードへの表示・止まっているタスクの点検）
      — 2026-08-18 / 仕様 [task-board-shared](nimbus/docs/specs/task-board-shared.md)

- [x] T-258 コックピットとタスク板をエディタタブでも開けるようにした（面は増やすが**状態は増やさない**）
      — 2026-08-18 / 仕様 [editor-tabs](nimbus/docs/specs/editor-tabs.md)

- [x] T-254 止まった場所をセッションへ渡すボタン（デバッグツールバー＋コマンド）。
      自動で声をかけるのは例外で止まったときだけ（ブレークポイントのたびには聞かない）
      — 2026-08-18 / 仕様 [debug-tools](nimbus/docs/specs/debug-tools.md)

- [x] T-240 GUI テストがフル実行のときだけ落ちる件。真因は**文書を画面に出ている分しか読んでいなかった**
      こと（Monaco は見えている行しか DOM に置かない）。あわせてケース間で作業ツリーを素の状態へ戻す
      — 2026-08-18 / パッケージ版フル実行 42/43（残る 1 件は T-267）

- [x] T-264 板の状態を 1 コマンドで見られるようにした（`node nimbus/scripts/board.mjs`）。
      札の重なり・札の無い進行中・ID の重複を出す — 2026-08-18


- [x] T-084 ② リモート拡張ホストでの動作確認（サイドバーは全部出て、スキルと CLAUDE.md は
      繋いだ先から読める。Nimbus 由来のエラーは 0 件。**制限モードでは Nimbus がアイコンごと
      出ない**落とし穴を発見し、README に節を足した）。SSH 先は用意できなかったが、確かめたかったのは
      「拡張がリモート拡張ホストで動くか」で、SSH はそこへ至る経路の 1 つ。同梱のサーバー版で足りた
      — 2026-08-13 / 確認記録 [remote-dev-verification](nimbus/docs/testing/remote-dev-verification.md)

- [x] T-085 マシンをまたいでセッションを続ける（運んで困るのは会話ではなく前提のほう。
      別リポジトリなら止め、ずれは全部挙げて、続ける前に読み直させる。運ぶ経路は決めない）
      — 2026-08-13 / 仕様 [session-sync](nimbus/docs/specs/session-sync.md)

- [x] T-084 リモート開発の**前提調査**（REH の土台は残っている・ギャラリーは Open VSX・拡張はリモート側で動く）
      — 2026-08-13 / [調査記録](nimbus/docs/history/remote-dev-investigation.md)

- [x] T-054 / T-086 手元の端末から承認だけする（同じ Wi-Fi の中だけ・合言葉は開くたびに作り直す・
      通る道は画面と一覧と答えるの 3 つだけ・POST でしか答えられない・10 分で自動的に閉じる）
      — 2026-08-13 / 仕様 [remote-approval](nimbus/docs/specs/remote-approval.md)

- [x] T-208 社内 Wiki / Notion へ出す（相対リンクを絶対 URL に。直せないときは書き換えない。
      内部向けは伏せて跡を残す。貼るのは人）
      — 2026-08-13 / 仕様 [wiki-export](nimbus/docs/specs/wiki-export.md)

- [x] T-073 シミュレータ操作（座標では押さない。画面を撮って「何が見えるか」から言わせ、
      流れは integration_test に起こして資産にする）
      — 2026-08-13 / 仕様 [simulator](nimbus/docs/specs/simulator.md)

- [x] T-069 別のツールの結果と並べて比べる（同じ行を触ったところだけが選ぶ場所。ファイルが同じでも
      離れていれば両方採れる。どちらが良いかは言わない）
      — 2026-08-13 / 仕様 [agent-compare](nimbus/docs/specs/agent-compare.md)

- [x] T-222 メモリの増え方と起動時間（1 枚では分からないので並びを見る。3 点未満では何も言わない。
      起動は 2 割かつ 100ms 以上でだけ「遅くなった」と言う。原因は決めつけず数字だけ渡す）
      — 2026-08-13 / 仕様 [memory-and-startup](nimbus/docs/specs/memory-and-startup.md)

- [x] T-135 積み上げた PR の管理（入れる順は下から。下が入った後の付け替えを出す。輪になっていたら
      積まず迷子として出す。base の書き換えは走らせず、コマンドを出すまで）
      — 2026-08-13 / 仕様 [pr-stack](nimbus/docs/specs/pr-stack.md)

- [x] T-142 監視ツールの障害を取り込む（影響の大きさを先に・足あとを再現の入力として渡す）
      — 2026-08-13 / 仕様 [error-monitor](nimbus/docs/specs/error-monitor.md)

- [x] T-093 ヘッドレス Nimbus — GUI 抜きで同じワークフローを CI から回す（`nimbus/scripts/headless.mjs`）。
      判断は `out/core/*.js` を読み込んで画面と共有する。確認のある段は `--yes` が無ければ実行を断り、
      危険なツールは承認待ちにせず落とす（CI には承認する人がいない）
      — 2026-08-13 / 仕様 [headless-and-mcp-tools](nimbus/docs/specs/headless-and-mcp-tools.md)
- [x] T-235 MCP ツールの単体実行 — エージェント抜きでツールを 1 回だけ呼ぶ（`nimbus.runMcpTool`）。
      プロセス内のサーバーへ `InMemoryTransport` で繋ぐので API も課金も発生しない。
      引数はスキーマから型どおりに組み立てる
      — 2026-08-13 / 仕様 [headless-and-mcp-tools](nimbus/docs/specs/headless-and-mcp-tools.md)
- [x] T-216 / T-144 戻す道と、急ぐ道（戻らないもの＝DB・データ・インフラを名指しする。
      スクリプトは `--run` が無ければ何もしない。急ぐときもテスト・戻し口・既定ブランチへの戻しは省かない）
      — 2026-08-13 / 仕様 [rollback-and-hotfix](nimbus/docs/specs/rollback-and-hotfix.md)

- [x] T-173 マルチルートワークスペース対応 — `workspaceFolders[0]` を直に見ている箇所が 0 になった。
      対話のコマンドは `pickWorkspaceRoot`（1 フォルダなら聞かない）、聞けない・聞くべきでない 5 箇所は
      `resolveWorkspaceRoot`。セッションの作業ディレクトリ（`workspaceCwd()`）は範囲外として残す
      — 2026-08-13 / 仕様 [workspace-roots](nimbus/docs/specs/workspace-roots.md)
- [x] T-091 UI とドキュメントの多言語化 — `package.json` の 227 件を `package.nls.json` へ出し、英語を全件そろえた。
      `src/**` の 4,463 件は**載せ替えない**と決めた（判断を変える条件も仕様書に明記）。
      `nimbus/scripts/nls-extract.mjs --check` で取りこぼしと訳の抜けを見る
      — 2026-08-13 / 仕様 [localization](nimbus/docs/specs/localization.md)
- [x] T-007 upstream 追従を実際に一度回した（1.132.0 → release/1.133）。手順書と実態が違ったので直した。
      衝突 113 件はすべて「消したファイルを upstream が変えた」形で、台帳のファイルは内容衝突 0 件。
      基点が `@{u}` で毎回「全部変更あり」と出ていたのも直した。実際の rebase は未実施（理由も記録）
      — 2026-08-13 / 記録 [upstream-sync](nimbus/docs/upstream-sync.md)
- [x] T-212 権限管理（企業導入向け）— `nimbus.managedPolicy` を上限として扱う。利用者の設定は狭める方向だけ効く。
      ポリシー・自動許可・遮断パス・監査ログにかかる。読むのはユーザー設定だけ（`scope: machine`）
      — 2026-08-13 / 仕様 [managed-policy-and-plugins](nimbus/docs/specs/managed-policy-and-plugins.md)
- [x] T-092 Nimbus 自体のプラグイン API — `activate()` の戻り値を公開面にし、足せるものを
      「読ませるもの」「作らせるもの」の 2 つに限った。権限の判断には触らせない
      — 2026-08-13 / 仕様 [managed-policy-and-plugins](nimbus/docs/specs/managed-policy-and-plugins.md)
- [x] T-084 リモート開発 — ①リモート時の実行ファイル案内の出し分け（`core/remoteGuidance.ts`）と
      ③README の「リモートで使う」の節。**②実機の SSH 先での接続確認は保留へ**（環境が要る）。
      薦めるリモート拡張は書かない（メンテ状況を Nimbus が背負わないため）
      — 2026-08-13 / 調査 [remote-dev-investigation](nimbus/docs/history/remote-dev-investigation.md)
- [x] T-221 コードオーナーへの通知（最後に一致した規則が勝つ。誰に頼むかを出すまでで、投げるのは人）
      — 2026-08-13 / 仕様 [codeowners](nimbus/docs/specs/codeowners.md)

- [x] T-143 再現手順の生成（ログから「まず落ちるテスト」を起こす。通る形では作らない）
      — 2026-08-13 / 仕様 [repro-test](nimbus/docs/specs/repro-test.md)

- [x] T-131 落ちた CI を調べる（gh で失敗ログを取り、手元で再現するか CI 固有かを先に切り分けさせる）
      — 2026-08-13 / 仕様 [ci-failure](nimbus/docs/specs/ci-failure.md)

- [x] T-237 セッション中の繰り返し検出（3 回目を書いたその場で CLAUDE.md への追加を聞く。判定は既存の純関数を再利用）
      — 2026-08-13 / 仕様 [session-repeats](nimbus/docs/specs/session-repeats.md)

- [x] T-130 改善前後のベンチ比較（ばらつきを超えた差だけを「速くなった」と言う）
      — 2026-08-13 / 仕様 [benchmark](nimbus/docs/specs/benchmark.md)

- [x] T-141 生成物の作り直し（元を直したら聞く・生成ツールが無ければ何も出さない）
      — 2026-08-13 / 仕様 [diff-summary](nimbus/docs/specs/diff-summary.md)

- [x] T-094 Claude Code の更新に気づく（init の一覧の差分で、実際に増えたものだけを名指しする）
      — 2026-08-13 / 仕様 [version-watch](nimbus/docs/specs/version-watch.md)

- [x] T-139 生成物への直接編集をガードする（自動許可より先に止め、代わりに直す先を名指しする）
      — 2026-08-13 / 仕様 [approvals-and-diff](nimbus/docs/specs/approvals-and-diff.md)

- [x] T-123 型の変更が壊す場所を洗い出す（変わった型を参照検索で追い、壊れていないかを確かめさせる）
      — 2026-08-13 / 仕様 [schema-impact](nimbus/docs/specs/schema-impact.md)

- [x] T-068 他のツールの設定を取り込む（Cursor / Copilot / Windsurf のルールを、出どころつきで CLAUDE.md へ）
      — 2026-08-13 / 仕様 [import-rules](nimbus/docs/specs/import-rules.md)

- [x] T-170 コピーしたエラー文に気づく（既定は無効。戻ってきた瞬間に 1 回だけ見て、中身は画面に出さない）
      — 2026-08-13 / 仕様 [clipboard-hints](nimbus/docs/specs/clipboard-hints.md)

- [x] T-133 不安定なテストの検出（1 回でも結果が変われば flaky・回によって現れないものも別に出す）
      — 2026-08-13 / 仕様 [flaky-tests](nimbus/docs/specs/flaky-tests.md)

- [x] T-174 ノートブック対応（セルを「ファイル名（セル N）」で扱い、git に渡せない機能は理由つきで断る）
      — 2026-08-13 / 仕様 [notebooks](nimbus/docs/specs/notebooks.md)

- [x] T-078 モノレポのスコープ切り替え（選んだパッケージを、これから始めるセッションの作業ディレクトリにする）
      — 2026-08-13 / 仕様 [monorepo-scope](nimbus/docs/specs/monorepo-scope.md)

- [x] T-140 生成物と手書きの区別（差分の要約で生成物を畳む。畳むが隠さない）
      — 2026-08-13 / 仕様 [diff-summary](nimbus/docs/specs/diff-summary.md)

- [x] T-083 裏取りモード（指示で名前が出たライブラリの、実際に使っているバージョンを送る前に添える）
      — 2026-08-13 / 仕様 [signature-attachment](nimbus/docs/specs/signature-attachment.md)

- [x] T-080 仕様の逆生成（事実と推測を分けさせ、既存の記述は消させない。型は既存の仕様書に合わせる）
      — 2026-08-13 / 仕様 [reverse-spec](nimbus/docs/specs/reverse-spec.md)

- [x] T-116 PR レビューの取り込み（指摘を要約せず差分つきで渡す・返信は下書きまで）
      — 2026-08-13 / 仕様 [pr-review](nimbus/docs/specs/pr-review.md)

- [x] T-079 考古学モード（`git blame` の経緯ごと渡して「なぜこうなっているのか」を読み取らせる。
      推測を事実として書かせない）— 2026-08-13 / 仕様 [archaeology](nimbus/docs/specs/archaeology.md)

- [x] T-028 承認ルールの画面編集（何を許すのかを日本語で添える・広いルールに飲み込まれた行を示す）
      — 2026-08-13 / 仕様 [permission-rules](nimbus/docs/specs/permission-rules.md)

- [x] T-209 古くなった API ドキュメントを探す（変えた公開名に触れているのに今回変わっていない文書を挙げる）
      — 2026-08-13 / 仕様 [api-docs](nimbus/docs/specs/api-docs.md)

- [x] T-060 決めたことを残す（ADR）（会話から候補を拾い、`nimbus/docs/decisions/NNNN-*.md` を採番して作る。
      採番は wx で確保して並行実行でも衝突しない）— 2026-08-13 / 仕様 [decisions](nimbus/docs/specs/decisions.md)

- [x] T-177 スニペット化（選択範囲を `.vscode/*.code-snippets` に保存。エスケープと字下げ落としつき）
      — 2026-08-13 / 仕様 [snippets](nimbus/docs/specs/snippets.md)

- [x] T-182 テストが守っているかを確かめる（確実に意味が変わる壊し方を出し、1 つずつ入れて落ちるかを試させる）
      — 2026-08-13 / 仕様 [mutations](nimbus/docs/specs/mutations.md)

- [x] T-110 大規模な一括変更（影響範囲を先に数え、まとまりに分けて間にテストを挟ませる。進捗追跡にも繋ぐ）
      — 2026-08-13 / 仕様 [refactor-progress](nimbus/docs/specs/refactor-progress.md)

- [x] T-103 プロジェクト固有の書き方（既存ファイルを数えて、はっきり多いものだけを渡す。推測はしない）
      — 2026-08-13 / 仕様 [conventions](nimbus/docs/specs/conventions.md)

- [x] T-179 移行前後の等価性確認（移行前に「いまのとおり」を写すテストを書かせ、移行後は落ちたテストを
      変わった証拠として仕分けさせる）— 2026-08-13 / 仕様 [equivalence](nimbus/docs/specs/equivalence.md)

- [x] T-158 変更影響範囲の事前プレビュー（消した export の呼び出し元を、適用の前に並べる）
      — 2026-08-13 / 仕様 [impact-preview](nimbus/docs/specs/impact-preview.md)

- [x] T-181 スナップショットの更新レビュー（何が更新されたかを名指しし、「直して」ではなく「説明して」から入る）
      — 2026-08-13 / 仕様 [snapshot-review](nimbus/docs/specs/snapshot-review.md)

- [x] T-176 リポジトリの構造要約カード（数えた事実だけを 1 枚にして、そのままセッションへ渡せる）
      — 2026-08-13 / 仕様 [repo-summary](nimbus/docs/specs/repo-summary.md)

- [x] T-157 差分のセマンティック要約（export の増減を先頭に・構造だけ出して意図は Claude へ）
      — 2026-08-13 / 仕様 [diff-summary](nimbus/docs/specs/diff-summary.md)

- [x] T-111 段階的リファクタの進捗管理（`git grep -c` で残りを数え、続きを残りの多い順に頼む）
      — 2026-08-13 / 仕様 [refactor-progress](nimbus/docs/specs/refactor-progress.md)

- [x] T-160 レビュー済み／未レビューの管理（見たあとに変わったものは自動で未レビューに戻す）
      — 2026-08-13 / 仕様 [review-progress](nimbus/docs/specs/review-progress.md)

- [x] T-180 影響を受けるテストだけを走らせる（参照検索で関係するテストを選び、一覧を見せてから実行）
      — 2026-08-13 / 仕様 [test-runner](nimbus/docs/specs/test-runner.md)

- [x] T-115 コンフリクト解消支援（両方残す／片方を採るを 1 件ずつ・判断がつかないものは Claude へ相談文）
      — 2026-08-13 / 仕様 [conflicts](nimbus/docs/specs/conflicts.md)

- [x] T-107 失敗テスト起点の開発（先に落ちるテストを書かせる指示と、赤 → 緑になった瞬間の確認）
      — 2026-08-13 / 仕様 [test-runner](nimbus/docs/specs/test-runner.md)

- [x] T-106 ビルドエラーの自動リトライ（利用者が打ったビルド／型チェックだけを、直させてから
      同じ端末で走らせ直す。既定は無効・上限つき）— 2026-08-13 / 仕様 [terminal-capture](nimbus/docs/specs/terminal-capture.md)

- [x] T-114 コミットの意味単位への分割（変更を意図ごとに束ね、束ごとの `git add -- …` を出す）
      — 2026-08-13 / 仕様 [commit-split](nimbus/docs/specs/commit-split.md)

- [x] T-109 カバレッジ差分（この変更で足した行のうち、テストで実行されていない行を名指しする）
      — 2026-08-13 / 仕様 [test-runner](nimbus/docs/specs/test-runner.md)
- [x] T-108 回帰の検知（前回通っていたテストが落ちたら、上限で切られる前に先頭で名指しする）
      — 2026-08-13 / 仕様 [test-runner](nimbus/docs/specs/test-runner.md)
- [x] T-102 編集 → 解析 → 再編集の自動ループ（T-101 の auto モード。lint の警告まで回す設定つき・回数上限あり）
      — 2026-08-13 / 仕様 [verify-edits](nimbus/docs/specs/verify-edits.md)
- [x] T-171 / T-172 エディタから直接頼む（右クリックと、関数の上のコードレンズ。説明／リファクタ／テスト／自由指示）
      — 2026-08-13 / 仕様 [editor-actions](nimbus/docs/specs/editor-actions.md)
- [x] T-175 型定義の自動添付（指示で名指しした API の実物のシグネチャを、送る前に見出しつきで添える）
      — 2026-08-13 / 仕様 [signature-attachment](nimbus/docs/specs/signature-attachment.md)

- [x] T-193 Widget / ゴールデンテストの生成（開いている Dart から widget の実引数を読み、
      `test/` の規約どおりの場所に雛形を作る）— 2026-08-13 / 仕様 [widget-tests](nimbus/docs/specs/widget-tests.md)

- [x] T-004 §6 の画面確認（6 項目を GUI テストのケースに起こし 13/13 通過。あわせて GUI テストが
      開発ビルドで動いていなかった不具合 2 件を修正）— 2026-08-13 / [f3-f6 §6](nimbus/docs/testing/f3-f6.md)

- [x] T-104 デバッガ連携（止まっている位置のコールスタックと変数の値を `mcp__nimbus_debug__*` で渡す。
      式の評価は入れない）— 2026-08-13 / 仕様 [debug-tools](nimbus/docs/specs/debug-tools.md)

- [x] T-099 シンボル単位の参照（`read_symbol` — その関数の本体だけを渡す）
      — 2026-08-13 / 仕様 [lsp-tools](nimbus/docs/specs/lsp-tools.md)
- [x] T-100 依存グラフの提示（`file_graph` — 読み込んでいる先／依存されている側を定義ジャンプと参照検索で解く）
      — 2026-08-13 / 仕様 [lsp-tools](nimbus/docs/specs/lsp-tools.md)

- [x] T-101 型情報による即時検証（編集の前後で診断を比べ、そのターンで増えたエラーだけを差し戻す）
      — 2026-08-13 / 仕様 [verify-edits](nimbus/docs/specs/verify-edits.md)

- [x] T-230 依存構造マトリクス（DSM）（IntelliJ 由来）— 2026-08-13 / 仕様 `nimbus/docs/specs/dependency-matrix.md` /
      確認 `nimbus/docs/testing/intellij-features.md`（画面確認は §2 が未実施）
- [x] T-229 構造検索・置換（SSR）（IntelliJ 由来）— 2026-08-13 / 仕様 `nimbus/docs/specs/structural-search.md` /
      確認 `nimbus/docs/testing/intellij-features.md`（画面確認は §2 が未実施）
- [x] T-231 Productivity Guide（IntelliJ 由来）— 2026-08-13 / 仕様 `nimbus/docs/specs/productivity-guide.md` /
      確認 `nimbus/docs/testing/intellij-features.md`（画面確認は §2 が未実施）
- [x] T-228 Command completion（ドットから IDE アクション）（IntelliJ 由来）— 2026-08-13 / 仕様 `nimbus/docs/specs/command-completion.md` /
      確認 `nimbus/docs/testing/intellij-features.md`（画面確認は §2 が未実施）
- [x] T-227 Run Anything（IntelliJ 由来）— 2026-08-13 / 仕様 `nimbus/docs/specs/run-anything.md` /
      確認 `nimbus/docs/testing/intellij-features.md`（画面確認は §2 が未実施）
- [x] T-226 ブックマーク（ニーモニック付き）（IntelliJ 由来）— 2026-08-13 / 仕様 `nimbus/docs/specs/bookmarks.md` /
      確認 `nimbus/docs/testing/intellij-features.md`（画面確認は §2 が未実施）
- [x] T-225 Search Everywhere（IntelliJ 由来）— 2026-08-13 / 仕様 `nimbus/docs/specs/search-everywhere.md` /
      確認 `nimbus/docs/testing/intellij-features.md`（画面確認は §2 が未実施）
- [x] T-224 マクロの記録・再生（IntelliJ 由来）— 2026-08-13 / 仕様 `nimbus/docs/specs/macros.md` /
      確認 `nimbus/docs/testing/intellij-features.md`（画面確認は §2 が未実施）
- [x] T-033 スクラッチファイル（IntelliJ 由来）— 2026-08-13 / 仕様 `nimbus/docs/specs/scratch-files.md` /
      確認 `nimbus/docs/testing/intellij-features.md`（画面確認は §2 が未実施）

- [x] T-039 テストランナー連携（Test Explorer の結果から落ちたテストの名前・場所・メッセージを
      1 クリックでセッションへ。CI 連携は T-131）— 2026-08-13 / 仕様 [test-runner](nimbus/docs/specs/test-runner.md)

- [x] T-113 hunk 単位の部分採用（変更を選んで採用・外したものは元のまま残る・Write / Edit / MultiEdit）
      — 2026-08-13 / 仕様 [approvals-and-diff](nimbus/docs/specs/approvals-and-diff.md)

- [x] T-169 ターミナル出力の自動キャプチャ（落ちたコマンドの出力を通知のボタン 1 つでセッションへ）
      — 2026-08-13 / 仕様 [terminal-capture](nimbus/docs/specs/terminal-capture.md)
- [x] T-098 LSP をエージェントのツールにする（定義・参照・型・アウトライン・シンボル検索・呼び出し階層・
      診断を `mcp__nimbus_lsp__*` として渡す）— 2026-08-13 / 仕様 [lsp-tools](nimbus/docs/specs/lsp-tools.md) /
      確認 [testing/lsp-tools](nimbus/docs/testing/lsp-tools.md)（画面確認 §2 は未実施）

- [x] T-008 / T-009 CLAUDE.md 専用のタブ（階層別の一覧・節単位で開く・ひな形から足す）— 2026-08-13 / 仕様 [claude-md](nimbus/docs/specs/claude-md.md) / GUI テスト `14-claude-md.mjs`
- [x] T-070 共有マーケット（入れる側）— 一覧は `https` に JSON を 1 枚置くだけ。サーバーも登録も要らない。
      `https` 以外は通さず、壊れた一覧は部分的に受け入れない。既定の一覧は空（推し先を作らない）
      — 2026-08-13 / 仕様 [market](nimbus/docs/specs/market.md)
- [x] T-055 声で指示する（手元で完結・確認なしに送らない）— 2026-08-13 / 仕様 [voice-input](nimbus/docs/specs/voice-input.md) / **書き起こしツールの実行確認は未実施**
- [x] T-070 スキルを配れる形にする（出す側。入れる側は別セッションの market）— 2026-08-13 / 仕様 [skill-package](nimbus/docs/specs/skill-package.md)
- [x] T-006 公証の手順とスクリプト（既定は ad-hoc のまま・明示時のみ公証）— 2026-08-13 / 仕様 [notarization](nimbus/docs/specs/notarization.md) / **実際の公証は証明書を持つ本人が実行**
- [x] T-223 作業の様子を GIF にする（枚数を先に見積もる・ffmpeg が無ければ手順を出す）— 2026-08-13 / 仕様 [gif-export](nimbus/docs/specs/gif-export.md)
- [x] T-032 プラグインを見る（有効／無効の切り替え・入れるのは別導線）— 2026-08-13 / 仕様 [plugins](nimbus/docs/specs/plugins.md)
- [x] T-014 ターミナルを好きな数に並べる（読める枚数で頭打ち・フォルダごとに 1 枚）— 2026-08-13 / 仕様 [terminal-layout](nimbus/docs/specs/terminal-layout.md)
- [x] T-128 計測結果を渡して重い箇所を調べる（直せる場所だけ出す）— 2026-08-13 / 仕様 [cpu-profile](nimbus/docs/specs/cpu-profile.md)
- [x] T-215 出す前に見る（止めるものと知らせるものを分ける）— 2026-08-13 / 仕様 [preflight](nimbus/docs/specs/preflight.md)
- [x] T-125 マイグレーションを起こす（壊す操作を先に・NOT NULL の落とし穴を指摘）— 2026-08-13 / 仕様 [schema-diff](nimbus/docs/specs/schema-diff.md)
- [x] T-132 CI を手元で再現する（環境の版を突き合わせ・CI 専用の行は落とす）— 2026-08-13 / 仕様 [ci-repro](nimbus/docs/specs/ci-repro.md)
- [x] T-126 / T-127 SQL を流す前に見る（何が起きるかを書く・DB には繋がない）— 2026-08-13 / 仕様 [sql-safety](nimbus/docs/specs/sql-safety.md)
- [x] T-121 脆弱性の警告を直す順に並べる（今日できるものを先に・--force は使わせない）— 2026-08-13 / 仕様 [vuln-fix](nimbus/docs/specs/vuln-fix.md)
- [x] T-118 依存を足す前に見る（良し悪しは決めない・事実だけ）— 2026-08-13 / 仕様 [dep-audit](nimbus/docs/specs/dep-audit.md)
- [x] T-205 環境の食い違い（パッチ違いで騒がない・どちらに合わせるかは言わない）— 2026-08-13 / 仕様 [env-check](nimbus/docs/specs/env-check.md)
- [x] T-203 / T-204 使い始めの設定（言語別プリセット・入るものを見せてから書く）— 2026-08-13 / 仕様 [setup](nimbus/docs/specs/setup.md)
- [x] T-061 Mermaid の図を確かめる（落ちる書き方を先に・描画はプレビューに任せる）— 2026-08-13 / 仕様 [mermaid](nimbus/docs/specs/mermaid.md)
- [x] T-206 セッションをたどり直す（間隔つき・止まっていた場所を先に）— 2026-08-13 / 仕様 [replay](nimbus/docs/specs/replay.md)
- [x] T-048 やり取りを人に見せる（伏せる内容を先に見せる・どこにも送らない）— 2026-08-13 / 仕様 [share-session](nimbus/docs/specs/share-session.md)
- [x] T-116 レビューコメントの取り込み（感想を依頼として扱わない・1 件ずつ渡す）— 2026-08-13 / 仕様 [review-comments](nimbus/docs/specs/review-comments.md)
- [x] T-045 何をしたかを並べ直す（理由は書かれたものだけ・推測で補わない）— 2026-08-13 / 仕様 [explain](nimbus/docs/specs/explain.md)
- [x] T-211 レビューを頼む文（読む順はテストから・テスト無しは自分から言う）— 2026-08-13 / 仕様 [pr-description](nimbus/docs/specs/pr-description.md)
- [x] T-214 やり取りの切り出し（切り出す時点で伏せる・保存しない）— 2026-08-13 / 仕様 [highlights](nimbus/docs/specs/highlights.md)
- [x] T-202 危ない書き方の検出（断定しない・当てられても困らない用途は拾わない）— 2026-08-13 / 仕様 [code-health](nimbus/docs/specs/code-health.md)
- [x] T-076 依存のライセンス（迷ったら分からないに倒す・合法判定はしない）— 2026-08-13 / 仕様 [licenses](nimbus/docs/specs/licenses.md)
- [x] T-066 詰まりやすい場所（件数で足切り・理由は推測しない）— 2026-08-13 / 仕様 [prompt-stats](nimbus/docs/specs/prompt-stats.md)
- [x] T-065 / T-067 指示の出しかた（言い直しの傾向・数が少ないうちは出さない）— 2026-08-13 / 仕様 [prompt-stats](nimbus/docs/specs/prompt-stats.md)
- [x] T-051 寝る前に仕込む（過ぎた時刻は翌日・承認で止まることを黙らない・常駐しない）— 2026-08-13 / 仕様 [schedule](nimbus/docs/specs/schedule.md)
- [x] T-046 / T-213 練習用サンドボックス（直すところがある状態で置く）— 2026-08-13 / 仕様 [sandbox](nimbus/docs/specs/sandbox.md)
- [x] T-218 / T-124 実物とスキーマの突き合わせと、仮の応答 — 2026-08-13 / 仕様 [api-check](nimbus/docs/specs/api-check.md)
- [x] T-122 スキーマから型を起こす（Dart / TypeScript・扱えないものは扱えないと書く）— 2026-08-13 / 仕様 [openapi](nimbus/docs/specs/openapi.md)
- [x] T-200 Platform Channel の突き合わせ（受け口の無い呼び出しを実機の前に見つける）— 2026-08-13 / 仕様 [platform-channel](nimbus/docs/specs/platform-channel.md)
- [x] T-089 / T-053 いまのようす（続けすぎの区切り・待ち時間の使い道）— 2026-08-13 / 仕様 [rhythm](nimbus/docs/specs/rhythm.md)
- [x] T-210 古くなっているコメントの検出（`@param` の食い違い・存在しない参照）— 2026-08-13 / 仕様 [code-health](nimbus/docs/specs/code-health.md)
- [x] T-160 レビューの進み（見たあとに変わったら見ていない扱いに戻す）— 2026-08-13 / 仕様 [review-progress](nimbus/docs/specs/review-progress.md)
- [x] T-198 依存の食い違い（pubspec と Podfile.lock の突き合わせ）— 2026-08-13 / 仕様 [dep-consistency](nimbus/docs/specs/dep-consistency.md)
- [x] T-199 Xcode プロジェクトの衝突を解く（両方残す・1 つでも怪しければ触らない）— 2026-08-13 / 仕様 [xcode-conflict](nimbus/docs/specs/xcode-conflict.md)
- [x] T-217 / T-129 ビルド時間と成果物の大きさを前回と比べる — 2026-08-13 / 仕様 [build-metrics](nimbus/docs/specs/build-metrics.md)
- [x] T-194 / T-195 Flutter の確認（直書きの文言・読み上げに渡らない画像・名前の無いボタン）— 2026-08-13 / 仕様 [flutter-lint](nimbus/docs/specs/flutter-lint.md)
- [x] T-196 / T-197 / T-201 提出前の確認（権限の差分・プライバシーマニフェスト・版）— 2026-08-13 / 仕様 [mobile-checks](nimbus/docs/specs/mobile-checks.md)
- [x] T-183 どこで壊れたかを絞り込む（残り回数を出す・git は勝手に動かさない）— 2026-08-13 / 仕様 [bisect](nimbus/docs/specs/bisect.md)
- [x] T-220 PR の説明文の下書き（意図は人が書く・テスト無しは警告）— 2026-08-13 / 仕様 [pr-description](nimbus/docs/specs/pr-description.md)
- [x] T-052 朝のダイジェスト（ふりかえりに「昨夜から」を追加）— 2026-08-13 / 仕様 [digest](nimbus/docs/specs/digest.md)
- [x] T-134 / T-219 ブランチの離れ具合と衝突の予告、命名規則の判定 — 2026-08-13 / 仕様 [branch-health](nimbus/docs/specs/branch-health.md)
- [x] T-136 / T-138 重いところの可視化と、層の逆流の検知（core/ は vscode に依存しない）— 2026-08-13 / 仕様 [code-health](nimbus/docs/specs/code-health.md)
- [x] T-112 使われていない export を挙げる（死骸と「export を外せるだけ」を分ける）— 2026-08-13 / 仕様 [code-health](nimbus/docs/specs/code-health.md)
- [x] T-178 / T-137 命名のゆれとそっくりな実装を見せる — 2026-08-13 / 仕様 [code-health](nimbus/docs/specs/code-health.md)
- [x] T-159 / T-082 変更のようす（統計と、テストが伴っていないときの指摘）— 2026-08-13 / 仕様 [change-stats](nimbus/docs/specs/change-stats.md)
- [x] T-062 リリースノートの下書きを履歴から作る（分類・迷ったらその他）— 2026-08-13 / 仕様 [release-notes](nimbus/docs/specs/release-notes.md)
- [x] T-096 連続稼働日数をふりかえりに出す — 2026-08-13 / 仕様 [digest](nimbus/docs/specs/digest.md)
- [x] T-105 スタックトレースから該当箇所を開く（Dart / JS・自分のコードの一番上を優先）— 2026-08-13 / 仕様 [stack-trace](nimbus/docs/specs/stack-trace.md)
- [x] T-119 ロックファイルの変更を読む（pubspec.lock / package-lock.json・メジャーを先頭に）— 2026-08-13 / 仕様 [lock-diff](nimbus/docs/specs/lock-diff.md)
- [x] T-207 / T-047 ふりかえり（週次ダイジェスト・成長ログ）— 2026-08-13 / 仕様 [digest](nimbus/docs/specs/digest.md)
- [x] T-155 読ませたくないファイルを画面から指定する（既定の可視化・取り込み・外すときの確認）— 2026-08-13 / 仕様 [protected-paths](nimbus/docs/specs/protected-paths.md)
- [x] T-234 何度も言っている指示を、その場で CLAUDE.md の「毎回の指示」に足せるようにする — 2026-08-13 / 仕様 [claude-md](nimbus/docs/specs/claude-md.md)
- [x] T-041 CLAUDE.md のメンテ支援（重複・空の節・長さの指摘＋何度も言っている指示の提示）— 2026-08-13 / 仕様 [claude-md](nimbus/docs/specs/claude-md.md)
- [x] T-021 文脈ビューの CLAUDE.md に出どころを添える（プロジェクト／親フォルダから継承／ユーザー設定）— 2026-08-13 / 仕様 [context-view](nimbus/docs/specs/context-view.md)
- [x] T-041（リンター部分）CLAUDE.md の重複・空の節・長さの指摘とトークン数表示 — 2026-08-13 / 仕様 [claude-md](nimbus/docs/specs/claude-md.md)

- [x] T-010 承認の横断キュー（全セッションの承認待ちを 1 ビューに集約・危険な順・キューモードで順に処理）
      — 2026-08-13 / 仕様 [approvals-and-diff](nimbus/docs/specs/approvals-and-diff.md)
- [x] T-038 インライン権限承認 UI（「今後この種類は常に許可」をルール化して `settings.json` へ保存）
      — 2026-08-13 / 仕様 [approvals-and-diff](nimbus/docs/specs/approvals-and-diff.md)

- [x] T-003 現行機能の仕様を書き起こす（セッション / 承認と差分 / 文脈 / 並列タスク / スキルとヘルプ /
      テーマ / 配布と追従の 6 本）— 2026-08-13 / [`nimbus/docs/specs/`](nimbus/docs/specs/README.md)

- [x] T-154 圧縮前に何を残すかを選ぶ（/compact への指示として渡す・選ばなければ従来どおり）— 2026-08-13 / 仕様 [context-control](nimbus/docs/specs/context-control.md)
- [x] T-232 サブエージェントごとのモデル指定（割り当てたものだけを差し替える）— 2026-08-13 / 仕様 [agent-models](nimbus/docs/specs/agent-models.md)
- [x] T-090 日本語プロンプトの補助（曖昧でも止めない・候補は決めつけない）— 2026-08-13 / 仕様 [japanese-and-history](nimbus/docs/specs/japanese-and-history.md)
- [x] T-095 設定のバージョン管理（同じ中身は足さない・何行変わったかを出す）— 2026-08-13 / 仕様 [japanese-and-history](nimbus/docs/specs/japanese-and-history.md)
- [x] T-097 今週のふりかえり（盛らない・無かったものは書かない）— 2026-08-13 / 仕様 [japanese-and-history](nimbus/docs/specs/japanese-and-history.md)
- [x] T-071 設定のワンクリック導入（https だけ・押しただけで入らない）— 2026-08-13 / 仕様 [migration-and-crashlog](nimbus/docs/specs/migration-and-crashlog.md)
- [x] T-074 実機ログの取り込み（自分のコードのフレームだけ先に出す）— 2026-08-13 / 仕様 [migration-and-crashlog](nimbus/docs/specs/migration-and-crashlog.md)
- [x] T-077 ローカル完結モード（何が止まらないかを必ず見せる）— 2026-08-13 / 仕様 [local-and-recovery](nimbus/docs/specs/local-and-recovery.md)
- [x] T-087 集中モード（完了通知は黙らせ、承認待ちは通す。T-019 との衝突をここで決着）— 2026-08-13 / 仕様 [local-and-recovery](nimbus/docs/specs/local-and-recovery.md)
- [x] T-088 失敗時のリカバリ提案（勝手に戻さない・理由を必ず添える）— 2026-08-13 / 仕様 [local-and-recovery](nimbus/docs/specs/local-and-recovery.md)
- [x] T-063 ペルソナ設定（既定は「そのまま」・ゆあでも正確さは崩さない）— 2026-08-13 / 仕様 [persona-and-turns](nimbus/docs/specs/persona-and-turns.md)
- [x] T-064 テーマ連動（止まっている状態だけ色を変える・新しい配色は足さない）— 2026-08-13 / 仕様 [persona-and-turns](nimbus/docs/specs/persona-and-turns.md)
- [x] T-190 交代モード（私が書く番では提案もさせない）— 2026-08-13 / 仕様 [persona-and-turns](nimbus/docs/specs/persona-and-turns.md)
- [x] T-191 肩越しモード（好みの問題には口を出させない）— 2026-08-13 / 仕様 [persona-and-turns](nimbus/docs/specs/persona-and-turns.md)
- [x] T-030 フロントマター補完つきエディタ（既に書いたキーは出さない・足りないものを名指し）— 2026-08-13 / 仕様 [authoring](nimbus/docs/specs/authoring.md)
- [x] T-031 プレビュー実行（plan モードの使い捨てセッション・読み込まれない状態では走らせない）— 2026-08-13 / 仕様 [authoring](nimbus/docs/specs/authoring.md)
- [x] T-165 自作スキルの回帰テスト（部分点を付けない）— 2026-08-13 / 仕様 [evaluation](nimbus/docs/specs/evaluation.md)
- [x] T-166 ブレ幅の測定（合格率だけでなく応答の振れも見る）— 2026-08-13 / 仕様 [evaluation](nimbus/docs/specs/evaluation.md)
- [x] T-167 モデル切り替えの比較（通っていないモデルを安いと勧めない）— 2026-08-13 / 仕様 [evaluation](nimbus/docs/specs/evaluation.md)
- [x] T-045 解説モード（何をしたかではなく、なぜそうしたかを 1 行で添えさせる）— 2026-08-13 / 仕様 [workflow-and-team](nimbus/docs/specs/workflow-and-team.md)
- [x] T-049 チーム設定の同期（リポジトリの配布物との差分を知らせる）— 2026-08-13 / 仕様 [workflow-and-team](nimbus/docs/specs/workflow-and-team.md)
- [x] T-149 複数ステップのワークフロー定義（自動では進めない・位置を必ず出す）— 2026-08-13 / 仕様 [workflow-and-team](nimbus/docs/specs/workflow-and-team.md)
- [x] T-187 見積もり表示（予測ではなく、直近 5 ターンの中央値）— 2026-08-13 / 仕様 [dialogue](nimbus/docs/specs/dialogue.md)
- [x] T-188 選択肢の比較表（「まだ変更しないで」を型に入れる）— 2026-08-13 / 仕様 [dialogue](nimbus/docs/specs/dialogue.md)
- [x] T-189 意見の相違の記録（どちらが正しいかを決めつけさせない）— 2026-08-13 / 仕様 [dialogue](nimbus/docs/specs/dialogue.md)
- [x] T-015 デバッグモード（生イベントの時系列ビューア）— 2026-08-13 / 仕様 [audit-and-timeline](nimbus/docs/specs/audit-and-timeline.md)
- [x] T-050 監査ログ（日付ごとの JSONL・サニタイズしてから書く）— 2026-08-13 / 仕様 [audit-and-timeline](nimbus/docs/specs/audit-and-timeline.md)
- [x] T-056 アンビエント表示（走っている間だけ、いまのツールを視界の端に）— 2026-08-13 / 仕様 [audit-and-timeline](nimbus/docs/specs/audit-and-timeline.md)
- [x] T-184 ログの時系列ビューア（T-015 と同じ面に統合）— 2026-08-13 / 仕様 [audit-and-timeline](nimbus/docs/specs/audit-and-timeline.md)
- [x] T-016 アクティビティバーに設定タブ（いま効いている値を 1 か所に）— 2026-08-13 / 仕様 [settings-and-bundle](nimbus/docs/specs/settings-and-bundle.md)
- [x] T-043 設定のパッケージ配布（JSON 1 枚・秘匿を弾き、上書きは必ず聞く）— 2026-08-13 / 仕様 [settings-and-bundle](nimbus/docs/specs/settings-and-bundle.md)
- [x] T-162 承認ポリシーのプロファイル切り替え（広げるときだけ確認する）— 2026-08-13 / 仕様 [hooks](nimbus/docs/specs/hooks.md)
- [x] T-163 実行サンドボックス・ネットワーク遮断（SDK の sandbox で外に出さない）— 2026-08-13 / 仕様 [hooks](nimbus/docs/specs/hooks.md)
- [x] T-026 Hooks の GUI ビルダー（イベントは 31 種類・よく使う 5 つを前面に）— 2026-08-13 / 仕様 [hooks](nimbus/docs/specs/hooks.md)
- [x] T-044 ターミナルの Shift+Enter を改行に（出荷時から ESC+CR を送る）— 2026-08-13 / 仕様 [hooks](nimbus/docs/specs/hooks.md)
- [x] T-161 フックのドライラン（本番と同じ形の入力で、止まるかを先に確かめる）— 2026-08-13 / 仕様 [hooks](nimbus/docs/specs/hooks.md)
- [x] T-147 タスクのピン留めとタグ（板の並びと絞り込みの判定）— 2026-08-13 / 仕様 [session-extras](nimbus/docs/specs/session-extras.md)
- [x] T-151 送れなかった入力の預かり（繋がらない失敗だけ・自動では送らない）— 2026-08-13 / 仕様 [session-extras](nimbus/docs/specs/session-extras.md)
- [x] T-168 セッション → スキル化（骨格まで書き、確かめていないことは書かない）— 2026-08-13 / 仕様 [session-extras](nimbus/docs/specs/session-extras.md)
- [x] T-035 プロンプトライブラリ（変数つきテンプレ・埋め残しは残して知らせる）— 2026-08-13 / 仕様 [prompts-and-find](nimbus/docs/specs/prompts-and-find.md)
- [x] T-117 スキル以外も同じ場所から探せる（コマンド・サブエージェント・MCP ツール・定型）— 2026-08-13 / 仕様 [prompts-and-find](nimbus/docs/specs/prompts-and-find.md)
- [x] T-236 ツリービューの共通土台（4 ビューすべてを載せ替え・ツール入力の取り出しも共通化）— 2026-08-13 / 仕様 [tree-views](nimbus/docs/specs/tree-views.md)
- [x] T-013 tasks.md とタスク板の対応づけ（定義行から着手・完了で行ごと移す）— 2026-08-13 / 仕様 [tasks-board-link](nimbus/docs/specs/tasks-board-link.md)
- [x] T-233 タスクキューの優先度（高／中／低・同じなら作った順）— 2026-08-13 / 仕様 [tasks-board-link](nimbus/docs/specs/tasks-board-link.md)
- [x] T-036 セッションの分岐（同じ地点から A 案・B 案をタスクとして並列に）— 2026-08-13 / 仕様 [session-lifecycle](nimbus/docs/specs/session-lifecycle.md)
- [x] T-148 セッションテンプレート（調査／実装／レビューを同梱・{input} 展開）— 2026-08-13 / 仕様 [session-lifecycle](nimbus/docs/specs/session-lifecycle.md)
- [x] T-150 セッションの復元（Claude Code の記録から再開。自前バックアップは持たない）— 2026-08-13 / 仕様 [session-lifecycle](nimbus/docs/specs/session-lifecycle.md)
- [x] T-011 同じファイルを触っているセッションの検出（書く前に知らせる・読みと書きを区別）— 2026-08-13 / 仕様 [parallel-awareness](nimbus/docs/specs/parallel-awareness.md)
- [x] T-012 いま誰が何をしているかの俯瞰（並列時だけ「他のセッション」を出す）— 2026-08-13 / 仕様 [parallel-awareness](nimbus/docs/specs/parallel-awareness.md)
- [x] T-152 コンテキストのピン留め（常に含めるファイル・上限つき・preset に append）— 2026-08-13 / 仕様 [context-control](nimbus/docs/specs/context-control.md)
- [x] T-153 コンテキスト予算の割り当て（8 割で警告・超過で圧縮を促す・止めない）— 2026-08-13 / 仕様 [context-control](nimbus/docs/specs/context-control.md)
- [x] T-156 コンテキスト効率のスコア表示（読み直しの重複だけを数える）— 2026-08-13 / 仕様 [context-control](nimbus/docs/specs/context-control.md)
- [x] T-040 画像・スクショのドロップ投入（貼り付け／ドロップ・中身で種類を判定）— 2026-08-13 / 仕様 [images-and-hot-reload](nimbus/docs/specs/images-and-hot-reload.md)
- [x] T-072 ホットリロード連携（直す→リロード→スクショ→自分で見る。上限つき・既定オフ）— 2026-08-13 / 仕様 [images-and-hot-reload](nimbus/docs/specs/images-and-hot-reload.md)
- [x] T-081 証跡つき完了報告（テスト実行の有無と成否を機械で拾い、報告に添える）— 2026-08-13 / 仕様 [completion-evidence](nimbus/docs/specs/completion-evidence.md)
- [x] T-024 「この修正はどの指示から生まれたか」の紐づけ（指示ごとに修正と読んだファイルをまとめる）— 2026-08-13 / 仕様 [session-activity](nimbus/docs/specs/session-activity.md)
- [x] T-192 思考中の可視化（走っているツールと対象を「セッションの中身」の先頭に出す）— 2026-08-13 / 仕様 [session-activity](nimbus/docs/specs/session-activity.md)
- [x] T-025 チェックポイントのタイムライン UI（戻す先を選び、変更内容を見てから戻す）— 2026-08-13 / 仕様 [checkpoints-and-mcp](nimbus/docs/specs/checkpoints-and-mcp.md)
- [x] T-029 MCP サーバーの接続管理（状態・エラー・繋ぎ直し・有効無効）— 2026-08-13 / 仕様 [checkpoints-and-mcp](nimbus/docs/specs/checkpoints-and-mcp.md)
- [x] T-034 過去セッションの横断検索（`~/.claude/projects/**` を読む・`file:` `tool:` で絞り込み）— 2026-08-13 / 仕様 [transcript-search](nimbus/docs/specs/transcript-search.md)
- [x] T-042 MCP ツールエクスプローラ（一覧・説明・破壊的かどうか。単体実行は T-235 へ分割）— 2026-08-13 / 仕様 [checkpoints-and-mcp](nimbus/docs/specs/checkpoints-and-mcp.md)
- [x] T-018 サブエージェントのツリー可視化（指示・種別・消費・状態・まとめ）— 2026-08-13 / 仕様 [session-activity](nimbus/docs/specs/session-activity.md)
- [x] T-019 完了通知（ターン完了と承認待ちを OS 通知・裏にいるときだけ）— 2026-08-13 / 仕様 [session-activity](nimbus/docs/specs/session-activity.md)
- [x] T-022 コンパクションの可視化（発生の記録と手動実行 `nimbus.compact`）— 2026-08-13 / 仕様 [session-activity](nimbus/docs/specs/session-activity.md)
- [x] T-023 読み込まれたファイル一覧（読み／書きを分けて数え、クリックで開く）— 2026-08-13 / 仕様 [session-activity](nimbus/docs/specs/session-activity.md)
- [x] T-027 フック発火ログのビューア（結果・終了コード・stderr まで）— 2026-08-13 / 仕様 [session-activity](nimbus/docs/specs/session-activity.md)
- [x] T-017 使用量を常時表示（5 時間・週の枠を SDK から取得。自前積算は不要と判明）— 2026-08-13 / 仕様 [usage](nimbus/docs/specs/usage.md)
- [x] T-020 トークン消費量のリアルタイムバー（文脈の消費率をステータスバーに常時表示）— 2026-08-13 / 仕様 [usage](nimbus/docs/specs/usage.md)
- [x] T-037 コスト・使用量ダッシュボード（「使用量」ビュー・週の枠は対話とアプリ経由で分ける）— 2026-08-13 / 仕様 [usage](nimbus/docs/specs/usage.md)
- [x] T-059 コスト上限アラート（上限の 80% で警告・超過で停止ボタンを添える）— 2026-08-13 / 仕様 [usage](nimbus/docs/specs/usage.md)
- [x] T-057 暴走の緊急停止（全セッションを一括停止・待機タスクの自動開始も止める）— 2026-08-13 / 仕様 [safety](nimbus/docs/specs/safety.md)
- [x] T-058 危険操作の事前検知（`rm -rf` / 強制 push / 本番反映などを承認前に名指しする）— 2026-08-13 / 仕様 [safety](nimbus/docs/specs/safety.md)
- [x] T-075 送信前マスキング（プロンプト送信の直前に資格情報を検出して止める）— 2026-08-13 / 仕様 [safety](nimbus/docs/specs/safety.md)
- [x] T-120 ビルド設定の変更検知（Gradle / Xcode / CI 設定への書き込みを注意扱いにする）— 2026-08-13 / 仕様 [safety](nimbus/docs/specs/safety.md)
- [x] T-164 秘匿ファイルの読み取り禁止（`.env`・秘密鍵などを承認を求めず拒否）— 2026-08-13 / 仕様 [safety](nimbus/docs/specs/safety.md)
- [x] T-001 Nimbus 独自テーマ（Nimbus Dark / Nimbus Light・Claude を思わせる配色）— 2026-08-13 / `df49e981c80`
- [x] F6 スキル検索・ヘルプ（ゆあ）— 2026-08-12 / `nimbus/docs/testing/f3-f6.md` §4
- [x] F5 配布と upstream 追従の運用 — 2026-08-12 / `nimbus/docs/testing/f3-f6.md` §5
- [x] F4 並列タスク（worktree × カンバン）— 2026-08-12 / `nimbus/docs/testing/f3-f6.md` §3
- [x] F3 承認前の差分・文脈可視化・課金モード表示 — 2026-08-12 / `nimbus/docs/testing/f3-f6.md` §2
- [x] F2 組み込み拡張への移植と実 Claude セッションの疎通 — 2026-08-12 / `nimbus/docs/testing/f2-extension.md`
- [x] F1 フォークが Nimbus として起動し、Open VSX から拡張を入れられる — 2026-08-12 / `nimbus/docs/testing/f1-fork-build.md`
- [x] F0 調査と方針決定（ライセンス・商標・Marketplace・ビルド前提）— 2026-08-12 / `nimbus/docs/history/vscode-fork-migration.md`
- [x] T-145 ドクター（不要ファイル・宣言と実装のズレ・台帳の記載漏れを機械で洗い出す）— 2026-08-13 / `node nimbus/scripts/doctor.mjs` / 仕様 [quality-commands](nimbus/docs/specs/quality-commands.md)
- [x] T-146 テストコマンド（モジュールテスト＋GUI 操作テスト）— 2026-08-13 / `bash nimbus/scripts/test.sh` / スキル `nimbus-doctor` `spec-drift` `nimbus-test`
- [x] T-234 重複検出とリファクタリング用スキル、テスト雛形の自動生成 — 2026-08-13 / `doctor.mjs duplication|coverage` / `scaffold-test.mjs` / スキル `refactor` `write-tests`
- [x] T-002 `localize()` の "VS Code" 直書き 152 箇所 — 2026-08-13 / nls の集約点（`_format`）で置換。1 ファイルの変更で全部に効き、upstream の新しい文言にも追随する
- [x] T-005 Copilot をソースとビルドスクリプトからも除去 — 2026-08-13 / `extensions/copilot/`（4193 ファイル・1.8GB）を削除し、npm スクリプトとビルド配線からも外した。**依存 `@github/copilot-sdk` `@vscode/copilot-api` はコアの agent host が使うため残す**（台帳に理由を記載）
- [x] T-185 着手前の確認強制（曖昧な指示を走らせる前に止める）— 2026-08-13 / 仕様 [pre-send-confirmation](nimbus/docs/specs/pre-send-confirmation.md) / 判定は `src/core/clarify.ts`・テスト 12 件
- [x] T-186 前提・仮定のリスト表示 — 2026-08-13 / 仕様 [assumptions](nimbus/docs/specs/assumptions.md) / 抽出は `src/core/assumptions.ts`・テスト 12 件
- [x] T-239 サイドバーの整理（13 ビュー → 常用 5 段＋ヘルプ／診断は下部パネル／たまに使うものはコマンド）— 2026-08-13 / 仕様 [views-layout](nimbus/docs/specs/views-layout.md)
- [x] T-241 **フォルダを開くと Nimbus が消える** — 信頼していないフォルダで拡張ごと無効化されていた（`untrustedWorkspaces.supported: false`）。画面は開いたまま、実行の入口で信頼を求める形に変更 — 2026-08-13 / 仕様 [workspace-trust](nimbus/docs/specs/workspace-trust.md)
- [x] T-242 人間工学のスキルを足す（`design-philosophy` が見ない「操作の負担」を、手数・距離・モード・記憶・持続の
      5 原則で数える）— 2026-08-18 / `.agents/skills/ergonomics/SKILL.md`。
      公式（Anthropic）に人間工学のスキルは無く、upstream の `accessibility` は「到達**できるか**」までなので、
      「到達に**何手かかるか**」を Nimbus 側の横断レイヤーとして足した。upstream の `.github/skills/` は触っていない
- [x] T-243 スキル / CLAUDE.md / 設定 を常用サイドバーの外へ出す（アクティビティバーに 2 つめのコンテナ
      「Nimbus 設定」を新設）— 2026-08-18 / 仕様 [views-layout](nimbus/docs/specs/views-layout.md)。
      T-239 で `visibility: hidden` にしたが、**コマンドで一度開くと段として居座り、常用 5 段の枠を食い直していた**。
      置き場所を変えただけで `extension.ts` は無変更（ビュー ID は同じ）。アイコンは雲＋歯車で家族を保つ
- [x] T-244 **設定タブが丸ごと飾りだった** — 行を押しても何も起きない。`actionNode()` がコマンド名を
      受け取りながら `TreeItem.command` を設定しておらず、土台の `TreeNode` にコマンドの口が無かった。
      仕様には「押すと切り替え」と書いてあったのに 1 行も押せない状態が続いた — 2026-08-18 /
      仕様 [settings-and-bundle](nimbus/docs/specs/settings-and-bundle.md)。
      **受け入れ条件が「並ぶ」だったのが原因**。GUI ケース 37 で「押して、開くところまで」を見るようにした
- [x] T-245 表示言語の既定を日本語にする（コアの `getUserDefinedLocale()` ＋ 言語パックの同梱）—
      2026-08-18 / 仕様 [display-language](nimbus/docs/specs/display-language.md)。
      真っさらな設定では 1 回目だけ英語（言語パックの所在が書かれるのが拡張の走査後のため）。
      `--locale en` は今までどおり効く。GUI ケース 38 で実際に起ち上げて画面の文字を読む
- [x] T-246 VS Code 標準のデバッグをアクティビティバーから外す（Claude 用を用意するまでの措置）—
      2026-08-18 / 仕様 [views-layout](nimbus/docs/specs/views-layout.md) / コア台帳 #24。
      **登録は消していない** — 消すとビューの登録先ごと無くなり F5 や `openPaneComposite` まで
      巻き添えになる。バーがコンテナを引く 2 つの口で除くだけなので、戻すのは 1 行
