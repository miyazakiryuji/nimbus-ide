/**
 * 直したものが、いま何に守られているかを見る（tasks.md T-274 ①）。
 *
 * 回帰は実際に起きている（T-091 は一度直したあとに戻り、`3d3be9a5a81` で直し直した）。
 * 戻ったことに気づけないのは、**その修正を守るテストが無い**か、あっても
 * 「どの修正を守っているのか」が分からないから。
 *
 * ここでは板の完了行と、テスト（モジュール・GUI）の中の T 番号を突き合わせ、
 * **守りの無い完了**を出す。番号はテストの本文（見出しコメントでよい）に書いてあれば拾う。
 *
 *   node nimbus/scripts/regression-guard.mjs           # 守りの無いものを新しい順に
 *   node nimbus/scripts/regression-guard.mjs --all     # 全部出す
 *   node nimbus/scripts/regression-guard.mjs --strict  # 1 件でもあれば終了コード 1
 */
import { readFileSync, readdirSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LIMIT = 40

const args = process.argv.slice(2)
const showAll = args.includes('--all')
const strict = args.includes('--strict')

/** 板の完了行（新しい順に並んでいる）から、T 番号の組を取る */
function completedGroups() {
  const text = readFileSync(join(ROOT, 'tasks.md'), 'utf8')
  const groups = []
  for (const line of text.split('\n')) {
    const done = /^- \[x\] (.*)$/.exec(line)
    if (!done) {
      continue
    }
    const ids = [...done[1].matchAll(/T-(\d{3})/g)].map((m) => `T-${m[1]}`)
    if (ids.length === 0) {
      continue
    }
    // 1 行に並ぶ番号は「まとめて片付けた 1 件」。守りも 1 本あればよい
    // 見出しから番号を落とす（一覧で「T-274 T-274 …」と二重に出ないように）
    const title = done[1].replace(/^(?:T-\d{3}\s*(?:\/|・)?\s*)+/, '').replace(/\s+/g, ' ').slice(0, 72)
    groups.push({ ids: [...new Set(ids)], title })
  }
  return groups
}

/** テストの中に出てくる T 番号（どのファイルが守っているかも覚える） */
function guarded() {
  const found = new Map()
  const roots = [
    join(ROOT, 'extensions', 'nimbus', 'src', 'test'),
    join(ROOT, 'nimbus', 'tests', 'gui', 'cases')
  ]
  for (const dir of roots) {
    if (!existsSync(dir)) {
      continue
    }
    for (const name of readdirSync(dir)) {
      if (!/\.(ts|mjs)$/.test(name)) {
        continue
      }
      const text = readFileSync(join(dir, name), 'utf8')
      for (const match of text.matchAll(/T-(\d{3})/g)) {
        const id = `T-${match[1]}`
        found.set(id, [...(found.get(id) ?? []), name].slice(0, 3))
      }
    }
  }
  return found
}

const groups = completedGroups()
const guards = guarded()
const unguarded = groups.filter((group) => group.ids.every((id) => !guards.has(id)))

console.log('# 直したものの守り（T-274）\n')
console.log(`完了 ${groups.length} 件 / 守りのあるもの ${groups.length - unguarded.length} 件 / **守りの無いもの ${unguarded.length} 件**\n`)

const shown = showAll ? unguarded : unguarded.slice(0, LIMIT)
console.log('## 守りが無い（戻っても気づけない）\n')
for (const group of shown) {
  console.log(`- ${group.ids.join(' / ')} ${group.title}`)
}
if (!showAll && unguarded.length > shown.length) {
  console.log(`\n（ほか ${unguarded.length - shown.length} 件。全部見るには --all）`)
}

if (strict && unguarded.length > 0) {
  process.exitCode = 1
}
