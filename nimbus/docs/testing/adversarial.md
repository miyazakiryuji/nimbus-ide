# 敵対的試験（T-345）

**タスク**: T-345 / **走らせるもの**: `node nimbus/tests/gui/run.mjs --packaged --adversarial` /
**ケース**: `nimbus/tests/gui/cases/adv-*.mjs` / **仕様**: 各節の「根拠」に挙げたファイル

> **この紙は「何を叩くか」の台帳です。** やりかた（観点の出しかた・ケースを書く掟・
> 落ちた赤の切り分け・退行と環境要因の A/B・Codex を第二の目として使う手順）は
> [`adversarial-test` スキル](../../../.agents/skills/adversarial-test/SKILL.md) にあります。
> **ケースを足す前にそちらを読んでください。**

## 1. なぜやるか

総合試験は「決めた道を通ると、決めたとおりに動く」ことしか見ない。壊れるのはいつも決めていない道
—— 前のケースが残した面、押してはいけない順番、型が違う 1 バイト、無いはずの空、極端な寸法 —— で、
そこは緑のまま素通りする。だから**わざと外れた使いかたをする束**を別に持ち、決めていない場所を毎回叩く。

## 2. 走らせかた

敵対的ケースは**既定の全件に混ぜない。** わざと壊しにいく束なので、混ぜると「普段の緑」が読めなくなり、
並行して走っている他のセッションの判断材料を汚す。`--adversarial` を付けたときだけ、その束**だけ**が走る
（`run.mjs:167-169` の `Boolean(c.adversarial) === flag('adversarial')`）。

```bash
bash nimbus/scripts/package-app.sh --copy /tmp/nimbus-gui-app          # 固めて写しを作る
NIMBUS_APP=/tmp/nimbus-gui-app/Nimbus.app \
  node nimbus/tests/gui/run.mjs --packaged --adversarial               # 敵対束（全 16 本）
NIMBUS_APP=/tmp/nimbus-gui-app/Nimbus.app \
  node nimbus/tests/gui/run.mjs --packaged --adversarial --only adv-05 # 1 本だけ
```

ケース側は `export default { name: '…', adversarial: true, async run(page, ctx) { … } }`。
`adversarial: true` を**付け忘れると既定の全件に混ざる**。これが唯一の分岐なので、最初に書く。

### 敵対束の共通の作法

- **ネイティブのモーダルを出さない。** `#attach`（`showOpenDialog`）・準備カードの `.readiness-action`
  （先頭が `nimbus.locateClaude`）・走行中セッションのタブの `×`（`{ modal: true }`）・
  「別のマシンから続きを入れる / 持ち運べる形にする」・未保存の無題エディタを閉じる操作には**触れない**。
  出た瞬間に以後の全操作が固まり、束が丸ごと死ぬ。
- **後始末は `try { … } finally { … }`。** 敵対ケースは落ちるのが目的なので、`ctx.expect` の後ろに
  書いた後始末は**実行されない**。置いたファイル・開いたタブ・広げた幅・添付・全画面は finally で戻す。
- **絶対数を数えない。** 「札が 1 枚」「タブが 0 枚」は束の並び次第で崩れる（T-240 / T-340 の形）。
  自分が置いたものを**名前で探して**判定する。
- **触ってよいのは `ctx.workspace` と `ctx.userDataDir` の下だけ。** 利用者の実データには一切触れない。
- **1 ケース 60 秒以内。** `runCommand` は再試行込みで最悪 8 秒近い。押す回数を数えて設計する。
- **落ちても次を巻き込まない。** 画面の状態（サイドバーの可視・幅・タブ・焦点）を戻してから終わる。
  焦点戻しは `.part.statusbar` の位置指定クリック（`.part.activitybar` の中心はアイコンに当たる）。
- **課金しない。** Enter・送信ボタン・「開始」「worktree を開く」「完了」は押さない。
  実セッションが要る主張は書かない（既定は `ctx.withClaude` が偽）。

### 走る順番（ファイル名順）

`run.mjs` は `cases/*.mjs` をファイル名順に読み、**1 つの Electron を全ケースで共有**する。
番号は「後始末が確実なもの → 画面を大きく動かすもの」の順に振ってある。とくに全画面は
内部フラグ（`cockpitFullscreen`）が `resetWorkbench` で戻らないので**必ず最後**。

| ファイル | 観点 | 触る面 | 目安 |
| --- | --- | --- | --- |
| `adv-01-ledger-garbage.mjs` | 壊れた記録 | クイックピック | 12s |
| `adv-02-settings-rule-types.mjs` | 壊れた記録 | クイックピック | 15s |
| `adv-03-board-name-html.mjs` | 敵意のある入力 | 板（サイドバー） | 30s |
| `adv-04-board-name-long.mjs` | 敵意のある入力 | 板（サイドバー） | 30s |
| `adv-05-board-phantom-count.mjs` | 壊れた記録 | 板（タブ） | 35s |
| `adv-06-forget-burst.mjs` | 速さと競合 | 板（タブ） | 25s |
| `adv-07-missing-claude-binary.mjs` | 空と欠け | 通知・ステータスバー | 20s |
| `adv-08-unreadable-settings.mjs` | 空と欠け | クイックピック | 25s |
| `adv-09-empty-repo.mjs` | 空と欠け | 通知 | 25s |
| `adv-10-attach-filename.mjs` | 敵意のある入力 | コックピット | 25s |
| `adv-11-history-2000-turns.mjs` | 量 | コックピット | 45s |
| `adv-12-home-crosstalk.mjs` | 順番と持ち越し | コックピット 2 面 | 35s |
| `adv-13-rail-keyboard.mjs` | 寸法の極端 | 列の境目 | 25s |
| `adv-14-narrow-sidebar.mjs` | 寸法の極端 | サイドバーの境目 | 25s |
| `adv-15-fullscreen-burst.mjs` | 速さと競合 | 全画面 | 30s |
| `adv-16-fullscreen-restore.mjs` | 順番と持ち越し／寸法 | 全画面 | 30s |

## 3. 観点ごとのケース

### 3.1 壊れた記録（corrupt-state）

台帳・タスク・設定は**プロセスの外**に置いてある。別ウィンドウ・別バージョン・手編集が書きうる、
という前提で作ったのだから、型が崩れた 1 本で面が開かなくなってはいけない。

#### adv-01 壊れた台帳が何本混ざっても、まともな記録は一覧に出る（`cases/adv-01-ledger-garbage.mjs`）

- **疑っている壊れかた** — 読み出しの関門が `parsed?.sessionId && parsed.owner` の 2 つだけで、
  型は見ていない。`sessionId` が数値・`totalCostUsd` が文字列の記録が素通りし、一覧を組む側で
  TypeError になって**セッション一覧そのものが開かない**。無事な記録まで巻き添えで見えなくなる。
- **期待する振る舞い** — 読めない記録は数に入れず読み飛ばす（`sessionStore.ts:71` のコメントが
  自分でそう宣言している）。毒が何本あっても一覧は開き、まともな記録は並ぶ。
- **手順の要点**
  - `userDataDir/User/globalStorage/idris.nimbus/sessions/` に、まともな 1 本（心拍 10 分前＝
    持ち主なし）と毒 6 本を置く。毒は `sessionId` が数値 / `totalCostUsd` が文字列 /
    `cwd` がオブジェクト（`cwd` 文字列側は `ctx.workspace` の外にする）/ `owner: []` /
    途中で切れた JSON / 0 バイト。
  - **20 万字の `title` と `rows.every(r => r.length < 2000)` は入れない。** 書き手側が
    `oneLine(...).slice(0, 120)` で畳んでおり、クイックピックはラベルを切り詰めない ＝
    製品を直しても緑にならない赤になる。
  - `runCommand(page, labels('command.showSessions')[0])` → `quickPickText` と行の `innerText` を取る。
  - 判定は 2 本。①タイトル（`走っているセッション`）が描けている ②`無事な記録` が行にある。
    失敗メッセージには `picker.slice(0, 500)` に加えて **`notificationText(page)` を必ず入れる**
    —— 例外で死ぬと picker は空文字になり、理由は通知にしか出ない。
  - finally で毒を全部 `rmSync` し、**1.2 秒待つ**（`sessionStore` の 1 秒キャッシュを跨がせる）。
- **根拠** — `extensions/nimbus/src/sessionStore.ts:71, 88-91` /
  `extensions/nimbus/src/extension.ts:2451, 2453, 2455, 4026, 4815` /
  `extensions/nimbus/src/core/sessionRegistry.ts:176-179` / 既存ケース `cases/40-session-registry.mjs:18-19`

