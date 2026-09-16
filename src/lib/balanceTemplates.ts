import type { CustomProviderBalanceMapping } from '../types'
import { buildSignedQuery, isSigningAvailable } from './volcengineSign'
import { buildApiUrl, isApiProxyAvailable, readClientDevProxyConfig } from './devProxy'
import { DEFAULT_BALANCE_TIMEOUT_SECONDS, normalizeBoundedNumber, MAX_BALANCE_TIMEOUT_SECONDS } from './balanceSettings'

/** 模板声明的凭证输入项 */
export interface BalanceField {
  key: string
  label: string
  placeholder?: string
  /** 输入时遮蔽 */
  secret?: boolean
  /** 未填写时不允许发起查询 */
  required?: boolean
}

export interface BalanceRow {
  label: string
  value: string
  /** 主要数值，界面会放大显示 */
  primary?: boolean
}

export interface BalanceQueryResult {
  rows: BalanceRow[]
}

export interface BalanceTemplateHelp {
  /** 说明段落 */
  lines: string[]
  link?: { label: string; url: string }
}

export interface BalanceQueryOptions {
  /** 服务商 Manifest 里的 balance 声明 */
  mapping: CustomProviderBalanceMapping
  /** 用户填写的凭证值，键对应 fields[].key */
  values: Record<string, string>
  timeoutSeconds: number
}

export interface BalanceTemplate {
  id: string
  name: string
  description: string
  fields: BalanceField[]
  help?: BalanceTemplateHelp
  query: (options: BalanceQueryOptions) => Promise<BalanceQueryResult>
}

const CORS_BLOCKED_MESSAGE = '请求被浏览器拦截：该接口的响应未返回跨域头（预检正常但真实响应不带 Access-Control-Allow-Origin），浏览器无法读取结果。若需使用此功能，需要经由反向代理转发。'
const PROXY_FAILED_MESSAGE = '反向代理转发失败：直连被跨域拦截，改走代理后仍未成功。请确认代理已启动并指向该接口。'

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  USD: '$',
}

function formatAmount(value: unknown, currency: string) {
  const text = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
  if (!text) return '-'
  const amount = Number(text)
  if (!Number.isFinite(amount)) return text
  const symbol = CURRENCY_SYMBOLS[currency] ?? ''
  return `${symbol}${amount.toFixed(2)}${symbol ? '' : ` ${currency}`}`
}

function readField(values: Record<string, string>, key: string) {
  return values[key]?.trim() ?? ''
}

interface VolcengineBillingPayload {
  ResponseMetadata?: { Error?: { Code?: string; Message?: string } }
  Result?: Record<string, unknown>
}

/** 发起一次请求；网络层失败（含跨域被拦）原样抛出 TypeError 供调用方决定是否退回代理 */
async function postSignedQuery(url: string, timeout: number): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeout * 1000)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: '{}',
      cache: 'no-store',
      signal: controller.signal,
    })

    const payload = await response.json().catch(() => null) as VolcengineBillingPayload | null
    const error = payload?.ResponseMetadata?.Error
    if (error) throw new Error(`[${error.Code ?? 'Error'}] ${error.Message ?? '请求失败'}`)
    if (!response.ok || !payload?.Result) throw new Error(`查询失败：HTTP ${response.status}`)
    return payload.Result
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw new Error(`查询超时（${timeout} 秒）`)
    throw err
  } finally {
    window.clearTimeout(timer)
  }
}

