/**
 * Nimbus のアプリアイコンを生成する（外部依存なし）。
 *
 * 意匠: 雨雲（生成り）＋ その背後にひろがる光背（Claude のテラコッタ）。
 * VS Code / Electron のロゴは商標のため一切使わない。
 *
 *   node nimbus/branding/make-icon.mjs
 *   → nimbus/branding/out/nimbus-1024.png ほか
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out')
const SS = 3 // スーパーサンプリング倍率（アンチエイリアス用）

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

/** 角丸矩形の符号付き距離（正 = 外側）。座標は 0..1 正規化 */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r
}

const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r

/** 雲は円の和集合＋底面の角丸矩形 */
function sdCloud(px, py) {
  return Math.min(
    sdCircle(px, py, 0.42, 0.455, 0.155),
    sdCircle(px, py, 0.605, 0.5, 0.12),
    sdCircle(px, py, 0.3, 0.53, 0.105),
    sdRoundRect(px, py, 0.45, 0.575, 0.19, 0.055, 0.05)
  )
}

/** 1 サブピクセルの色を返す（アルファ合成前提の直線色） */
function shade(px, py) {
  // 背景: 深い藍のスクワークル
  const bg = sdRoundRect(px, py, 0.5, 0.5, 0.5, 0.5, 0.225)
  if (bg > 0) return null

  const vertical = clamp01(py)
  let color = mix([0.122, 0.118, 0.114], [0.2, 0.188, 0.173], vertical) // #1f1e1d → #33302c

  // 光背: 雲の少し上を中心にした淡い金の放射
  const halo = Math.hypot(px - 0.47, py - 0.42)
  const haloStrength = Math.pow(1 - smoothstep(0.05, 0.44, halo), 1.35) * 0.82
  color = mix(color, [0.851, 0.467, 0.341], haloStrength) // #d97757

  // 光背の輪郭を一段はっきりさせる細いリング
  const ring = Math.abs(halo - 0.3)
  color = mix(color, [0.902, 0.596, 0.478], (1 - smoothstep(0, 0.022, ring)) * 0.6)

  // 雨雲本体
  const cloud = sdCloud(px, py)
  if (cloud <= 0) {
    const top = clamp01((py - 0.33) / 0.28)
    let body = mix([0.973, 0.965, 0.937], [0.804, 0.573, 0.427], top) // #f8f6ef → #cd926d
    // 底面の内側に落ちる影で厚みを出す
    body = mix(body, [0.71, 0.475, 0.31], smoothstep(-0.05, 0, cloud) * 0.45)
    return body
  }

  // 雲のふちの淡い発光
  color = mix(color, [0.851, 0.467, 0.341], (1 - smoothstep(0, 0.018, cloud)) * 0.5)

  // 雨: 雲の下に落ちる 3 本の線
  for (const [rx, ry, len] of [
    [0.355, 0.7, 0.075],
    [0.47, 0.735, 0.095],
    [0.585, 0.7, 0.075]
  ]) {
    const t = clamp01((py - ry) / len)
    const drop = Math.abs(px - (rx + t * 0.022)) - 0.0075 * (1 - t * 0.6)
    if (py >= ry && py <= ry + len) {
      color = mix(color, [0.922, 0.859, 0.737], (1 - smoothstep(0, 0.004, drop)) * (1 - t * 0.75))
    }
  }
  return color
}

function renderPng(size) {
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) / size
          const py = (y + (sy + 0.5) / SS) / size
          const c = shade(px, py)
          if (c) {
            r += c[0]
            g += c[1]
            b += c[2]
            a += 1
          }
        }
      }
      const n = SS * SS
      const i = (y * size + x) * 4
      if (a > 0) {
        // 未被覆のサブピクセルに色が引きずられないよう、被覆分で正規化する
        buf[i] = Math.round((r / a) * 255)
        buf[i + 1] = Math.round((g / a) * 255)
        buf[i + 2] = Math.round((b / a) * 255)
      }
      buf[i + 3] = Math.round((a / n) * 255)
    }
  }
  return encodePng(buf, size, size)
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(bytes) {
  let c = -1
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

mkdirSync(OUT, { recursive: true })
for (const size of [1024, 512, 256, 128, 64, 32, 16]) {
  writeFileSync(join(OUT, `nimbus-${size}.png`), renderPng(size))
  console.log(`nimbus-${size}.png`)
}