#### adv-02 手書きの設定が型を外しても、承認ルールの一覧は開く（`cases/adv-02-settings-rule-types.mjs`）

- **疑っている壊れかた** — 承認ルールは「手で読めて手で直せる形」を売りにしているのに、読み出しは
  `get<string[]>` の型注釈だけ。配列に数値や null が混ざると `parseRule` の `text.trim()` が
  TypeError になり、**ルール一覧が 1 度も開かない**。溜まった自動許可を点検する手段が消える。
- **期待する振る舞い** — 読めない行は落とすのではなく「書式が読めません」として並べる
  （`permissionRules.ts` が既にその `detail` を持っている＝これは決めてある仕様）。
- **手順の要点**
  - `ctx.workspace/.vscode/settings.json` に `nimbus.permissions.alwaysAllow`
    `['Bash(npm test)', 123, null, { tool: 'Read' }, 'Read']` を書き、2500ms 待つ（case 21 の実測）。
  - `runCommand(page, labels('command.editPermissionRules')[0])` → `quickPickText` と行。
  - **毒が届いたことを先に確かめる**: タイトルは `Nimbus: 確認せずに許可するルール（${rules.length} 件）`
    なので `（5 件）` を含むこと。3 件や 0 件なら「型崩れが拡張まで届いていない＝この経路では
    再現しない」と明示して落とす。素通りの緑にしてはいけない。
  - 判定はタイトルが描けている／`Bash(npm test)` が並ぶ／`書式が読めません` の行がある、の 3 本。
    **長さの判定と 5,000 字の毒は入れない**（上限はどこにも決まっていない）。
  - 行は**選ばない**・「ルールを足す」も**押さない**（どちらも `{ modal: true }`）。
    `editPermissionRules` は `for(;;)` で回るので、Escape を最大 3 回まで押して確実に閉じる。
  - finally で `settings.json` を消し、1.5 秒待つ。`untrusted` は付けない（付けなければ
    `--untrusted` の束では自動的に走らない）。
- **根拠** — `extensions/nimbus/src/permissionRules.ts:15-17, 66, 71-73, 94` /
  `extensions/nimbus/src/core/permissionRules.ts:69-70` /
  `extensions/nimbus/src/core/approvalRules.ts:6-8, 96-97` / `extensions/nimbus/src/extension.ts:486-495`

#### adv-05 板の「全 N」と、見えているカードの枚数が一致する（`cases/adv-05-board-phantom-count.mjs`）

- **疑っている壊れかた** — タスクは `taskId` と `title` があれば通り、`state` は無検証。板は列
  （5 状態）ごとに絞ってカードを作るので、知らない状態のタスクは**どの列にも入らず姿を消す**のに、
  要約は `tasks.length` を数える。「全 3」と出ているのにカードが 1 枚、という状態になる。
  探しても見つからない仕事が数字にだけ残るのは、並列で走らせたとき一番損をする壊れかた。
- **期待する振る舞い** — 数えたものは必ず見える場所に出す。**どの列へ倒すかは書かない**
  （直しかたは実装者が決める。集計を「描いた列の合計」から作り直すのが一番安い）。
- **手順の要点**
  - `userDataDir/.../idris.nimbus/tasks/` に、まともな 1 件（`state: 'pending'`）と、
    `state: 'banana'` / `state: null` の 2 件を置く。
  - `runCommand(page, labels('command.openBoardTab')[0])` → `webviewText(page, ['まともなタスク'], { attempts: 16 })`。
  - **フレーム取得はファイル先頭の helper 関数に切り出す**（`run` 本体に `for (…) { return frame; }` を
    書くと、見つからなかったときに `ctx.expect` を 1 度も通らず**緑で抜ける**）。`#board` を持ち、かつ
    本文に `まともなタスク` を含むフレームを選ぶ（板はサイドバーとタブの 2 枚が同時に生きうる）。
  - 同じフレームから `.card` の枚数と `#summary` を読む。`$eval` は `.catch(() => '')` で包み、
    要約が読めなければその旨で落とす。判定は `total === cards` と `cards >= 1` の 2 本。
  - カードのボタン（開始 / worktree を開く / 完了 / 一覧から消す）は**押さない**。
  - finally: ファイルを消し、**固定待ちにせず**「まともなタスク」が消えるまで最大 10 秒ポーリング
    （5 秒周期に固定待ちを合わせると、周期がずれた瞬間に毒を次へ持ち越す）。そのあと
    `.tabs-container .tab .codicon-close` を Playwright の `element.click()` で押してタブを閉じ、
    `.part.statusbar` を押して焦点を webview の外へ戻す。
- **根拠** — `extensions/nimbus/src/taskStore.ts:40-43` / `extensions/nimbus/media/board.js:38, 81-83, 92-101` /
  `extensions/nimbus/src/core/tasks.ts:91-97` / `extensions/nimbus/src/tasks/BoardViewProvider.ts:78-79, 94, 96` /
  `extensions/nimbus/src/extension.ts:4785` / 既存ケース `cases/42-editor-tabs.mjs:47-56`

#### adv-17 保存した番号・名前・ピンの値が壊れていても、有効化は落ちない（`cases/adv-17-workspace-state-garbage.mjs`）

- **疑っている壊れかた** — 起動時の復元が `workspaceState` の値を**そのまま `new Map(...)` / `new Set(...)`
  に渡している**（`extension.ts:429-440`）。`Map` は「対の配列」しか受けないので、保存値が文字列・数値・
  オブジェクトだと **TypeError で `activate()` ごと落ち**、サイドバーもコックピットも一切出ない。
  `nimbus.sessionCounter` が文字列 `"9"` なら `+= 1` が文字列結合になり、番号が `91`・`911` と化ける。
  下書き（`nimbus.drafts`）の読み出しだけは 1 件ずつ検めていて（`:394-407`）、不揃い。
- **期待する振る舞い** — 壊れた値は無かったことにして起動する（adv-01 で決めた「読めないものは
  読み飛ばし、無事なものは生かす」）。「+」は効き、番号は整数のまま振られる。
- **手順の要点**
  - `state.vscdb` は**アプリが開いている間は書き換えられない**（終了時に覚えている値で上書き）。
    `ctx.restart({ beforeLaunch })`（T-379 で足した口）で、閉じてから開くまでの間に毒を置く。
  - 行は `workspaceStorage/<hash>/state.vscdb` の `ItemTable` にあり、鍵は拡張 id `idris.nimbus`、
    値は全鍵をまとめた JSON 1 つ。`sqlite3 -json` で読み、`UPDATE` で書く（`'` は `''` に）。
  - **関門は `nimbus.drafts` が配列であること。** 「+」で書かれるのは下書きだけで、番号の台帳は
    閉じる・名前を変える・ピンのときにしか書かれない（実測: 番号を関門にしたら `had: false` で止まった）。
    毒は**無い鍵にも置く** — 無い鍵に壊れた値が入っているのが、疑っている形そのもの。
  - 判定は 3 本。①サイドバーとコックピットが開く ②通知に有効化の失敗が無い
    ③「+」のあと番号が `^\d{1,3}$` で重複なし（文字列結合を掴む）。
- **根拠** — `extensions/nimbus/src/extension.ts:394-407（drafts の検め）, 429-440（Map/Set）` /
  `src/vs/workbench/api/common/extHostMemento.ts:25-36`（鍵は拡張 id）

#### adv-18 持ち主の心拍が欠けた記録は、前回のセッションとして戻らず、有効化も落ちない（`cases/adv-18-ledger-owner-no-heartbeat.mjs`）

- **疑っている壊れかた** — 関門 `isSessionRecord()`（`core/sessionRegistry.ts`）は `owner` が
  **オブジェクトであること**しか見ず、`owner.heartbeatAt` の型を見ない（T-347 で型を見るように
  したのは平らな項目だけ）。`owner: { windowId, pid }` が素通りすると、`isOwnerAlive()` は
  `NaN < ttl` で「持ち主なし」、`forgettable()` は T-374 の `Math.max(updatedAt, heartbeatAt)` が
  NaN になって**永遠に掃除されず**、`resumeCandidates()` の条件を全部満たすので
  **開き直すたびに「前回のセッション」として戻り続ける**。T-374 の式は 9/1 に自分で入れたもの。
