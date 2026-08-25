/**
 * 板（tasks.md）の今の状態を 1 画面で見る（tasks.md T-264）。
 *
 * 「作業前に必ず板へ書き出す」という運用ルールは、守られているかを**見られないと守れない**。
 * 着手する前にこれを走らせて、同じ範囲に札（`@session-x`）が立っていないか、
 * 触るファイルが作業予約（`- 🔒` 行・T-321）で握られていないかを確かめる。
 *
 *   node nimbus/scripts/board.mjs          # 作業予約（🔒）・進行中の札・未着手・ID の重複
 *   node nimbus/scripts/board.mjs --mine session-d   # 自分の札だけ
 */
import { readFileSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * 見出しごとに、その下のタスクを集める。
 *
 * **1 タスクは 1 行とは限らない。** 板の書きかたでは、続きは字下げして次の行に書く
 * （区切りは空行）。札（`@session-x`）が 2 行目以降に書かれることも多いので、
 * 続きの行まで読んでから札を数える（T-283）。
 *
 * 作業予約の行（`- 🔒 @session-x | T-123 | 日時 | ファイル…`）はタスクとしては数えず、
 * `locks` として別に返す（T-321）。
 */
export function collect(text) {
  const sections = new Map()
  /** タスク行のつもりで書かれているのに読めなかった行（T-283） */
  const unreadable = []
  /** 作業予約（ファイルの札・T-321）。解放されるまで、入っているファイルは他のセッションが触らない */
  const locks = []
  let current = ''
  /** いま読んでいるタスク。続きの行はここへ足す */
  let open = null

  const finish = () => {
    if (!open) {
      return
    }
    const claims = [...open.body.matchAll(/@([\w-]+)/g)].map((match) => match[1])
    const entries = sections.get(open.section) ?? []
    entries.push({ id: open.id, done: open.done, claims: [...new Set(claims)], title: open.title })
    sections.set(open.section, entries)
    open = null
  }

  for (const line of text.split('\n')) {
    const heading = /^##\s+(.+)$/.exec(line)
    if (heading) {
      finish()
      current = heading[1].trim()
      continue
    }
    if (line.trim() === '') {
      // 空行がタスクの区切り。ここで閉じておかないと、次のタスクへ札が混ざる
      finish()
      continue
    }
    if (open && /^\s+\S/.test(line)) {
      open.body += `\n${line}`
      continue
    }
    const lock = /^- 🔒\s*(?<body>.*)$/.exec(line)
    if (lock) {
      const parts = lock.groups.body.split('|').map((part) => part.trim())
      locks.push({
        session: (parts[0] ?? '').replace(/^@/, ''),
        id: parts[1] ?? '',
        since: parts[2] ?? '',
        files: (parts[3] ?? '').split(',').map((file) => file.trim()).filter(Boolean)
      })
      continue
    }
    if (!/^- \[( |x)\] /.test(line)) {
      continue
    }
    finish()
    // **ID の直後が空白とは限らない。** `T-282（旧 T-276 …）` のように注釈が続く書きかたが実在する。
    // ここで取りこぼすと、板の上では進行中なのに道具は「0 件」と言う（T-283）。
    // 最初の 7 つの節目は `F0`〜`F6` で振られているので、そちらも ID として読む
    const task = /^- \[( |x)\] (T-\d+|F\d+)\s*(.*)$/.exec(line)
    if (!task) {
      unreadable.push({ section: current, line: line.trim() })
      continue
    }
    const [, done, id, rest] = task
    // 先頭の注釈（`（旧 T-276 …）`）は見出しの邪魔になるだけなので落とす
    const title = rest.replace(/^（[^）]*）/, '').replace(/\s+—.*$/, '')
    open = { section: current, id, done: done === 'x', title: title.slice(0, 60), body: rest }
  }
  finish()
  return { sections, unreadable, locks }
}

/**
 * 予約が「落ちたセッションの置き土産」かを、心拍とファイルの静けさで判定する（T-328）。
 *
 * 🔒 の時刻は開始ではなく最終更新（コミットごとに書き直す約束）。それが 60 分止まり、
 * 予約されたファイルの更新も 30 分止まっていたら、持ち主は落ちたとみなす。
 * ファイルの時刻が 1 つも取れないとき（これから作る新規だけ、など）は心拍だけで判定する。
 * 落ちていたときにどう引き継ぐかは CLAUDE.md「止まったタスクは、続きから再開できる形にする」。
 */
export function assess(lock, now, fileTimes) {
  const beat = Date.parse(lock.since.replace(' ', 'T'))
  const heartbeatMinutes = Number.isNaN(beat) ? null : Math.max(0, Math.floor((now - beat) / 60000))
  const latest = fileTimes.length > 0 ? Math.max(...fileTimes) : null
  const quietMinutes = latest === null ? null : Math.max(0, Math.floor((now - latest) / 60000))
  const stalled = heartbeatMinutes !== null && heartbeatMinutes >= 60 && (quietMinutes === null || quietMinutes >= 30)
  return { heartbeatMinutes, quietMinutes, stalled }
}

/** 予約されたファイルの最終更新（ミリ秒）。まだ無いファイル（新規の予定）は数えない */
function fileTimes(files) {
  const times = []
  for (const file of files) {
    try {
      times.push(statSync(join(ROOT, file)).mtimeMs)
    } catch {
      // 予約には「これから作るファイル」も書く約束なので、無いこと自体は異常ではない
    }
  }
  return times
}

/** 分を読める長さにする（90 分までは分、それより上は時間） */
function age(minutes) {
  return minutes <= 90 ? `${minutes} 分` : `${(minutes / 60).toFixed(1)} 時間`
}

/** CLI として走らせたときだけ、板を読んで出す */
function main() {
  const text = readFileSync(join(ROOT, 'tasks.md'), 'utf8')
  const mineIndex = process.argv.indexOf('--mine')
  const mine = mineIndex >= 0 ? process.argv[mineIndex + 1] : undefined
  const { sections, unreadable, locks } = collect(text)
  const inProgress = sections.get('進行中') ?? []
  const inbox = sections.get('Inbox（未整理）') ?? []
  const next = sections.get('次にやる') ?? []

  console.log('# 板の状態\n')

  // 予約されたファイルは、行が消える（解放）まで他のセッションは編集しない（T-321）。
  // 心拍とファイルの静けさから「持ち主が落ちた」予約を見つけ、引き継ぎにつなげる（T-328）
  console.log(`## 作業予約（${locks.length}）— 入っているファイルは解放まで触らない`)
  const now = Date.now()
  for (const lock of locks) {
    const files = lock.files.join(', ') || '（ファイル未記入）'
    const verdict = assess(lock, now, fileTimes(lock.files))
    const beat = verdict.heartbeatMinutes === null ? '' : `（心拍 ${age(verdict.heartbeatMinutes)}前）`
    const quiet = verdict.quietMinutes === null ? 'ファイルは見当たらない' : `ファイルも ${age(verdict.quietMinutes)}静か`
    const warn = verdict.stalled ? ` ⚠ 持ち主は落ちていそう（${quiet}）— CLAUDE.md の手順で引き継げる` : ''
    console.log(`- @${lock.session} ${lock.id} ${lock.since}${beat} — ${files}${warn}`)
  }

  console.log(`\n## 進行中（${inProgress.length}）`)
  for (const task of inProgress) {
    if (mine && !task.claims.includes(mine)) {
      continue
    }
    const who = task.claims.length > 0 ? task.claims.map((name) => `@${name}`).join(' ') : '**札なし**'
    console.log(`- ${task.id} ${task.title} — ${who}`)
  }

  // 札は Inbox にも立つ（進行中へ移す前に確保することがある）。どの段でも @ を見る
  const unclaimed = [...inbox, ...next].filter((task) => !task.done && task.claims.length === 0)
  console.log(`\n## まだ誰も取っていない（${unclaimed.length}）`)
  for (const task of unclaimed) {
    console.log(`- ${task.id} ${task.title}`)
  }

  const claimedElsewhere = [...inbox, ...next].filter((task) => !task.done && task.claims.length > 0)
  if (claimedElsewhere.length > 0) {
    console.log(`\n## 板の上流で確保済み（${claimedElsewhere.length}）`)
    for (const task of claimedElsewhere) {
      console.log(`- ${task.id} ${task.title} — ${task.claims.map((name) => `@${name}`).join(' ')}`)
    }
  }

  // 同じ ID が 2 つあると、コミットメッセージの参照先が定まらない。
  // 完了は数えない（T-084 のように ①②③ と分けて片付けたものが並ぶのは正しい）
  const counts = new Map()
  for (const entries of sections.values()) {
    for (const task of entries) {
      if (task.done) {
        continue
      }
      counts.set(task.id, (counts.get(task.id) ?? 0) + 1)
    }
  }
  const duplicated = [...counts.entries()].filter(([, count]) => count > 1)
  if (duplicated.length > 0) {
    console.log(`\n## ID の重複（後からコミットする側が採番し直す）`)
    for (const [id, count] of duplicated) {
      console.log(`- ${id} が ${count} 行`)
    }
  }

  // 札の立っていない進行中は、放置されて誰も拾えなくなる
  const unowned = inProgress.filter((task) => task.claims.length === 0)
  if (unowned.length > 0) {
    console.log(`\n## 進行中なのに札が無い（${unowned.length}）— 担当と日付を書く`)
    for (const task of unowned) {
      console.log(`- ${task.id} ${task.title}`)
    }
  }

  // **読めなかった行は黙って捨てない**（T-283）。捨てると「板に書いたのに道具からは見えない」
  // という、いちばん気づけない壊れかたになる。数えられなかったことを、その場で言う
  if (unreadable.length > 0) {
    console.log(`\n## 読めなかったタスク行（${unreadable.length}）— ID（\`T-123\`）から書き始める`)
    for (const entry of unreadable) {
      console.log(`- ${entry.section || '(見出しの外)'}: ${entry.line.slice(0, 70)}`)
    }
  }
}

// テストから読み込むときは何も出さない（走らせたときだけ動く）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
