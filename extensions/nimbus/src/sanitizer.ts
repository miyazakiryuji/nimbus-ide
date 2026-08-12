/**
 * §6-2/6-3: ログ・DB・エラーレポートへ書き出す前に必ず通すサニタイザ。
 * 「利用者が issue にログを貼って資格情報を流出させる事故」を防ぐための必須要件。
 * 保存経路（Store）はこのモジュールを経由しない書き込みを行ってはならない。
 *
 * 同じ検出規則を、**送信前の検査**にも使う（tasks.md T-075）。書き出す前に隠すのと、
 * 送る前に止めるのは向きが逆なだけで、探しているものは同じ。
 */

interface SecretPattern {
  label: string
  re: RegExp
}

// 既知の資格情報フォーマット（誤検知よりも取り漏らしを避ける方向に倒す）
const SECRET_PATTERNS: SecretPattern[] = [
  { label: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{8,}/g },
  { label: 'secret-key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { label: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { label: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { label: 'google-api-key', re: /\bAIza[A-Za-z0-9_-]{35}\b/g },
  { label: 'stripe-key', re: /\b[rs]k_(live|test)_[A-Za-z0-9]{16,}\b/g },
  { label: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g },
  { label: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g },
  { label: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g }
]

/** 送信前検査の結果 1 件。値そのものは持たない（見つけたことだけを伝える） */
export interface SecretHit {
  /** 何として検出したか（`anthropic-key` など） */
  label: string
  /** 利用者が「どれのことか」を特定できる最小限の断片。値は伏せる */
  preview: string
}

/** 先頭だけ残して伏せる。全部隠すと利用者がどれを消せばいいか分からない */
function previewOf(match: string): string {
  const head = match.slice(0, 6)
  return `${head}…（${match.length} 文字）`
}

// 値そのものを環境変数からマスクする対象（名前が機密らしいもの）
const SENSITIVE_ENV_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i
// 短すぎる値は誤マスクの温床になるため対象外（例: "1", "true"）
const MIN_ENV_VALUE_LENGTH = 8

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface Sanitizer {
  /** ログ・DB 向け。資格情報に加えてホームパス（＝OS ユーザー名）も伏せる */
  sanitizeString: (input: string) => string
  /**
   * 資格情報だけを伏せる（ホームパスは残す）。送信するプロンプト向け。
   * パスまで `~` に置き換えるとエージェントに渡す情報が変わってしまうため、
   * ログ向けの `sanitizeString` とは分けてある。
   */
  maskSecrets: (input: string) => string
  /** JSON 直列化可能な値を丸ごとサニタイズする（文字列化→マスク→復元） */
  sanitizeValue: <T>(value: T) => T
  /**
   * 送信前検査（T-075）。マスクはせず「何が含まれていたか」だけを返す。
   * 止めるか送るかを決めるのは利用者なので、ここでは判断材料を作るところまで。
   */
  detect: (input: string) => SecretHit[]
}

export function createSanitizer(
  env: Record<string, string | undefined> = process.env,
  /** ホームディレクトリ（診断ログに OS ユーザー名が漏れるのを防ぐため ~ へ置換） */
  homeDir?: string
): Sanitizer {
  // 機密らしい環境変数の値を長い順に literal マスク（部分一致の食い合いを防ぐ）
  const envSecrets = Object.entries(env)
    .filter(
      ([name, value]) =>
        SENSITIVE_ENV_NAME.test(name) &&
        typeof value === 'string' &&
        value.length >= MIN_ENV_VALUE_LENGTH
    )
    .sort((a, b) => (b[1] as string).length - (a[1] as string).length)
    .map(([name, value]) => ({
      name,
      re: new RegExp(escapeRegExp(value as string), 'g')
    }))

  const home = homeDir ?? env['HOME'] ?? env['USERPROFILE']
  const homeRe = home ? new RegExp(escapeRegExp(home), 'g') : undefined

  const maskSecrets = (input: string): string => {
    let out = input
    for (const { name, re } of envSecrets) {
      out = out.replace(re, `[REDACTED:env:${name}]`)
    }
    for (const { label, re } of SECRET_PATTERNS) {
      out = out.replace(re, `[REDACTED:${label}]`)
    }
    return out
  }

  const sanitizeString = (input: string): string =>
    // ホームパスは ~ に置換（パス中の OS ユーザー名の露出を防ぐ）
    maskSecrets(homeRe ? input.replace(homeRe, '~') : input)

  const sanitizeValue = <T>(value: T): T => {
    if (value === undefined || value === null) return value
    return JSON.parse(sanitizeString(JSON.stringify(value))) as T
  }

  const detect = (input: string): SecretHit[] => {
    const hits: SecretHit[] = []
    // 環境変数由来のほうが具体的なので先に見る（同じ文字列が両方に当たったとき名前で言える）
    for (const { name, re } of envSecrets) {
      for (const match of input.matchAll(re)) {
        hits.push({ label: `env:${name}`, preview: previewOf(match[0]) })
      }
    }
    for (const { label, re } of SECRET_PATTERNS) {
      for (const match of input.matchAll(re)) {
        hits.push({ label, preview: previewOf(match[0]) })
      }
    }
    // 同じものを二重に数えない（`sk-ant-…` は anthropic-key と secret-key の両方に当たる）
    const seen = new Set<string>()
    return hits.filter((hit) => {
      if (seen.has(hit.preview)) return false
      seen.add(hit.preview)
      return true
    })
  }

  return { sanitizeString, maskSecrets, sanitizeValue, detect }
}