- **期待する振る舞い** — 持ち主の形が崩れた記録は「読めない記録」として数に入れない（adv-01 と同じ
  原則）。戻らず、落ちず、無事な記録は戻り、置き去りは掃除される。
- **手順の要点**
  - `beforeLaunch` で記録を 3 本置く — ①無事な前回（心拍 10 分前・鍵あり・cwd は `ctx.workspace`）
    → **戻るはず**（戻らなければ cwd の当てかたが違う ＝ 偽の緑の関門）②30 日前で心拍も止まった置き去り
    → **掃除されるはず**（`sweep()` が走った証拠）③心拍の欠けた毒（30 日前・鍵あり）→ **戻らないはず**。
  - タブは **`title` 属性で探す。** `textContent` は畳まれる（実測: `■1無事な前回 adv…`）。
  - 実測（直す前）: `["1. 無事な前回 adv-18 …", "2. 心拍の無い記録 adv-18 …"]` — 毒が戻っていた。
- **根拠** — `extensions/nimbus/src/core/sessionRegistry.ts`（`isSessionRecord` / `isOwnerAlive` /
  `forgettable` / `resumeCandidates`）/ `extensions/nimbus/src/extension.ts`（`restoreResumables`）/
  `extensions/nimbus/src/test/sessionRegistry.test.ts`「持ち主の心拍・窓・pid の型が崩れた記録は関門で止める」

### 3.2 敵意のある入力（hostile-input）

名前の欄は「読み手が信用してよい」と暗黙に決めてしまいやすい場所。決めていないことを毎回確かめる。

#### adv-03 タスク名に HTML のかけらを入れても、札の上で要素にならない（`cases/adv-03-board-name-html.mjs`）

- **疑っている壊れかた** — 入口はまったく無検証（`taskId` と `title` だけ見る → 素通し → 5 秒ごとに画面へ）。
  出口の `textContent` **1 枚だけ**が壁になっている構造で、誰かが `innerHTML` に書き換えた瞬間に破れる。
- **期待する振る舞い** — 名前とブランチ名は文字のまま出る。板の中に `img` / `script` / `b` / `svg` /
  `iframe` / `object` / `[onerror]` / `[onload]` が 1 つも生えず、`document.body.dataset.pwned` も付かない。
- **手順の要点**
  - 名前は `'<img src=x onerror="…">' + '</script><script>…</script>' + '${7*7}' + '&lt;b&gt;' + '"><b>ふとじ</b>'`。
    **必ずシングルクォートの連結で書く**（テンプレートリテラルにすると `${7*7}` が 49 に展開され、
    確かめたい「文字のまま出るか」が消える）。
  - `openNimbusTasksSidebar` → `#board` と `#newTask` を**両方**持つフレームを選ぶ（コックピット／ゆあの面と
    取り違えない）。`#newTask` は**押さない**（`InputBox` → worktree → 実セッション）。
  - 判定は**自分の札を名前で探してから**行う。`[...document.querySelectorAll('#board .card')]
    .find(c => c.querySelector('.title')?.textContent === NAME)`。先頭の札を読む書きかたにしない。
  - finally でファイルを消し、最後の確認は「板が 0 枚に戻った」ではなく「**自分の札が消えた**」。
- **根拠** — `extensions/nimbus/media/board.js:43, 48` / `extensions/nimbus/src/taskStore.ts:40-43` /
  `extensions/nimbus/src/core/taskSync.ts:47-77` / `extensions/nimbus/src/extension.ts:364, 4785` /
  `extensions/nimbus/src/webview/page.ts:29`（CSP）

#### adv-04 切れ目の無い長いタスク名で、板が横に破れない（`cases/adv-04-board-name-long.mjs`）

- **疑っている壊れかた** — 同じ札の中で、ブランチ名には `word-break: break-all`、進捗には
  `nowrap + ellipsis` が入っているのに、**名前だけ素通し**。貼り付けた base64 や URL で札が板の幅を
  突き抜け、横スクロールが生まれてボタンが画面の外へ出る。
- **期待する振る舞い** — 板は縦にだけ送れる面のまま（`#board` の横のはみ出しが 4px 以内）で、
  `#newTask` は生きている。要約も止まらず出る。
- **手順の要点**
  - 名前は**切れ目の無い ASCII 2,000 字**（`'B'.repeat(2000)`）。10 万字にしない —— 検出力は変わらず、
    描画待ちとスクショが重くなるだけで、「製品の欠陥」と「レイアウトエンジンの病理」の区別も付かなくなる。
  - 判定は `overflowX <= 4` と `#newTask` が生きていること。要約は**部分一致**（`summary.includes('全 1')`）。
    高さを見るなら絶対値ではなく `cardHeight < boardHeight`（1 枚で板を埋めていない）。
  - 失敗メッセージに `getComputedStyle(title).wordBreak / overflowWrap / textOverflow` を載せる
    —— 「どの指定が無いから破れたか」が出れば直す側が迷わない。
  - finally はケース adv-03 と同じ（自分の札で確認する）。
- **根拠** — `extensions/nimbus/media/board.css:41-48, 71, 73-78, 80-87` /
  `extensions/nimbus/media/board.js:43` / `extensions/nimbus/src/taskStore.ts:40-43`

#### adv-10 入力欄に画像を落としたら、1 枚は 1 枚として溜まる（`cases/adv-10-attach-filename.mjs`）

- **疑っている壊れかた** — 同じ `drop` ハンドラが `#input` と `document.body` の**両方**に登録されていて、
  中で `preventDefault()` はするが `stopPropagation()` を呼んでいない。`#input` に落ちたイベントは
  body まで上がるので `addFile` が 2 回走る。**画像を入力欄にドラッグしただけの普通の利用者が毎回踏み、
  送信すればそのぶん課金する。** 敵対的な入力を使わなくても出る、この束で一番重い欠陥。
- **期待する振る舞い** — `#input` に 1 枚落としたら `.attachment` は 1 枚。`document.body` に落としても 1 枚。
  ファイル名は文字のまま出て、`#attachments` の中に `img` / `[onerror]` / `[onload]` は生えない。
- **手順の要点**
  - `#attach` は**絶対に押さない**（`showOpenDialog`）。ファイルシステムは使わず、フレームの中で
    `new DataTransfer()` / `items.add(new File([8 バイトの偽 PNG], name, { type: 'image/png' }))` /
    `new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true })` を組み立てる。
  - **主判定は二重取りの 1 本に絞る。** 名前の HTML（`textContent` なので今日は素通り）と
    幅は副次の判定として置き、**双方向制御文字を剥がす期待は `ctx.expect` にしない**
    —— 剥がすのが正しいかは決まっていない。`console.log` で記録し、板に起こして合意してから
    assert に格上げする。
  - 判定の順番に注意: 最初に「1 枚以上出たか（＝合成できたか。落ちたらメッセージに
    **ハーネス側のドロップ合成に失敗**と書く）」を置く。枚数の判定を先頭にすると、今日はそこで落ちて
    後ろの判定が 1 度も走らない。
  - 名前は 255 字まで（実ファイルでは 10 万字も `../` も作れない。合成専用だと分かるようコメントを添える）。
    双方向制御文字は必ず `\u202E` の形でソースに書く（生の不可視文字は編集・整形で消える）。
  - フレームは `document.body.dataset.assistant === 'Claude'` かつ `document.body.clientWidth > 100` で選ぶ。
  - **finally で `.attachment` を 0 枚に戻す**（最大 12 回、毎回 `querySelector` し直す）。`pending` は
    面ごとの JS 変数で `resetWorkbench` が戻さない（T-340）。残すと後のケースが知らない画像を送る。
  - Enter も送信ボタンも押さない。
- **根拠** — `extensions/nimbus/media/cockpit.js:697, 708-717, 891-902` /
  `extensions/nimbus/media/cockpit.css:1146-1157` / `extensions/nimbus/src/cockpit/CockpitViewProvider.ts:203`

#### adv-19 打ちかけの本文は、敵意のある文字でも 120KB でも、閉じて開いたら一字も欠けない（`cases/adv-19-draft-text-hostile.mjs`）

- **疑っている壊れかた** — 打ちかけは `vscode.setState({ draftText })` で覚える（T-376）。ケース 71 は
  短い日本語 1 行しか通していない。保存 → 終了 → 読み直しで化けうるのは、改行・タブ・引用符と `\\`・
  HTML のかけら・RTL 制御文字（U+202E）・ZWJ つき絵文字・そして**大きさ**（ログを貼った 120KB）。
  webview の state は workbench の保存領域に JSON で入るので、上限があるなら**黙って切れる**か
  **丸ごと戻らない**。
