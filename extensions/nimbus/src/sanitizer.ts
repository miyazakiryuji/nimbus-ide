/**
 * §6-2/6-3: ログ・DB・エラーレポートへ書き出す前に必ず通すサニタイザ。
 * 「利用者が issue にログを貼って資格情報を流出させる事故」を防ぐための必須要件。
 * 保存経路（Store）はこのモジュールを経由しない書き込みを行ってはならない。
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
  { label: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g },
  { label: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g }
]

// 値そのものを環境変数からマスクする対象（名前が機密らしいもの）
const SENSITIVE_ENV_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i
// 短すぎる値は誤マスクの温床になるため対象外（例: "1", "true"）
const MIN_ENV_VALUE_LENGTH = 8

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface Sanitizer {
  sanitizeString: (input: string) => string
  /** JSON 直列化可能な値を丸ごとサニタイズする（文字列化→マスク→復元） */
  sanitizeValue: <T>(value: T) => T
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

  const sanitizeString = (input: string): string => {
    let out = input
    if (homeRe) {
      // ホームパスは ~ に置換（パス中の OS ユーザー名の露出を防ぐ）
      out = out.replace(homeRe, '~')
    }
    for (const { name, re } of envSecrets) {
      out = out.replace(re, `[REDACTED:env:${name}]`)
    }
    for (const { label, re } of SECRET_PATTERNS) {
      out = out.replace(re, `[REDACTED:${label}]`)
    }
    return out
  }

  const sanitizeValue = <T>(value: T): T => {
    if (value === undefined || value === null) return value
    return JSON.parse(sanitizeString(JSON.stringify(value))) as T
  }

  return { sanitizeString, sanitizeValue }
}
