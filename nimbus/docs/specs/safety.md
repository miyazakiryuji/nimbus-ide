# 安全（緊急停止・危険操作の検知・秘匿ファイル・送信前検査）

## 何を解決するのか

エージェントは待ってくれない。気づいたときには `rm -rf` が走っていた、`.env` が読まれていた、
API キーごとプロンプトを送っていた — この 3 つは**起きてからでは戻せない**。
承認ダイアログは「ツールを実行しようとしています」としか言わないので、`ls` と `rm -rf` が
同じ見た目で並ぶ。危ないものを危ないと**名指し**し、取り返しがつかないものは先に断る。

対応する tasks.md の項目: T-057（暴走の緊急停止）/ T-058（危険操作の事前検知）/
T-075（送信前マスキング）/ T-120（ビルド設定の変更検知）/ T-164（秘匿ファイルの読み取り禁止）。

## 振る舞い

### 1. 緊急停止（T-057）

- コマンド **「Nimbus: すべてのセッションを止める（緊急停止）」**（`nimbus.stopAll`）
- 動いているセッションがある間だけ、**ステータスバーに `■ 停止` が出る**（2 件以上なら件数付き）。
  コマンドパレットを開く余裕が無いときに押すものなので、押せる状態のときだけ見せる
- 押すと確認モーダル → 承認すると、走っている全セッションに中断を投げてから入力を閉じる。
  中断の返事は 1 セッションあたり最大 3 秒待つ（返らないセッションで全体を止めないため）
- **待機中タスクの自動開始も止める。** 止めた直後に待機列の次が走り出したら、止めた意味が無い。
  タスクの ▶ を押すと自動開始も一緒に戻る（＝再開の意思表示）
- **worktree と未コミットの変更には触らない。** 止めることと捨てることは別
- 停止後にコックピットへ文を打つと、新しいセッションとして開始する

### 2. 危険操作の事前検知（T-058・T-120）

承認を求める前に危険度を 3 段階で判定し、モーダルの見出しを変える。

| 段階 | 見出し | 「このセッションでは常に許可」 |
| --- | --- | --- |
| `normal` | Claude がツールを実行しようとしています | 出す |
| `caution` | 注意が要る操作です — 理由 | 出す |
| `danger` | ⚠️ 取り返しがつかない操作です — 理由 | **出さない** |

- **`danger` は自動許可を素通りしない。** `nimbus.permissions.autoApproveReadOnly` も
  「このセッションでは常に許可」も、`danger` には効かない。一度きりの判断として毎回聞く
- 理由は必ず言葉で出す（「危険です」だけでは判断できない）。複数当たったら全部並べる
- `danger` の例: `rm -rf`（フラグの並び順・分割・ロング形式すべて）/ `sudo` / `git push --force` /
  `git reset --hard` / `git checkout -- ` / `git clean -fd` / `dd of=/dev/…` / `mkfs` / `chmod 777` /
  `curl … | sh` / fork bomb / `shutdown` / `DROP TABLE` / 本番反映（`firebase deploy` 等）/
  パッケージ公開（`npm publish` 等）/ `/etc`・`~/.ssh`・`~/.aws` への書き込み
- `caution` の例: ふつうの `rm` / `git push --force-with-lease` / `git stash` / ブランチ削除 /
  再帰的な `chmod`・`chown` / `killall` / `docker system prune` /
  **ビルド設定ファイルへの書き込み**（`build.gradle` / `*.pbxproj` / `Podfile` / `Dockerfile` /
  `.github/workflows/*.yml` など。T-120）

### 3. 秘匿ファイルの読み取り禁止（T-164）

- `Read` / `NotebookRead`、および **`cat` `cp` `grep` などで覗く `Bash`** が対象。
  承認を求めず**その場で拒否**し、通知で理由を出す。「許可」を押し間違える余地を残さない
- 書き込み（`echo … >> .env`）は止めない。読み取り自体を止めるのが目的で、開発の邪魔はしない
- 既定の対象: `.env` と `.env.*` / `*.pem` `*.key` `*.p12` `*.pfx` `*.keystore` `*.jks` /
  `*.mobileprovision` / `id_rsa` などの鍵 / `~/.ssh/**` `~/.gnupg/**` / `.aws/credentials` /
  `.npmrc` `.netrc` `.pgpass` / `secrets.json` / `serviceAccount*.json`