/** 火山引擎账单接口：query 参数签名 + POST，响应为 ResponseMetadata/Result 结构 */
const VOLCENGINE_BILLING_TEMPLATE: BalanceTemplate = {
  id: 'volcengine-billing',
  name: '火山引擎账单',
  description: '通过火山引擎账单接口查询账户余额，使用账号级 Access Key 签名（与推理 API Key 不同）。',
  fields: [
    { key: 'accessKeyId', label: 'Access Key ID', placeholder: 'AK...', required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', placeholder: '填写后仅保存在本浏览器', secret: true, required: true },
    { key: 'sessionToken', label: '临时凭证 Token（可选）', placeholder: '仅使用 STS 临时凭证时填写', secret: true },
  ],
  help: {
    lines: [
      '火山用量查询需账号级 AccessKey ID / Secret（与推理 API Key 不同）。请在火山引擎控制台右上角账号菜单 →「API访问密钥」中创建。',
      '若报 AccessDenied（User is not authorized to perform: billing:QueryBalanceAcct）：为这个 Key 所属的账号添加权限——控制台 → 访问控制 IAM → 用户 → 添加权限 → 系统策略「BillingCenterReadOnlyAccess」（费用中心只读）；也可以用自定义策略只放 billing:QueryBalanceAcct 这一个动作。',
      '注意：「BillingCenterBillReadOnlyAccess」只覆盖账单，而余额属于资金账户，只挂它通常仍会报 AccessDenied。',
    ],
    link: { label: '密钥创建地址', url: 'https://console.volcengine.com/iam/keymanage' },
  },
  query: async ({ mapping, values, timeoutSeconds }) => {
    const accessKeyId = readField(values, 'accessKeyId')
    const secretAccessKey = readField(values, 'secretAccessKey')
    if (!accessKeyId || !secretAccessKey) throw new Error('请先填写 Access Key ID 与 Secret Access Key')
    if (!isSigningAvailable()) throw new Error('当前环境不支持 Web Crypto，无法完成签名（需通过 https 或 localhost 访问）')

    const service = mapping.params?.service?.trim() || 'billing'
    const region = mapping.params?.region?.trim() || 'cn-shanghai'
    const action = mapping.params?.action?.trim() || 'QueryBalanceAcct'
    const version = mapping.params?.version?.trim() || '2022-01-01'
    const endpoint = mapping.params?.endpoint?.trim() || 'https://open.volcengineapi.com/'
    const timeout = normalizeBoundedNumber(timeoutSeconds, DEFAULT_BALANCE_TIMEOUT_SECONDS, 1, MAX_BALANCE_TIMEOUT_SECONDS)

    const sessionToken = readField(values, 'sessionToken')
    const query = await buildSignedQuery({
      method: 'POST',
      pathname: '/',
      service,
      region,
      params: { Action: action, Version: version },
    }, { accessKeyId, secretAccessKey, sessionToken: sessionToken || undefined })

    const proxyConfig = readClientDevProxyConfig()

    let result: Record<string, unknown>
    try {
      result = await postSignedQuery(`${endpoint}?${query}`, timeout)
    } catch (err) {
      // 该接口响应不带跨域头，直连必然被拦；此时退回应用代理（开发用 dev-proxy，部署用 VITE_API_PROXY_AVAILABLE）。
      if (!(err instanceof TypeError)) throw err
      if (!isApiProxyAvailable(proxyConfig)) throw new Error(CORS_BLOCKED_MESSAGE)
      try {
        result = await postSignedQuery(`${buildApiUrl(endpoint, '', proxyConfig, true)}?${query}`, timeout)
      } catch (proxyErr) {
        if (proxyErr instanceof TypeError) throw new Error(PROXY_FAILED_MESSAGE)
        throw proxyErr
      }
    }

    const currency = typeof result.Currency === 'string' ? result.Currency : ''
    return {
      rows: [
        { label: '可用余额', value: formatAmount(result.AvailableBalance, currency), primary: true },
        { label: '现金余额', value: formatAmount(result.CashBalance, currency) },
        { label: '欠费金额', value: formatAmount(result.ArrearsBalance, currency) },
        { label: '冻结金额', value: formatAmount(result.FreezeAmount, currency) },
        { label: '信控额度', value: formatAmount(result.CreditLimit, currency) },
        { label: '账号 ID', value: result.AccountID === undefined || result.AccountID === null ? '-' : String(result.AccountID) },
      ],
    }
  },
}

const BALANCE_TEMPLATES: BalanceTemplate[] = [VOLCENGINE_BILLING_TEMPLATE]

export function listBalanceTemplates() {
  return BALANCE_TEMPLATES
}

export function getBalanceTemplate(id: string | undefined): BalanceTemplate | null {
  if (!id) return null
  return BALANCE_TEMPLATES.find((template) => template.id === id) ?? null
}

/** 模板声明的必填凭证是否都已填写 */
export function hasRequiredBalanceFields(template: BalanceTemplate, values: Record<string, string>) {
  return template.fields
    .filter((field) => field.required)
    .every((field) => (values[field.key] ?? '').trim())
}
