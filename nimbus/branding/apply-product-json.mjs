/**
 * product.json を Nimbus の身元に差し替える。
 *
 * upstream 追従のたびに再適用できるよう、手編集ではなくスクリプトで当てる。
 * 商標に触れる値（Visual Studio Code / VS Code の名称・アイコン）は使わない。
 *
 *   node nimbus/branding/apply-product-json.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const REPO = 'https://github.com/miyazakiryuji/nimbus-ide'
const file = join(ROOT, 'product.json')
const product = JSON.parse(readFileSync(file, 'utf8'))

// Windows のインストーラ ID と macOS の構成プロファイル UUID は、
// VS Code と衝突しないよう Nimbus 固有の値を固定で持つ。
const identity = {
  nameShort: 'Nimbus',
  nameLong: 'Nimbus',
  applicationName: 'nimbus',
  dataFolderName: '.nimbus',
  sharedDataFolderName: '.nimbus-shared',
  win32MutexName: 'nimbus',
  licenseName: 'MIT',
  licenseUrl: `${REPO}/blob/nimbus/LICENSE.txt`,
  serverLicenseUrl: `${REPO}/blob/nimbus/LICENSE.txt`,
  serverApplicationName: 'nimbus-server',
  serverDataFolderName: '.nimbus-server',
  tunnelApplicationName: 'nimbus-tunnel',
  win32DirName: 'Nimbus',
  win32NameVersion: 'Nimbus',
  win32RegValueName: 'Nimbus',
  win32x64AppId: '{{6E3F5A21-9C4B-4E7A-8D2F-1B0C7A9E4D33}',
  win32arm64AppId: '{{2A8D4C17-5F63-4B92-A1E8-7C4D0B6F2E55}',
  win32x64UserAppId: '{{9B1E7D40-3A25-4C68-B7F1-5E82D3A0C6B7}',
  win32arm64UserAppId: '{{4D6C2B93-8E17-45FA-9C30-A2B5E71D8F09}',
  win32AppUserModelId: 'Idris.Nimbus',
  win32ShellNameShort: 'N&imbus',
  win32TunnelServiceMutex: 'nimbus-tunnelservice',
  win32TunnelMutex: 'nimbus-tunnel',
  darwinBundleIdentifier: 'dev.idris.nimbus',
  darwinProfileUUID: 'B7E4C1A6-2D53-4F80-9A1C-63E85D0B7F42',
  darwinProfilePayloadUUID: 'F0A93B25-6C18-4E7D-B534-8D1907C2A6E1',
  linuxIconName: 'nimbus',
  licenseFileName: 'LICENSE.txt',
  reportIssueUrl: `${REPO}/issues/new`,
  urlProtocol: 'nimbus'
}

for (const [key, value] of Object.entries(identity)) {
  if (!(key in product)) throw new Error(`product.json に ${key} が無い（upstream の構造が変わった可能性）`)
  product[key] = value
}

// Nimbus は Claude の操縦席であり、Copilot は同梱しない。
// また Microsoft のサービスに向いた既定値（音声・Webview CDN）は、フォークが勝手に叩くべきではないので外す。
//
// 注意: `defaultChatAgent` は消してはいけない。実測で、削除するとワークベンチが
// 「Onboarding requires a default chat agent product configuration.」で例外になり、
// 画面が真っ白のまま起動しない。Copilot の導線を外すのは、Nimbus 自身のチャット
// エージェント（F2 で作る組み込み拡張）を既定として差す形で行う。
// キーごと消してよいものと、「空にする」べきものがある。
// 実測: `builtInExtensionsEnabledWithAutoUpdates` を削除すると拡張の管理が
// `productService.builtInExtensionsEnabledWithAutoUpdates is not iterable` で落ちる（CLI の --install-extension が失敗）。
// 中身だけ空にすれば同じ効果で壊れない。
const emptyValues = {
  trustedExtensionAuthAccess: {}, // GitHub.copilot-chat への無確認の認証アクセス許可を外す
  builtInExtensionsEnabledWithAutoUpdates: [] // copilot-chat の自動更新枠を外す（配列であること自体は必要）
}
const removeKeys = [
  'voiceWsUrl', // Microsoft の音声サービス
  'webviewContentExternalBaseUrlTemplate' // upstream のコミットハッシュを含む MS CDN。自前ビルドでは無効
]
const removed = []
for (const [key, value] of Object.entries(emptyValues)) {
  // upstream に無くても必ず置く。キーが存在しないと参照側が落ちるため（下のコメント参照）
  product[key] = value
  removed.push(`${key}（空に）`)
}
for (const key of removeKeys) {
  if (key in product) {
    delete product[key]
    removed.push(key)
  }
}

// 初回のテーマ選択に Nimbus のテーマを最初に出す（既定と一致させる）
product.onboardingThemes = [
  { id: 'nimbus-dark', label: 'Nimbus Dark', themeId: 'Nimbus Dark', type: 'dark' },
  { id: 'nimbus-light', label: 'Nimbus Light', themeId: 'Nimbus Light', type: 'light' },
  { id: 'hc-dark', label: 'Dark High Contrast', themeId: 'Default High Contrast', type: 'hcDark' },
  { id: 'hc-light', label: 'Light High Contrast', themeId: 'Default High Contrast Light', type: 'hcLight' }
]

// 拡張機能ギャラリー: Microsoft Marketplace は利用規約でフォークに開放されていないため Open VSX を使う。
// controlUrl は Eclipse が管理する「無効化すべき拡張」のリスト。
product.extensionsGallery = {
  serviceUrl: 'https://open-vsx.org/vscode/gallery',
  itemUrl: 'https://open-vsx.org/vscode/item',
  resourceUrlTemplate: 'https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}',
  latestUrlTemplate: 'https://open-vsx.org/vscode/gallery/{publisher}/{name}/latest',
  controlUrl:
    'https://raw.githubusercontent.com/EclipseFdn/publish-extensions/refs/heads/master/extension-control/extensions.json'
}
product.linkProtectionTrustedDomains = [
  ...new Set([...(product.linkProtectionTrustedDomains ?? []), 'https://open-vsx.org'])
]

writeFileSync(file, JSON.stringify(product, null, '\t') + '\n')
console.log('product.json を Nimbus 用に更新しました')
if (removed.length > 0) console.log(`削除したキー: ${removed.join(', ')}`)
