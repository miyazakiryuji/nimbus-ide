/**
 * product.json の builtInExtensions に入っている sha256 を Open VSX 版のものに更新する。
 *
 * upstream の値は Microsoft Marketplace が配る VSIX のハッシュ。Nimbus は Open VSX から取得するため、
 * 同じバージョンでもビルド主体が違い、ハッシュが一致せずダウンロードが失敗する。
 *
 * ハッシュを書き換えるのは供給元をすり替える操作でもあるので、**必ず中身の身元を検証してから**固定する:
 *   - VSIX 内の extension/package.json の publisher / name / version が product.json と一致すること
 * 一致しないものは書き換えず、異常として報告する。
 *
 *   node nimbus/branding/sync-builtin-extension-hashes.mjs
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const file = join(process.cwd(), 'product.json')
const product = JSON.parse(readFileSync(file, 'utf8'))
const entries = product.builtInExtensions ?? []
if (entries.length === 0) {
  console.log('builtInExtensions が空のため何もしません')
  process.exit(0)
}

const work = mkdtempSync(join(tmpdir(), 'nimbus-vsix-'))
const problems = []
let changed = 0

for (const entry of entries) {
  const [publisher, ...rest] = entry.name.split('.')
  const extName = rest.join('.')
  const url = `https://open-vsx.org/vscode/gallery/publishers/${publisher}/vsextensions/${extName}/${entry.version}/vspackage`

  const response = await fetch(url)
  if (!response.ok) {
    problems.push(`${entry.name}: 取得失敗 HTTP ${response.status}`)
    continue
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  const vsix = join(work, `${entry.name}-${entry.version}.vsix`)
  writeFileSync(vsix, bytes)

  let manifest
  try {
    manifest = JSON.parse(execFileSync('unzip', ['-p', vsix, 'extension/package.json'], { maxBuffer: 32e6 }).toString())
  } catch {
    problems.push(`${entry.name}: VSIX を展開できず身元を確認できない`)
    continue
  }
  if (manifest.publisher !== publisher || manifest.name !== extName || manifest.version !== entry.version) {
    problems.push(
      `${entry.name}@${entry.version}: 中身が別物（${manifest.publisher}.${manifest.name}@${manifest.version}）— 書き換えない`
    )
    continue
  }

  if (entry.sha256 === sha256) {
    console.log(`= ${entry.name}@${entry.version} 変更なし`)
  } else {
    console.log(`* ${entry.name}@${entry.version} ${entry.sha256.slice(0, 12)}… → ${sha256.slice(0, 12)}…`)
    entry.sha256 = sha256
    changed++
  }
}

if (problems.length > 0) {
  console.error('\n要確認:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exitCode = 1
}
if (changed > 0) {
  writeFileSync(file, JSON.stringify(product, null, '\t') + '\n')
  console.log(`\n${changed} 件のハッシュを Open VSX 版に更新しました`)
}