- **雛形は通す** — `.env.example` `.env.sample` `.env.template` `.env.defaults`
- 設定 `nimbus.safety.protectedPaths`（glob の配列）で置き換えられる。先頭 `!` は除外規則。
  空配列のときは既定の一覧を使う（設定ミスで丸腰にしないため）
- 設定 `nimbus.safety.blockProtectedReads` を `false` にすると、この遮断ごと切れる

### 4. 送信前検査（T-075）

- コックピットと「ゆあに聞く」の**送信直前**に、資格情報らしき文字列を検査する
- 見つかったら「マスクして送信 / そのまま送信」を聞く。**Esc は取りやめ**（答えなかったものを送信に倒さない）
- 見つけたものは種類と先頭 6 文字だけ見せる（値そのものは画面にも出さない）
- 「マスクして送信」は資格情報だけを伏せる。**ホームパスは残す** —
  ログ向けの `sanitizeString` はパスを `~` にするが、プロンプトでそれをやると渡す情報が変わる
- 対象: Anthropic / OpenAI 系キー・AWS アクセスキー・GitHub トークン・Slack トークン・
  Google API キー・Stripe キー・Bearer トークン・JWT・秘密鍵ブロック・
  **機密らしい名前の環境変数の値そのもの**（`*KEY` `*TOKEN` `*SECRET` `*PASSWORD` など）
- 設定 `nimbus.safety.scanBeforeSend` で切れる

## 設計

- `extensions/nimbus/src/core/risk.ts` — 危険度の判定表。VS Code に依存しない
- `extensions/nimbus/src/core/secrets.ts` — 秘匿パスの glob 判定と読み取り経路の検出。
  minimatch は持ち込まず、`**` / `*` / `?` だけの変換を自前で持つ（それ以上の表現力が要らないため）
- `extensions/nimbus/src/sanitizer.ts` — 検出規則の本体。ログ向けの `sanitizeString` と
  プロンプト向けの `maskSecrets`、検出だけの `detect` が同じ規則表を共有する
- `extensions/nimbus/src/permissions.ts` — 遮断 → 危険度 → 自動許可 → 差分 → モーダルの順に効かせる。
  **遮断と危険度を自動許可より先に置く**のが肝（後ろに置くと「常に許可」で素通りする）
- `extensions/nimbus/src/session/SessionManager.ts` — `stopAll()` と `isAccepting()`
- `extensions/nimbus/src/tasks/TaskService.ts` — `pauseAutoStart()`
- `extensions/nimbus/src/extension.ts` — コマンド・ステータスバー・送信前検査の呼び出し

コアには触っていない（`core-changes.md` への追記は不要）。

## 受け入れ条件

- [x] `rm -rf` をフラグの書き方 5 通りで danger と判定する（単体テスト）
- [x] ふつうの `git status` / `ls` を normal のままにする＝何でも危険にしない（単体テスト）
- [x] `danger` では「このセッションでは常に許可」を出さない（実装・要画面確認）
- [x] `.env` を Read / `cat` で読もうとすると拒否し、`.env.example` は通す（単体テスト）
- [x] `echo >> .env` は止めない（単体テスト）
- [x] 送信前検査が資格情報を見つけ、値そのものを画面に出さない（単体テスト）
- [x] マスクしてもホームパスは残る（単体テスト）
- [x] 画面確認: **動いていないときに停止ボタンが出ていない**（GUI テスト `17-status-bar-stop`。動作中の表示は実セッションが要るので未実施）
- [ ] 画面確認: 緊急停止で全セッションが止まり、待機タスクが走り出さない
- [ ] 画面確認: 停止後にコックピットへ打つと新しいセッションとして始まる

## 決めなかったこと・やらないこと

- **顧客データ（氏名・住所・カード番号）の検出はしない。** 誤検知が多すぎて「また出た」と
  読み飛ばされるようになる。読み飛ばされる警告は無いのと同じ。資格情報のように
  形が決まっているものだけを対象にする
- **`danger` を自動拒否にはしない。** 開発では `git reset --hard` も `rm -rf node_modules` も
  正当に必要になる。止めるのではなく、**何が起きるかを言ってから聞く**
- **`sanitizeString` の既定の振る舞いは変えていない。** ログ向けの経路は従来どおり
  ホームパスも伏せる。送信向けは別関数（`maskSecrets`）として足した
- 承認の横断キュー（T-010）・インライン承認 UI（T-038）はここには含めない。
  `PendingApproval` に危険度を持たせるところまでを先に済ませてある
