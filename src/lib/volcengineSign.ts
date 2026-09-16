/**
 * 火山引擎 OpenAPI 的 query 签名（X-Credential / X-Signature 系列参数）。
 * 算法对齐官方 SDK @volcengine/openapi 的 Signer.getSignUrl，用 Web Crypto 实现，
 * 因为官方 SDK 依赖 Node 的 crypto，无法在浏览器里运行。
 *
 * 浏览器要求安全上下文（https 或 localhost）才提供 crypto.subtle。
 */

const ALGORITHM = 'HMAC-SHA256'
const V4_IDENTIFIER = 'request'

export interface VolcengineCredentials {
  accessKeyId: string
  secretAccessKey: string
  /** 临时凭证（STS）才需要 */
  sessionToken?: string
}

export interface SignQueryOptions {
  method: string
  pathname: string
  service: string
  region: string
  params: Record<string, string | undefined>
  date?: Date
  /**
   * X-NotSignBody 的值。默认 '1'（真值）：服务端据此跳过请求体签名，
   * 使 canonical 中的 body 哈希恒为 sha256("")。官方 SDK 发空串，两者语义不同时以真值更安全。
   */
  notSignBody?: string
}

export function isSigningAvailable() {
  return typeof crypto !== 'undefined' && Boolean(crypto.subtle)
}

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function hmacSha256(key: Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message))
}

async function sha256Hex(value: string) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

/** 与官方 SDK 的 uriEscape 等价（涉及字符均为 ASCII） */
function uriEscape(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
}

function queryParamsToString(params: Record<string, string>) {
  return Object.keys(params)
    .map((key) => `${uriEscape(key)}=${uriEscape(params[key])}`)
    .join('&')
}

export function formatDateTime(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:\-]/g, '')
}

export function formatCredentialScope(date: Date, region: string, service: string) {
  return [formatDateTime(date).slice(0, 8), region, service, V4_IDENTIFIER].join('/')
}

async function getSigningKey(secretAccessKey: string, date: Date, region: string, service: string) {
  const encoder = new TextEncoder()
  const kDate = await hmacSha256(encoder.encode(secretAccessKey), formatDateTime(date).slice(0, 8))
  const kRegion = await hmacSha256(new Uint8Array(kDate), region)
  const kService = await hmacSha256(new Uint8Array(kRegion), service)
  return hmacSha256(new Uint8Array(kService), V4_IDENTIFIER)
}

/** 返回可直接拼到 URL 上的签名后 query 串 */
export async function buildSignedQuery(options: SignQueryOptions, credentials: VolcengineCredentials): Promise<string> {
  const date = options.date ?? new Date()
  const datetime = formatDateTime(date)
  const scope = formatCredentialScope(date, options.region, options.service)

  const signed: Record<string, string> = {}
  for (const key of Object.keys(options.params)) {
    const value = options.params[key]
    if (value === undefined || value === null) continue
    signed[key] = value
  }
  signed['X-Date'] = datetime
  signed['X-NotSignBody'] = options.notSignBody ?? '1'
  signed['X-Credential'] = `${credentials.accessKeyId}/${scope}`
  signed['X-Algorithm'] = ALGORITHM
  signed['X-SignedHeaders'] = ''
  if (credentials.sessionToken) signed['X-Security-Token'] = credentials.sessionToken

  const sortedKeys = Object.keys(signed).sort()
  const sortedParams: Record<string, string> = {}
  for (const key of sortedKeys) sortedParams[key] = signed[key]

  // 官方 SDK 在 query 签名时不带任何 header，且 body 视为空串参与哈希。
  const canonicalRequest = [
    options.method.toUpperCase(),
    options.pathname || '/',
    queryParamsToString(sortedParams),
    '\n',
    '',
    await sha256Hex(''),
  ].join('\n')

  const stringToSign = [ALGORITHM, datetime, scope, await sha256Hex(canonicalRequest)].join('\n')
  const signingKey = await getSigningKey(credentials.secretAccessKey, date, options.region, options.service)
  sortedParams['X-SignedQueries'] = sortedKeys.join(';')
  sortedParams['X-Signature'] = toHex(await hmacSha256(new Uint8Array(signingKey), stringToSign))

  return queryParamsToString(sortedParams)
}