- **期待する振る舞い** — 閉じる前と一字も違わない。HTML のかけらがどこにも要素として現れない。
- **手順の要点**
  - 値を代入して `input` イベントを送る（打鍵の配線はケース 71 が見ている。ここは大きさと文字）。
  - **比べる相手は「置いた直後に読み返した値」。** textarea は CRLF を LF に**正規化する**
    （実測: 元の文字列と `value` が一致せず、関門で止まった）。
  - 失敗メッセージは長さと**最初の違いの位置**（前後 30 字を JSON で）。
- **根拠** — `extensions/nimbus/media/cockpit.js`（`rememberDraftText` / `restoreDraftText`）/
  ケース 71

### 3.3 空と欠け（empty-and-missing）

無いものを「無い」と言えるか。**言えないほうが、間違ったものを見せるより重い。**

#### adv-07 存在しない Claude Code を指しても「準備は揃っています」と言わない（`cases/adv-07-missing-claude-binary.mjs`）

- **疑っている壊れかた** — 設定にパスがあると `configured.trim()` を**そのまま返す**（他の 2 経路は
  両方 `existsSync` と実行権を見ている）。準備は blocked 0 になり、ステータスバーの警告も消え、
  送信前チェックも素通りして SDK の英語エラーまで進む。しかも「本当に使えるか」の確認も同じ関数を使う。
- **期待する振る舞い** — 実在しない**絶対パス**を指した時点で blocked。通知は
  「Nimbus — 準備 1 件（Claude Code）」、ステータスバーに警告。「準備は揃っています。」とは言わない。
  ※ 設定値が `claude` のような**コマンド名**なのは正当（PATH 解決に任せる）。期待も直しも
  「絶対パスのときだけ実在と実行権を確かめる」と書く。
- **手順の要点**
  - **壊す前に基準を取る**: `runCommand(page, '準備をもう一度さがす')` を打ち、「準備は揃っています」が
    出ることを確かめてから壊す（Claude が入っていない機械では素で blocked ＝ 素通りの緑になる）。
  - `.vscode/settings.json` に `nimbus.claudeCodeExecutable: join(ctx.workspace, 'no-such-claude')` を書く
    （**そのファイルは作らない**）。2500ms 待つと `affectsConfiguration` で再計算が走る。
  - **各 `runCommand` の前に `Notifications: Clear All Notifications` を挟む** —— `notificationText` は
    出ている全トーストを連結するので、残りが否定形の判定を汚す。
  - 判定は 3 本: 通知に「準備は揃っています」が**無い** / 通知に「Claude Code」か「準備 1 件」がある /
    ステータスバーに「準備」と「Claude Code」の両方がある。
  - 準備カードの `.readiness-action` は**押さない**（先頭が `locateClaude` → `showOpenDialog`）。
  - finally: 設定を消し 2500ms 待ち、**もう一度 recheck して元に戻ったことまで確かめる**。
- **根拠** — `extensions/nimbus/src/claudeExecutable.ts:47, 61, 68-72` /
  `extensions/nimbus/src/core/readiness.ts:120-129` /
  `extensions/nimbus/src/extension.ts:3143, 3157-3158, 3162, 3426, 4236-4238, 4256-4258` /
  `extensions/nimbus/src/setupActions.ts:27, 41-47` / `extensions/nimbus/package.json:1261-1262`
  （`nimbus.recheckSetup` のタイトルは nls を通さない素の日本語。ケースも生文字列で渡す）

#### adv-08 読めない `.claude/settings.json` を、空とみなして上書きしない（`cases/adv-08-unreadable-settings.mjs`）

- **疑っている壊れかた** — `readSettings` は readFile の失敗と JSON.parse の失敗を**同じ catch** で
  `{}` にする。書き込みはモード 222 でも通るので失敗の合図が出ず、既存の `permissions` / `env` を
  丸ごと書き潰したうえで「フックを保存しました」と言う。黙ったデータ消失。
- **期待する振る舞い** — 読めないときは書かずに理由を言う。**少なくとも既存の内容を保つ。**
  ※「壊れた JSON は空から始める」はコメントで意図的に決めてある。EACCES を別扱いにすべきという主張は
  仕様書に無いので、落ちたときは「不具合」ではなく**決めていないことの提起**として扱う。
- **手順の要点**
  - `ctx.workspace/.claude/settings.json` に `{ permissions: { allow: ['Read(*.md)'] }, env: { NIMBUS_GUI: 'keep-me' } }`
    を書き、`chmodSync(settingsPath, 0o222)`。**ディレクトリの権限は絶対に触らない**
    （000 にすると `git clean -qffdx` が入れず、以後の全ケースが壊れる）。
  - `runCommand(page, labels('command.hooks')[0])` → 4 段の QuickPick を `typeAndEnter` で送る
    （`フックを足す` / `PreToolUse` / `Bash` / `exit 2`。各段の前に 900ms 以上待つ）。
  - **偽の緑を潰す**（必須）: 権限を戻して読み直したあと、まず
    `ctx.expect(written.includes('PreToolUse') || toast.includes('保存'), 'フックの流れが最後まで走っていない（このケースは何も確かめていない）')`。
    QuickPick が 1 段でもずれると何も書かれず、`keep-me` が残って全部通ってしまう。
  - そのうえで `written.includes('keep-me')` を判定する。書き込み自体が権限で失敗した場合
    （＝消失なし）も緑になる形にしておく。
  - finally: `chmodSync(0o644)` を try/catch で**必ず**通してから `rmSync`、消えたことを `existsSync` で確認。
- **根拠** — `extensions/nimbus/src/hooksBuilder.ts:36-45, 126-131, 141-150` /
  既存ケース `cases/23-hooks.mjs:14-22` / 実測（uid 501・mode 222 は read が EACCES・write は成功）

#### adv-09 コミット 0 件のフォルダで、git を読む機能が黙らず、嘘もつかない（`cases/adv-09-empty-repo.mjs`）

- **疑っている壊れかた** — `git init` 直後（unborn HEAD）では `git diff HEAD` が rc=128 で
  `fatal: ambiguous argument 'HEAD'` を返す。Nimbus はそれを種類で分けずにエラー通知へ流すので、
  **変更が 1 つも無い平常の状態がエラーとして出る**。対照群の `git status --porcelain` は rc=0・空。
- **期待する振る舞い** — 0 コミットで変更が無いときに、赤いエラーで止めない。生の英語（`fatal` /
  `ambiguous`）を素で貼らない。**文言は決め打ちしない** —— 「変更はありません」でも
  「まだコミットがありません」でもよい形で判定する。
- **手順の要点**
  - `git checkout -q --orphan nimbus-empty` → `git rm -rq --cached .` → 実体を削除。
    `git status --porcelain` が空であることを先に確かめる（前提が作れたことの確認）。
  - `コミットの分けかたを提案する`（対照群・`git status` 経路）→ `変更の要約を見る`（本命）。
    **コマンドの前ごとに `Notifications: Clear All Notifications`** —— 対照群のトーストが残ると
    本命の部分一致が偽で緑になる。
  - 判定は「黙って終わらない（通知が出る）」「`/fatal|ambiguous/i` を含まない」
    「エラー扱いにしない、または『コミット』に触れて説明する」の 3 本。
  - **`リポジトリの構造要約を作る` は入れない** —— 判定がトートロジー（`if (facts.branch)` が
    行ごと落とすので `undefined` は構造上出ない）で、無題エディタを 1 枚増やす危険だけが残る。
    ブランチ行の有無は `renderRepoSummary` の純関数なのでモジュールテスト側で足す。
  - タブ枚数を見るなら**絶対値ではなく差分**（コマンド前の枚数から増えていないこと）。
  - finally: `closeAllEditors(page)`（内部が Revert and Close Editor）→
    `git checkout -f -B <元のブランチ> nimbus-gui-baseline`。`git()` は `execFileSync` なので
    **try/catch で包み、戻し失敗は `console.log` で必ず言う**。finally の中で `ctx.expect` は投げない
    （本来の失敗理由が消える）。
- **根拠** — `extensions/nimbus/src/diffSummary.ts:25-35` / `extensions/nimbus/src/commitSplit.ts:28-46` /
  `extensions/nimbus/src/repoSummary.ts:41-47` / `extensions/nimbus/src/core/repoSummary.ts:83-88` /
  `nimbus/tests/gui/helpers.mjs:405-420`（`closeAllEditors`）

