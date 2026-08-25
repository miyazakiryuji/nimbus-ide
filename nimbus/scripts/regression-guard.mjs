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
 *   node nimbus/scripts/regression-guard.mjs --suggest # 既にテストがあるのに番号が書かれていないもの
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
    join(ROOT, 'nimbus', 'tests', 'gui', 'cases'),
    // リポジトリの道具（板・ドクター）の守りもここに置く（T-283）
    join(ROOT, 'nimbus', 'tests', 'scripts'),
    // コア側（sessions レイヤー）に置いた機能のテスト。IntelliJ 由来（T-224〜T-231）が
    // ここに居るのに走査していなかったので、「守りが無い」と偽って出ていた
    join(ROOT, 'src', 'vs', 'sessions')
  ]
  for (const dir of roots) {
    if (!existsSync(dir)) {
      continue
    }
    // コア側（src/vs/sessions）は入れ子が深いので再帰で読む。テストだけを見る
    for (const name of readdirSync(dir, { recursive: true })) {
      const entry = String(name)
      if (!/\.(test\.ts|mjs)$/.test(entry) && !(dir.endsWith('test') && /\.ts$/.test(entry))) {
        continue
      }
      const text = readFileSync(join(dir, entry), 'utf8')
      for (const match of text.matchAll(/T-(\d{3})/g)) {
        const id = `T-${match[1]}`
        found.set(id, [...(found.get(id) ?? []), String(name)].slice(0, 3))
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

/**
 * 既にテストがあるのに、番号が書かれていないだけのもの（T-278 の棚卸し用）。
 *
 * 実装のファイルには T 番号が書いてある（見出しコメントの約束）。
 * そのファイルを取り込んでいるテストがあれば、**守りはもうある**。足りないのは番号だけ。
 */
function suggest() {
  const sources = []
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name)
      if (name.isDirectory()) {
        if (name.name !== 'test') {
          walk(path)
        }
      } else if (name.name.endsWith('.ts')) {
        sources.push(path)
      }
    }
  }
  walk(join(ROOT, 'extensions', 'nimbus', 'src'))

  const testDir = join(ROOT, 'extensions', 'nimbus', 'src', 'test')
  const tests = readdirSync(testDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, text: readFileSync(join(testDir, name), 'utf8') }))

  console.log('\n## 番号を書き足せば守りになるもの（既にテストがある）\n')
  let count = 0
  for (const group of unguarded) {
    const hits = new Set()
    for (const id of group.ids) {
      for (const source of sources) {
        if (!readFileSync(source, 'utf8').includes(id)) {
          continue
        }
        // `.../src/core/foo.ts` を取り込んでいるテストを探す
        const module = source.slice(source.lastIndexOf('/src/') + 5).replace(/\.ts$/, '')
        const needle = `/${module.split('/').pop()}'`
        for (const test of tests) {
          if (test.text.includes(needle)) {
            hits.add(test.name)
          }
        }
      }
    }
    if (hits.size > 0) {
      count++
      console.log(`- ${group.ids.join(' / ')} → ${[...hits].slice(0, 3).join(', ')}`)
    }
  }
  console.log(`\n${count} 件は番号を書き足すだけで守りになる`)
}

if (args.includes('--suggest')) {
  suggest()
}

if (strict && unguarded.length > 0) {
  process.exitCode = 1
}
