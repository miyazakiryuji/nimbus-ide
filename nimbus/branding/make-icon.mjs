/**
 * Nimbus のアプリアイコンを SVG 原本から生成し、本体へ反映する（T-331）。
 *
 * 意匠の正本は `nimbus/branding/icon-concepts/<日付>/nimbus-app.svg`（下の SRC）。
 * 以前はここに手続き描画を書いていたが、原本を 1 つにするため
 * Playwright 経由で手元の Chrome を起動し、SVG をそのまま描く（要 npm install と Chrome）。
 * VS Code / Electron のロゴは商標のため一切使わない。
 *
 *   node nimbus/branding/make-icon.mjs
 *   → nimbus/branding/out/nimbus-<size>.png / nimbus.iconset / nimbus.icns
 *   → resources/darwin/code.icns へ反映（darwin ビルドが Nimbus.app に埋める）
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'icon-concepts', '2026-08-26', 'nimbus-app.svg')
const OUT = join(HERE, 'out')
const INSTALL = join(HERE, '..', '..', 'resources', 'darwin', 'code.icns')

// macOS の iconset が要求する取り合わせ（名前 → ピクセル数）
const ICONSET = {
  'icon_16x16.png': 16,
  'icon_16x16@2x.png': 32,
  'icon_32x32.png': 32,
  'icon_32x32@2x.png': 64,
  'icon_128x128.png': 128,
  'icon_128x128@2x.png': 256,
  'icon_256x256.png': 256,
  'icon_256x256@2x.png': 512,
  'icon_512x512.png': 512,
  'icon_512x512@2x.png': 1024
}

const svg = readFileSync(SRC, 'utf8')
const page = `<!doctype html><style>html,body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' }) // 追加ダウンロード無しで、入っている Chrome を使う
const rendered = new Map()
for (const size of [1024, 512, 256, 128, 64, 32, 16]) {
  const tab = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await tab.setContent(page)
  const png = await tab.screenshot({ omitBackground: true })
  await tab.close()
  rendered.set(size, png)
  writeFileSync(join(OUT, `nimbus-${size}.png`), png)
  console.log(`nimbus-${size}.png`)
}
await browser.close()

const iconset = join(OUT, 'nimbus.iconset')
rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset)
for (const [name, size] of Object.entries(ICONSET)) {
  writeFileSync(join(iconset, name), rendered.get(size))
}
execFileSync('iconutil', ['-c', 'icns', '-o', join(OUT, 'nimbus.icns'), iconset])
copyFileSync(join(OUT, 'nimbus.icns'), INSTALL)
console.log('nimbus.icns → resources/darwin/code.icns 反映')