### 3.4 速さと競合（rapid-and-race）

**隙間が実在するものだけを撃つ。** 「連打してみる」だけの案は、同期処理なら必ず緑になって何も証明しない。

#### adv-06 「一覧から消す」は、板からもディスクからも本当に消える（`cases/adv-06-forget-burst.mjs`）

- **疑っている壊れかた** — `forget` はメモリと `knownIds` から同期で消し、ディスクの削除は
  `void this.store?.remove(taskId)` の投げっぱなし。5 秒ごとの突き合わせは「手元に無い・ディスクに在る・
  `knownIds` にも無い」を**新顔として拾い直す**ので、隙間に入れば消したカードが戻る。
  ※ 窓は数ミリ秒しかないので、実際に捕まるのは「void で投げた削除が届かない・別ディレクトリを見ている・
  `rm` の失敗が握り潰された」系。**看板は「連打で race」ではなく「消したものが戻ってこない」**にする。
- **期待する振る舞い** — 7 秒後（＝突き合わせを 1 回またぐ）の板に自分のタスクが 1 枚も無く、
  ディスクにも `.json` と `.progress.jsonl` が残らない。
- **手順の要点**
  - `state: 'done'` のタスクを **3 件**置く（8 件にしても窓は延びない。板への反映待ちが 5 秒周期なので
    件数は実行時間だけを食う）。done のカードには「一覧から消す」しか出ないので、worktree にも
    セッション開始にも触れない。
  - `#board` を持ち、かつ本文に自分のタスク名を含むフレームを選び、1 tick で `adv-` の札のボタンだけを
    `click()`。戻り値は `>= 3` で判定する（束の残骸を巻き込まない）。
  - **判定はディスクを正、板の文字列を従**（webview の描画遅れで揺れるのは板の側）。
  - finally: 残ったファイルを消し、タブは `.codicon-close` を Playwright の `element.click()` で押して閉じ、
    閉じられなくても落とさない（`resetWorkbench` が後段で拾う）。`.part.statusbar` で焦点を戻す。
- **根拠** — `extensions/nimbus/src/tasks/TaskService.ts:73-104, 268-273` /
  `extensions/nimbus/src/taskStore.ts:70-78` / `extensions/nimbus/src/core/taskSync.ts:52-77` /
  `extensions/nimbus/media/board.js:38, 62-70` / `extensions/nimbus/src/extension.ts:4785`

#### adv-15 「全画面にする」を 1 tick で 2 回押したら、ちゃんと戻る（`cases/adv-15-fullscreen-burst.mjs`）

- **疑っている壊れかた** — 旗を読んでから書くまでに `openInEditor` と 3 つの `await executeCommand`
  （`closeSidebar` / `closePanel` / `closeAuxiliaryBar`）が挟まり、**先に旗を立てるガードが無い**。
  ハンドラは最初の await で必ず一度譲るので、1 tick の 2 連打は両方が「まだ全画面ではない」を読み、
  両方が入る側の枝を走る。2 回押したのにサイドバーが畳まれたまま戻らない。
- **期待する振る舞い** — 2 回押したあとサイドバーが見えている。
- **手順の要点**
  - 押しかたは `.part.sidebar .composite.title .actions-container a, .action-label` から、
    `aria-label` / `title` が **`labels('command.fullscreenCockpit')` のどれかを含む**要素を 1 つ選び、
    **1 回の `page.evaluate` の中で `el.click(); el.click();`**（`'全画面'` の決め打ちは英語ロケールで落ちる。
    await を挟むと隙間が閉じて攻撃にならない）。コマンドは `navigation` グループなので `…` の裏に隠れない。
  - 可視判定は `cases/46-fullscreen-and-side.mjs:10-19` の `sidebarVisible`（display / visibility /
    clientWidth）を**そのまま写して使う**。`getBoundingClientRect().width` だけだと拾い違える。
  - **`cockpitTab <= 1` は入れない** —— `openInEditor` の先頭に同期ガードがあり、絶対に落ちない飾りの判定。
  - **後始末は旗に依存しない収束ループにする**: `for (let i = 0; i < 4 && !(await sidebarVisible(page)); i++)`
    で `runCommand(labels('command.fullscreenCockpit')[0])` ＋1200ms。旗がどちらでも 2 周以内に開く。
    それでも戻らなければ `openNimbusSidebar` で開き直す。タブは `.codicon-close` を実マウスで押す。
  - サイドバーが閉じたまま抜けると**後続の全ケースがタイトルのボタンを掴めなくなる**ので、
    finally の最後に `ctx.expect(await sidebarVisible(page), '後始末でサイドバーを戻せなかった')` を置く。
- **根拠** — `extensions/nimbus/src/extension.ts:549, 2683, 2685-2714, 4067` /
  `extensions/nimbus/package.json:660-664, 1360-1364, 1485-1489` /
  `extensions/nimbus/src/webview/WebviewViewHost.ts:56-59` / 既存ケース `cases/54-new-session-draft.mjs:16-30`

### 3.5 順番と持ち越し（order-and-carryover）

同じ操作の 2 回目・別の面・別の入口。**単独では通り、束では落ちる**が生まれる場所。

#### adv-12 タブの面でも一覧が開き、← で会話へ戻れる（`cases/adv-12-home-crosstalk.mjs`）

> **2026-08-31 00:30 に書き直した。** 設計時の前提だった ≡（`#homeToggle`）は `d02cd68fc1f` で
> 廃止され、開く役は面のタイトルの `nimbus.openHome`、戻る役は `#homeBack` に割れた。
> 下の「疑っている壊れかた」は当時の記述。**いま実装されているのは次の 2 つ**:
>
> - **判定する（決まっている）** — タブの面で一覧が開き、← が出て、押すと会話へ戻る。
>   仕様 `cockpit-home.md` 6 項が「`view/title` と `editor/title` の**両方**。全画面は
>   サイドバーごと畳むので、片方だけだと入口がゼロになる」と決めている。ところが
>   回帰ケース 65 は**サイドバーの面しか見ていない**ので、ここがその穴を塞ぐ。
> - **観察だけする（決まっていない）** — 下の crosstalk。`ctx.expect` にせず `console.log` に残す。
>   仕様は「provider が覚える」と書いたままで、面ごとに持つかが決まっていない（4 節 ①）。
>   決まったら判定へ格上げする。

<details><summary>設計時の記述（≡ 廃止前）</summary>

- **疑っている壊れかた** — Home の開閉が「面ごと」ではなく **provider ごとに 1 個**で、新しい面の `ready` が
  その値を `view` と `panel` の**両方**へ配る。タブ側で ≡ を閉じてからタブを開き直すと、2 回目の `ready` が
  `open: false` をサイドバーへも配り、誰も触っていない面の Home が閉じる。
- **期待する振る舞い** — Home の開閉は面ごとの見えかた。別の面を開く・閉じる・開き直すことで、
  触っていない面の Home が動かない。面を開き直したとき復元されるのは、その面自身の状態だけ。
- **前提の確認**（このケースだけ着手前に要る） — 仕様 `cockpit-home.md`「UI 配線」は
  **「Home の開閉は provider が覚え、面を開き直したときに戻す」**と書いてある。つまり provider ごとに
  持つのは**書かれた設計**。落ちても即「不具合」とは言えないので、**利用者に 1 行で確認し、合意できたら
  仕様の追記（「Home の開閉は面ごとの見えかた」）とケースを同じコミットで入れる。** 合意が取れないなら
  このケースは書かない（仕様の空白を試験で埋めない）。
