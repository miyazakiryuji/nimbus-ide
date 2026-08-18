/**
 * 並列で走らせたときに、何がどれだけ壊れて、どれだけ遅くなるかを測る（tasks.md T-248）。
 *
 * **対策より先に測る。** 当てずっぽうで直すと、直っていないものを直したことにしてしまう。
 * ここで測るのは Nimbus 自身が持っている共有の書き込み口だけで、
 * Claude の API そのものの速さは測らない（課金が発生するうえ、こちらでは制御できない）。
 *
 *   node nimbus/scripts/bench-parallel.mjs            # 既定（書き手 4・1 人 200 行）
 *   node nimbus/scripts/bench-parallel.mjs --writers 8 --lines 500
 *
 * 拡張のビルド結果（`extensions/nimbus/out/`）を読むので、先に
 * `npx tsc -p extensions/nimbus` を通しておくこと。
 */
import { fork } from 'child_process'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const OUT = join(REPO, 'extensions', 'nimbus', 'out')

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? Number(process.argv[index + 1]) : fallback
}

const WRITERS = arg('writers', 4)
const LINES = arg('lines', 200)

/** 子プロセス側。役割は環境変数で受け取る */
if (process.env['BENCH_ROLE']) {
  await runWorker(process.env['BENCH_ROLE'], JSON.parse(process.env['BENCH_ARGS'] ?? '{}'))
  process.exit(0)
}

if (!existsSync(join(OUT, 'sessionStore.js'))) {
  console.error('先に `npx tsc -p extensions/nimbus` を通してください（out/ が要ります）')
  process.exit(1)
}

const root = await mkdtemp(join(tmpdir(), 'nimbus-bench-'))
console.log(`# 並列時の破損と遅延（T-248）\n`)
console.log(`書き手 ${WRITERS} プロセス × 1 人あたり ${LINES} 件 / ${new Date().toISOString().slice(0, 10)}\n`)

const rows = []
rows.push(await measure('監査ログ：読んで書き直す（旧）', 'audit-rewrite', join(root, 'audit-old.jsonl')))
rows.push(await measure('監査ログ：追記だけ（新・T-250）', 'audit-append', join(root, 'audit-new.jsonl')))
rows.push(await measure('台帳：1 つの JSON に全部（旧）', 'registry-single', join(root, 'registry-old')))
rows.push(await measure('台帳：1 セッション 1 ファイル（新・T-247）', 'registry-store', join(root, 'registry-new')))

console.log('| 書きかた | 残った件数 / 期待 | 消えた件数 | 所要 ms | 1 件あたり ms |')
console.log('| --- | --- | --- | --- | --- |')
for (const row of rows) {
  console.log(
    `| ${row.label} | ${row.kept} / ${row.expected} | ${row.lost} | ${row.ms} | ${(row.ms / row.expected).toFixed(3)} |`
  )
}

console.log(`\n## 追記そのものの伸びかた（ファイルが育つほど遅くなるか）\n`)
console.log('| 既にある行数 | 読んで書き直す ms | 追記だけ ms |')
console.log('| --- | --- | --- |')
for (const existing of [0, 1000, 10000, 50000]) {
  const [rewrite, append] = await growthCost(join(root, `growth-${existing}`), existing)
  console.log(`| ${existing} | ${rewrite} | ${append} |`)
}

console.log(`\n## イベント 1 件あたりの畳み込み（面を開いたまま並列で走らせたときに効く）\n`)
await eventCost()

await rm(root, { recursive: true, force: true })

/** 書き手を N プロセス起こして、同時に書かせる */
async function measure(label, role, target) {
  await rm(target, { recursive: true, force: true })
  if (role.startsWith('registry')) {
    await mkdir(target, { recursive: true })
  } else {
    await mkdir(dirname(target), { recursive: true })
  }
  const started = Date.now()
  await Promise.all(
    Array.from({ length: WRITERS }, (_, index) =>
      new Promise((resolve, reject) => {
        const child = fork(fileURLToPath(import.meta.url), [], {
          env: { ...process.env, BENCH_ROLE: role, BENCH_ARGS: JSON.stringify({ target, index, lines: LINES }) },
          stdio: 'ignore'
        })
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`writer ${index} exit ${code}`))))
      })
    )
  )
  const ms = Date.now() - started
  const expected = WRITERS * LINES
  const kept = await countKept(role, target)
  return { label, expected, kept, lost: expected - kept, ms }
}

