/**
 * 板（tasks.md）の今の状態を 1 画面で見る（tasks.md T-264）。
 *
 * 「作業前に必ず板へ書き出す」という運用ルールは、守られているかを**見られないと守れない**。
 * 着手する前にこれを走らせて、同じ範囲に札（`@session-x`）が立っていないかを確かめる。
 *
 *   node nimbus/scripts/board.mjs          # 進行中の札・未着手・ID の重複
 *   node nimbus/scripts/board.mjs --mine session-d   # 自分の札だけ
 */
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const text = readFileSync(join(ROOT, 'tasks.md'), 'utf8')

const mineIndex = process.argv.indexOf('--mine')
const mine = mineIndex >= 0 ? process.argv[mineIndex + 1] : undefined

/** 見出しごとに、その下のタスク行を集める */
function collect() {
  const sections = new Map()
  let current = ''
  for (const line of text.split('\n')) {
    const heading = /^##\s+(.+)$/.exec(line)
    if (heading) {
      current = heading[1].trim()
      continue
    }
    const task = /^- \[( |x)\] (T-\d+) (.*)$/.exec(line)
    if (!task) {
      continue
    }
    const [, done, id, rest] = task
    const claims = [...rest.matchAll(/@([\w-]+)/g)].map((match) => match[1])
    const entries = sections.get(current) ?? []
    entries.push({ id, done: done === 'x', claims, title: rest.replace(/\s+—.*$/, '').slice(0, 60) })
    sections.set(current, entries)
  }
  return sections
}

const sections = collect()
const inProgress = sections.get('進行中') ?? []
const inbox = sections.get('Inbox（未整理）') ?? []
const next = sections.get('次にやる') ?? []

console.log('# 板の状態\n')

console.log(`## 進行中（${inProgress.length}）`)
for (const task of inProgress) {
  if (mine && !task.claims.includes(mine)) {
    continue
  }
  const who = task.claims.length > 0 ? task.claims.map((name) => `@${name}`).join(' ') : '**札なし**'
  console.log(`- ${task.id} ${task.title} — ${who}`)
}

const unclaimed = [...inbox, ...next].filter((task) => !task.done && task.claims.length === 0)
console.log(`\n## まだ誰も取っていない（${unclaimed.length}）`)
for (const task of unclaimed) {
  console.log(`- ${task.id} ${task.title}`)
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