- **手順の要点**
  - `openNimbusSidebar` → `pressNewSession` を 2 回（800ms 間隔）。**先に下書きを 2 本作るのは必須**
    —— 列が 1 本だと `#sessionTabs` が hidden で、`#homeToggle` が列へ移らず永久に押せない。
  - `data-assistant === 'Claude'` かつ `#homeToggle` を持つフレームを掴み、**Playwright の Frame 参照を
    握って再利用する**（`frameElement()` で親を辿らない。webview は入れ子 iframe で親の特定が当てにならない）。
    フレームが 2 枚以上でも `ctx.expect` で落とさない —— `console.log` で枚数を警告し、`#sessionTabs` を
    持つほうを選び直す。前のケースの残骸で前提が崩れただけで赤くなると、本丸の食い違いが読めなくなる。
  - `#homeToggle` は必ず `frame.evaluate` から押す（`.home-bar[hidden]{display:none}` の中にあるので
    `ElementHandle.click()` だと 30 秒溶ける）。
  - 流れ: サイドバーで ≡ 開く → タブを開く（1 回目・ここは通る想定）→ タブ側で ≡ 閉じる →
    タブを ✕ で閉じる → **2 回目**のタブ開き → **サイドバーの Home がまだ開いていること**が本丸。
  - `sidebarFrame.$eval` が throw したら catch して「サイドバーの面が作り直された」と**別の理由で落とす**
    （それ自体が別の不具合。原因の切り分けに効く）。
  - finally: タブを ✕ で閉じ、**Home を開いたまま終えない**（`cases/54-new-session-draft.mjs:129-131` が
    「次のケースの ≡ が『閉じる』になる」と実測している）。下書きは `×` で閉じるが**最後の 1 本は
    構造上閉じられない**前提で書く。
- **根拠** — `extensions/nimbus/src/cockpit/CockpitViewProvider.ts:207-217, 228, 319-323, 350-351, 444-452` /
  `extensions/nimbus/src/webview/WebviewViewHost.ts:145-148` /
  `extensions/nimbus/media/cockpit.js:23, 26, 1009, 1303, 1305-1312, 1591-1593` /
  `nimbus/docs/specs/cockpit-home.md`（UI 配線）

</details>

#### adv-16 全画面をやめたら、必ず元の見えかたへ戻る（`cases/adv-16-fullscreen-restore.mjs`）

> この節は 2 案（`fullscreen-toggle-desync` と `fullscreen-restore-sidebar`）を **1 本に畳んだもの**。
> どちらも「全画面 → 別の入口でサイドバーを開く → 全画面コマンド」を辿る同じ経路で、
> 危険（内部フラグが戻らない）を 2 度背負う理由が無い。

- **疑っている壊れかた** — 戻す側は真偽値 1 個を見て `workbench.action.toggleSidebarVisibility` を
  **1 本呼ぶだけ**で、画面の実状態を見ていない。行く側は `openInEditor` ＋ 3 つの close と非対称。
  だから全画面のあいだにサイドバーを開き直すと、「戻す」が**サイドバーを閉じる**。続けてもう一度押すと
  入る側へ行き、`closeSidebar` は空振りするので**押しても何も起きない一手**が生まれる。
- **期待する振る舞い** — 「もう一度で戻す」は必ず元の見えかたへ戻し、そこのコックピットに打てる。
  途中で別の入口からサイドバーを開いても、**次の 1 押しは必ず画面を変える**。
  ※ 「コックピットがどこにも見えなくなる」とは書かない —— タブは残るので、実害は
  「戻すが閉じるになる」非対称のほう。
- **手順の要点**
  - 冒頭で状態を正規化: `openNimbusSidebar` → `sidebarVisible` で**実際に見えている**ことを確かめてから始める
    （前の敵対ケースが畳んだまま返すと、1 つめの判定が「畳まれたから成功」で素通りする）。
  - 全画面 → `ctx.expect(!sidebarVisible)`（**46 と同じ既存の期待**だと分かる文言にする。本丸と混ざると
    どちらが壊れたか読めない）→ **`openNimbusSidebar` で開き直す**（自作の `.activitybar` 走査は使わない。
    helpers は「開いているアイコンを押すと閉じる」罠と「Nimbus 設定 / タスク / デバッグ」の除外を
    既に処理している）。
  - 「戻す」を押して `sidebarVisible` が真であること（本丸①）。続けてもう一度押し、
    `after1 !== after2`（本丸②・押しても何も起きない一手が無い）。
  - 戻った先で `.part.sidebar` の矩形からコックピットのフレームを選び（タブ側を掴まない・T-329）、
    `#input` に打てるところまで確かめる。
  - 全画面のコマンドを押した直後に `.part.statusbar` を 1 回押して焦点を webview から外す
    （`runCommand` の再試行で 60 秒を食い潰さないため）。
  - **ケース冒頭にコメントで理由を書く**: 「`cockpitFullscreen` は `resetWorkbench` で戻らない内部フラグ。
    この束では最後に置く」。finally は収束ループ（`sidebarVisible` が偽のあいだ最大 4 回）＋タブを ✕ で閉じる
    ＋焦点戻し。押す回数を数えて 60 秒に収める。
- **根拠** — `extensions/nimbus/src/extension.ts:549, 2685-2714` /
  `extensions/nimbus/src/webview/WebviewViewHost.ts:50-75` / `nimbus/docs/specs/cockpit-fullscreen.md` /
  既存ケース `cases/46-fullscreen-and-side.mjs:10-19`
- **板に起こすこと** — これは既存の振る舞いを変える提案なので、ケースを足すのと同じコミットで
  `tasks.md` に「全画面の戻す側が非対称」を 1 行起こし、期待値をそこに書く。

### 3.6 寸法の極端（layout-extremes）

**サイドバーの境目を引く**だけで壊れるなら、それはズームの話ではなく素の操作の話。

#### adv-13 境目をキーボードで端まで振り切っても、列も会話も潰れない（`cases/adv-13-rail-keyboard.mjs`）

- **疑っている壊れかた** — `#railSash` は `tabindex=0` で ←→（Shift で 3 倍）でも動く。この経路は
  63（マウス）で守られていない。端まで振り切ったときの丸めと、面を切り替えて戻したときの復元が崩れる。
  ※ 丸めは `applyRailWidth` の共通経路なので**通る見込みが高い**。これは新しい穴を掘る道具ではなく、
  無防備な入口に見張りを置く**回帰ガード**。
- **期待する振る舞い** — 列は下限を、会話は下限を下回らず、入力欄と送信は押せる。面を隠して戻しても、
  復元されるのはその面に収まる幅であって、振り切った値ではない。
- **手順の要点**
  - 列が 2 本未満なら `runCommand(page, labels('command.newSession')[0])` で補う
    （1 本だと `.rail-sash[hidden]{display:none}` で `#railSash` は本当に消える）。
  - `frame.focus('#railSash')` ＋ `page.keyboard.press`（`frame.press` は打鍵ごとの actionability 待ちで
    予算を溶かす）。左 6 回・右 10 回で足りる（丸めは 1 回目で効く）。
  - **境界ちょうどの判定をやめる**: 右へ振り切ると会話は**ちょうど下限**に着地し、
    `getBoundingClientRect` の端数で 1px 割れる。`main >= 180` / `rail >= 140` のように離し、
    落ちたときは実測値をメッセージに出す（63 が `>= 150` とわざと緩めているのと同じ理由）。
  - 面を隠して戻す段は**フレームを掴み直し**、`#railSash` が hidden でなくなるまで最大 20 回×500ms 待つ
    （待たずに測ると 0 を掴む）。
  - finally: `#railSash` の中心を `page.mouse.dblclick` して既定へ戻す。**覚えた幅は面ごとに永続する**ので、
    戻さないと後続の寸法ケースを壊す（63 の教訓）。焦点は `.part.statusbar` へ。
- **根拠** — `extensions/nimbus/media/cockpit.js:1195-1217, 1268-1270, 1274-1278, 1282-1291, 1293-1297, 1306-1313` /
  `extensions/nimbus/media/cockpit.css:143` /
  `extensions/nimbus/src/cockpit/CockpitViewProvider.ts:454` / `nimbus/docs/specs/cockpit-home.md:58`

#### adv-14 サイドバーを最小幅まで引き切っても、会話と入力欄が残る（`cases/adv-14-narrow-sidebar.mjs`）

- **疑っている壊れかた** — 仕様は「列 150px・会話 200px は必ず残す。どちらかが消えると、そこに何があったか
  分からなくなる」と書いているのに、サイドバーの最小幅は 170px で **150+200+4=354px を大きく下回る**。
  列は `flex: 0 0 auto` で縮まず、会話側は `min-width: 0` で 0 まで潰れる。T-341 で「狭い面では列を畳む」
  旧実装が消えているので、いま狭い面は無防備。
- **期待する振る舞い** — サイドバーをどこまで狭めても、会話と入力欄は消えない。
  **「列のほうが譲る」という解決策は試験が決めない** —— 185px では 150+200+4 を物理的に満たせないので、
  判定は「会話と入力欄が消えないこと」だけにし、失敗メッセージに 列 / 会話 / サイドバーの実測 px を全部載せて、
  直す側が「列を畳む」「列を縮める」を選べるようにする。