async function countKept(role, target) {
  if (role.startsWith('audit')) {
    const text = await readFile(target, 'utf8').catch(() => '')
    return text.split('\n').filter((line) => {
      try {
        return Boolean(JSON.parse(line))
      } catch {
        return false
      }
    }).length
  }
  if (role === 'registry-single') {
    const text = await readFile(join(target, 'sessions.json'), 'utf8').catch(() => '{}')
    let parsed = {}
    try {
      parsed = JSON.parse(text)
    } catch {
      // 壊れた JSON は 0 件として数える（読めない台帳は無いのと同じ）
      return 0
    }
    return Object.values(parsed).reduce((sum, entry) => sum + (entry?.writes ?? 0), 0)
  }
  const { SessionStore } = await import(pathToFileURL(join(OUT, 'sessionStore.js')).href)
  const store = new SessionStore(target, { windowId: 'reader', heartbeatMs: 60 * 60 * 1000 })
  const records = await store.list({ fresh: true })
  store.dispose()
  return records.reduce((sum, record) => sum + (record.totalCostUsd ?? 0), 0)
}

/** 既に n 行あるファイルへ 1 行足すのに、どれだけかかるか */
async function growthCost(target, existing) {
  await mkdir(dirname(target), { recursive: true })
  const seed = `${'{"k":"x","payload":"' + 'a'.repeat(120) + '"}\n'}`.repeat(existing)
  const rewriteFile = `${target}-rewrite.jsonl`
  const appendFile_ = `${target}-append.jsonl`
  await writeFile(rewriteFile, seed)
  await writeFile(appendFile_, seed)
  const line = `{"k":"new"}\n`
  const ROUNDS = 20
  let started = Date.now()
  for (let i = 0; i < ROUNDS; i++) {
    const current = await readFile(rewriteFile)
    await writeFile(rewriteFile, Buffer.concat([current, Buffer.from(line)]))
  }
  const rewriteMs = ((Date.now() - started) / ROUNDS).toFixed(2)
  started = Date.now()
  for (let i = 0; i < ROUNDS; i++) {
    await appendFile(appendFile_, line)
  }
  const appendMs = ((Date.now() - started) / ROUNDS).toFixed(2)
  await rm(rewriteFile, { force: true })
  await rm(appendFile_, { force: true })
  return [rewriteMs, appendMs]
}

/** 溜まったイベントを畳み直す処理が、件数に対してどう伸びるか */
async function eventCost() {
  const { buildTimeline } = await import(pathToFileURL(join(OUT, 'core', 'activity.js')).href).catch(() => ({}))
  const timeline = await import(pathToFileURL(join(OUT, 'core', 'activity.js')).href)
  const build = timeline.buildActivity ?? buildTimeline
  if (typeof build !== 'function') {
    console.log('（`core/activity.js` に buildActivity が無いので測れませんでした）')
    return
  }
  console.log('| 溜まったイベント数 | 1 回畳むのに ms |')
  console.log('| --- | --- |')
  for (const size of [100, 500, 1000, 2000]) {
    const events = Array.from({ length: size }, (_, i) => ({
      kind: 'tool-use',
      sessionId: 's',
      timestamp: i,
      toolUseId: `t${i}`,
      toolName: 'Edit',
      input: { file_path: `/w/file${i % 50}.ts` }
    }))
    const ROUNDS = 20
    const started = Date.now()
    for (let i = 0; i < ROUNDS; i++) {
      build(events)
    }
    console.log(`| ${size} | ${((Date.now() - started) / ROUNDS).toFixed(2)} |`)
  }
}

/** 子プロセス */
async function runWorker(role, options) {
  const { target, index, lines } = options
  if (role === 'audit-rewrite') {
    for (let i = 0; i < lines; i++) {
      const line = `${JSON.stringify({ writer: index, i })}\n`
      let current = Buffer.alloc(0)
      try {
        current = await readFile(target)
      } catch {
        // 初回は空から
      }
      await writeFile(target, Buffer.concat([current, Buffer.from(line)]))
    }
    return
  }
  if (role === 'audit-append') {
    for (let i = 0; i < lines; i++) {
      await appendFile(target, `${JSON.stringify({ writer: index, i })}\n`)
    }
    return
  }
  if (role === 'registry-single') {
    const file = join(target, 'sessions.json')
    for (let i = 0; i < lines; i++) {
      let all = {}
      try {
        all = JSON.parse(await readFile(file, 'utf8'))
      } catch {
        // 初回・壊れていたら作り直す（旧方式の実装がそうしていた）
      }
      all[`s${index}`] = { writes: i + 1 }
      await writeFile(file, JSON.stringify(all))
    }
    return
  }
  if (role === 'registry-store') {
    const { SessionStore } = await import(pathToFileURL(join(OUT, 'sessionStore.js')).href)
    const store = new SessionStore(target, { windowId: `win-${index}`, heartbeatMs: 60 * 60 * 1000 })
    for (let i = 0; i < lines; i++) {
      // totalCostUsd を「何回書いたか」の入れ物として使う（数えるため）
      store.upsert(`s${index}`, { cwd: '/w/app', status: 'running', totalCostUsd: i + 1 })
      await store.flush()
    }
    store.dispose()
    return
  }
  throw new Error(`unknown role: ${role}`)
}