- **手順の要点**
  - **「まず列を広げて覚えさせる」は入れない** —— CSS の下限だけで不具合は出る。ドラッグを 1 本減らせば
    失敗点が半分になる。冒頭で `#railSash` を dblclick して覚えた幅を捨ててから始める。
  - サッシは `.monaco-sash` のうち `.disabled` を除き、**縦**（classList に `vertical`）で
    中心 x が `sidebar.right ± 8px` のものを選ぶ。
  - `page.mouse` で `sidebar.x + 185` まで引く（12 ステップ）。**170 を下回るところまで引かない**
    —— VS Code のスナップでサイドバーごと畳まれ、面が消えて測れなくなる。
  - ドラッグ前に `frame.evaluate(() => window.getSelection()?.removeAllRanges())`
    （残った選択の上で mousedown すると選択の D&D が始まり、製品の不具合と読み違える・61 の実測）。
  - **引いた直後に `.part.sidebar` の clientWidth > 0 を確かめる。** 0 なら「畳まれた＝測れない」で落とす。
    これをしないと「畳まれた」を「入力欄が消えた」と誤読する。
  - `ctx.expect(narrow.main > 0 && narrow.hit && narrow.inView, …)` が本丸。`>= 200` は書かない。
    **末尾の「戻したら幅も戻る（±25%）」は入れない**（仕様に無く、基準の取りかた次第で必ず外れる）。
  - **ドラッグは必ず try/finally で `page.mouse.up()` を保証する**（`down()` したまま落ちると以後の全ケースが
    壊れる）。finally でサッシを元の x へ引き戻し、実測幅を `console.log` で残す。
- **根拠** — `extensions/nimbus/media/cockpit.js:1195-1217` /
  `extensions/nimbus/media/cockpit.css:65-67, 79-98` / `src/vs/workbench/browser/parts/sidebar/sidebarPart.ts:44` /
  `src/vs/workbench/browser/layout.ts:162, 3016-3018, 3117-3122` / `nimbus/docs/specs/cockpit-home.md:57` /
  既存ケース `cases/63-rail-sash.mjs:12-24`

### 3.7 量（volume）

#### adv-11 2,000 件の会話を戻しても、コックピットが破綻しない（`cases/adv-11-history-2000-turns.mjs`）

- **疑っている壊れかた** — `history` は `log.textContent = ''` のあと**件数の上限も分割描画も無しに**
  1 件ずつ描き、1 件ごとに `atBottom()`（`scrollHeight` 読み）と `stickToBottom()`（`scrollTop` 書き）が
  挟まる ＝ 2,000 回の強制レイアウト。2,000 は保持上限そのもので、面を開き直すたびに実際に通る道。
  `parallel-load.md` が「2,000 件でも 0.1ms」と測ったのは**core の畳み直し**であって、
  コックピットの DOM は一度も測られていない。
- **期待する振る舞い** — 描き終わる。横スクロールは出ない。入力欄と送信ボタンは押せる場所に残る。
  最後まで送られて、会話の末尾が見えている。
- **手順の要点**
  - `openNimbusSidebar` してから、`#log` を持ち `data-assistant === 'Claude'` で `clientWidth > 0` かつ
    `offsetParent !== null` のフレームを選ぶ（畳まれた面・ゆあの面を掴むと T-329/T-340 の形になる）。
  - 流し込む `history` は**拡張が実際に送るのと同じ形**にする（形を変えると、落ちても製品の不具合とは
    言えなくなる）。webview の中から `window.postMessage` を投げれば同じ listener が拾う。
  - 巨大な 1 段落は **10 万字ではなく 2,000 字**の切れ目の無い ASCII（minify 済みの 1 行を貼られた、
    という現実にある形）。狙いは `overflow-wrap: anywhere` **1 枚**の回帰よけなので 2,000 字で足りる。
  - **横の破綻は `#log` の `scrollWidth <= clientWidth + 2` で測る。** `documentElement` は
    `.chat-list { overflow-x: hidden }` と `height: 100vh` の flex のせいで**壊れていても伸びない**
    ＝ その判定は緑のまま素通りする。
  - **所要時間は `ctx.expect` にしない。** 描き切ったことだけを判定し、ms は `console.log` で残す
    （壁時計で緑赤を決めると、共有 Electron の混み具合で揺れる）。待ちは 800ms × 最大 40 回。
  - 「末尾が見えている」を判定に入れる（`scrollTop` が `scrollHeight - clientHeight` の 40px 以内）。
    `#input` に値を入れて読み返す判定は**入れない**（面が生きていれば必ず通る）。
  - `ctx.withClaude` のときは先頭で `return`（後始末の空 history が本物のセッションの帯を殺す）。
  - finally: 空の `history`（`resetToBlank` と同じ形）を送って `.turn` が 0 に戻ったことを確かめる。
    `#log` の `innerText` を丸ごと読まない。
- **根拠** — `extensions/nimbus/media/cockpit.js:146-148（atBottom）, 173-177（stickToBottom）, 1596-1608（描き直し）` /
  `extensions/nimbus/media/cockpit.css:307-311, 380-384` /
  `extensions/nimbus/src/extension.ts:294（MAX_RETAINED_EVENTS）, 297, 3123-3128` /
  `extensions/nimbus/src/cockpit/CockpitViewProvider.ts:294（snapshot）, 297` /
  `extensions/nimbus/src/events.ts:164-178`（流し込む形）
  （※ タブ切り替えで送られるのは `MAX_ARCHIVED_EVENTS = 500`。2,000 件が一度に届くのは
  面を開き直したときの `snapshot()` 経路。このケースは後者を模している）

#### adv-21 下書きが上限を超えていたら、黙って捨てずに数を言う（`cases/adv-21-drafts-over-cap.mjs`）

- **疑っている壊れかた** — 下書きの復元には上限 `MAX_RESTORED_DRAFTS = 20` がある。コードのコメントは
  「あふれたぶんは**黙って捨てずに数を言う**」と宣言しているが、実装は `sound.slice(-20)` で
  **黙って切っている**（T-364 と同じ「コメントが嘘をつく」形）。捨てられるのは古い 5 本で、
  番号（名札・T-316）も一緒に消える — 利用者から見れば T-368 の再発と区別が付かない。
- **期待する振る舞い** — 25 本あったなら 25 本戻るか、20 本に畳んだことと**捨てた本数**を言う。
- **手順の要点** — コマンドパレットは 1 回 4 秒かかる（`runCommand` の待ち）ので、列が出たら
  `+`（`.session-tab-add`）を直接押す。関門は閉じる前に 25 本あること。判定は
  「25 本」または「20 本 かつ 通知に `古い 5 件`」。
- **根拠** — `extensions/nimbus/src/extension.ts`（`const drafts: Draft[]` の IIFE）
- **実測（2026-09-02・直す前）**: 25 本 → 20 本、通知なし。

### 3.8 中断とキャンセル（interrupt-and-cancel）

途中でやめる・待たずに閉じる。**人は flush を待たない。** この観点はスキルの表で
「まだケースが無い」だった。ここが最初の 1 本。

#### adv-20 「+」と打鍵の直後に閉じても、下書きタブと打ちかけは残る（`cases/adv-20-close-right-after.mjs`）

- **疑っている壊れかた** — 下書きの保存は `void context.workspaceState.update(...)` で
  **待たずに投げっぱなし**（拡張ホスト → main の IPC）。打ちかけの `vscode.setState` も webview →
  ホストへの postMessage で、書き込みは終了時の flush 頼み。ケース 69/71 は押してから
  **0.6〜0.9 秒待ってから**閉じている。
- **期待する振る舞い** — 押した直後・打った直後に閉じても、同じタブ・同じ本文がある
  （T-368 / T-376 の約束は「閉じても消えない」であって「1 秒待ってから閉じれば消えない」ではない）。
- **手順の要点** — 列を出すまで（2 本）は普通に待つ。以後は `+` → 打鍵 → 閉じる直前の状態を読む
  （数十 ms）→ **待たずに** `ctx.restart()`。判定は番号の集合と本文の一致。
- **根拠** — `extensions/nimbus/src/extension.ts`（`persistDrafts`）/ `media/cockpit.js`（`rememberDraftText`）
- **実測（2026-09-02）**: 通った。終了時の flush は待たなくても効いている。

## 4. 落ちたときの読みかた

**赤 ＝ 不具合ではない。** 敵対束は決めていない場所を叩くので、赤には 3 種類ある。
順番に潰す。**②を疑う前に①を疑う。**

### ① 仕様が決まっていない

- **見分けかた** — 仕様書（`nimbus/docs/specs/`）に、その振る舞いの記述が無い。あるいは
  コードのコメントが逆のことを宣言している。
- **やること** — **直さない。ケースも直さない。** `tasks.md` に「決めていないこと」として 1 行起こし、
  利用者に判断を仰ぐ。決まったら**仕様書の追記とケースを同じコミットで**入れる。
- 例: Home の開閉を面ごとに持つか provider ごとに持つか（adv-12）/ 添付名の双方向制御文字を剥がすか
  （adv-10）/ 読めない設定ファイルを空とみなすか（adv-08）。**試験で仕様を新しく決めてはいけない。**

### ② ハーネスの都合

- **見分けかた** — 単独（`--only`）で通り、束で落ちる。または落ちかたが実行のたびに変わる。
  失敗メッセージに出た枚数・幅・タブ数が、そのケースが置いたものと合っていない。
- **よくある原因** — 前のケースが残した面・下書き・添付・タブ・サイドバー幅・全画面フラグ
  （`resetWorkbench` はエディタしか戻さない）/ 絶対数を数えている判定 / 境界ちょうどの判定 /
  壁時計の判定 / 前のケースのトーストを `notificationText` が拾っている。
- **やること** — **製品ではなく試験を直す。** 直すのは 3 か所のどれか:
  (a) 落ちたケースの finally（残したものを戻す）、(b) 前のケースの finally、
  (c) 判定を「自分が置いたものを名前で探す」形に書き換える。
  直したら**単独と束の両方**で通ることを確かめる。

### ③ 本物の不具合

- **見分けかた** — 単独でも束でも同じように落ち、経路をコードで追える。仕様書かコードのコメントが
  「そうならない」と書いている。
- **やること**
  1. `tasks.md` に **T 番号を起こす**（既存の最大 ＋1）。落ちたケースのファイル名と失敗メッセージを添える。
  2. 直すのは**別のコミット**。敵対ケースを足すコミットに製品の修正を混ぜない
     （どちらが原因で緑になったのか読めなくなる）。
  3. 直したら**回帰テストを 1 本足す**。敵対ケースがそのまま回帰テストになるなら、
     テストの中に T 番号をコメントで書いて、そのまま残す。
  4. コア（`src/vs/**`）に触ったら `nimbus/docs/core-changes.md` にも記録する。
- **既に本物と分かっているもの**（着手前に読む） — adv-10（ドロップの二重取り・普通の利用者が毎回踏む）/
  adv-07（無い実行ファイルを「揃っている」と言う）/ adv-16（戻すが閉じるになる）/
  adv-01（型崩れ 1 本で一覧が開かない）/ adv-02（型崩れ 1 本でルール一覧が開かない）/
  adv-05（数字にだけ残る札）/ adv-14（狭い面で会話が潰れる）。

**どの種類でも、赤を放置して次へ進まない。** 敵対束は「赤があるのが普通」にした瞬間に価値を失う。

## 5. 今回は採らなかった案

捨てた記録も残す。**後から状況が変われば復活できる形**にしてある。

| 案 | 観点 | 落とした理由 | 復活の条件 |
| --- | --- | --- | --- |
| 前面の下書きを × で閉じたら隣が前面になる | 順番 | 機構は本物（下書き分岐だけ隣へ移さない）。だが列が 1 本になると `.session-tab` が 1 つも描かれず**後始末で元へ戻せない**。`--with-claude` では先頭が実セッションになり `{ modal: true }` を踏む | 後始末が要らない形（下書き 3 本以上を保ったまま真ん中を閉じる）に組み直し、対象を「下書きであること」で確かめてから押す |
| ⌘⇧P で打った文字が指示欄へ流れ込まない | 順番 | 測っているのは**ハーネスの既知の癖**。`helpers.runCommand` が再試行＋焦点戻しで既に回避済み。開くかどうかは非決定で、`opened1 === opened2` は不具合が無くても揺れる。直しどころも upstream 側 | `preserveFocus` を変える判断が下りたとき、その振る舞いの確認として書く |
| ゆあの面を開いて戻ってもコックピットが変わらない | 順番 | `retainContextWhenHidden: true` で書きかけは残り、ゆあは別インスタンスで配線が無い ＝ **作りから通ることが決まっている**。しかも T-329/T-340 は製品ではなく `run.mjs` の後片付けの話 | `retainContextWhenHidden` を外す判断が出たとき |
| 「新しいセッション」を 5 連打 | 競合 | `newSession` は `updateSessionTabs()` まで全部同期。拡張ホストは単一スレッドなので**構造上必ず通る**。守備範囲も 54 / 62 と重複。後始末の × が modal を踏む | `newSession` に await が入ったとき |
| タブの × を同じ場所で 3 連打 | 競合 | 再描画より連打が速いので 3 回とも同じ古いノードへ落ちて緑になる ＝ タイミング次第の表裏。「列は指の下で寸法を凍らせる」は**どの仕様書にも無い** | 「削除中は寸法を凍らせる」を仕様として決めたとき。その場合も対象は下書きに限る |
| 上限いっぱいで「続きから」を連打 | 競合 | 名前に反して**同時実行がどこにも無い**（逐次）。しかも `showSessions` の一覧はディスクから作られ、T-344 が言う「行が消える」の実体は列に出る「前回のセッション」＝**この面では触れない**。心拍 TTL 20 秒を跨ぐと実 CLI が起きて課金する | T-344 の回帰は**モジュールテスト**で足す（`admit` を通してから `delete` する順序） |
| 知らない状態・欠けた欄の札 | 敵意 | 柱の 1 本が事実誤認（`textContent = undefined` は空文字になる。文字列 `undefined` は出ない）。残る「数の食い違い」は adv-05 に畳んだ | — （adv-05 が引き継いだ） |
| 10万字の下書きを入力欄に貼る | 敵意 | 判定のほぼ全部が構造上必ず緑（高さは `Math.min(…, 220)`、`.value` は HTML として解釈されない、候補 0 件なら必ず閉じる）。唯一非自明な実行時間は束の負荷で揺れる | 入力欄に切り詰めや整形が入ったとき |
| 台帳の見出しに改行と 3 万字 | 敵意 | 落ちうる判定が 2 本ともに未決（読み手の畳み義務・双方向制御文字を剥がす義務）。しかも QuickPick の行は固定高で CSS が切るので**利用者に見える害が無い**。残りは 40 と実質重複 | 「読み手も畳む」を仕様として決めたとき |
| 未来を指す心拍は「生きている」ではない | 壊れた記録 | 穴は実在（上限側の検査が無い）が、**純粋関数 1 本の話**で `sessionRegistry.test.ts` が既にある。GUI に持ち込むと後始末の失敗リスク（毒が残ると上限 2/2 で以後の送信が全滅）だけを払う。しかも「未来の心拍＝死んだ扱い」に倒すと、時計が進んだだけの**生きたウィンドウからセッションを奪う**道が開く | **モジュールテストで足す**（GUI では書かない）。倒しかたは仕様として先に決める |
| 束（タブ）の所属がウィンドウの開き直しで消えない | 壊れた記録 | **不具合自体は本束で最も重い**（起動時の `alive` に「前回のセッション」が入らず members を刈り、他ウィンドウの所属まで潰す）。落としたのは手順のほう —— 再読込は真っさらな userDataDir の 1 回目が英語で、成功した瞬間に画面全体が日本語へ切り替わり、後続 3 件を巻き込む。無題エディタが残っていれば保存確認で束が死ぬ | **不具合は板に T 番号を起こして別扱いにする。** 確認は `pruneMembers` のモジュールテストで足す。GUI で書くなら再読込の要らない形を先に見つける |
| git で管理されていないフォルダ | 空と欠け | 本命の判定が不当（実装は日本語の前置きの後ろに詳細を添えており「英語を貼るだけ」は事実に反する）。残りは確認弾で adv-09 と重複。`.git` の退避は束でいちばん危険（finally に届かないと以後の全ケースの `resetWorkspace` が落ちる） | 「生の stderr を添えない」を仕様として決めたとき。その場合も `.git` は退避せず、別フォルダを開く形にする |
| セッション 0・タスク 0 のときの数えかた | 空と欠け | 4 つとも既に実装済みの 0 件分岐をなぞるだけで、落ちる見込みが薄い | 0 件の文言や入口を作り直すとき、その回帰として |