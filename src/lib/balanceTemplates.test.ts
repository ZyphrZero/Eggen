// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getBalanceTemplate } from './balanceTemplates'

const template = getBalanceTemplate('volcengine-billing')!
const MAPPING = {
  template: 'volcengine-billing',
  params: { region: 'cn-shanghai', service: 'billing', action: 'QueryBalanceAcct', version: '2022-01-01' },
}
const VALUES = { accessKeyId: 'AKTEST', secretAccessKey: 'sk-test' }

function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(handler))
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('balance template registry', () => {
  it('exposes the volcengine billing template as one of the templates', () => {
    expect(template.id).toBe('volcengine-billing')
    expect(template.name).toBe('火山引擎账单')
    expect(template.fields.filter((field) => field.required).map((field) => field.key)).toEqual(['accessKeyId', 'secretAccessKey'])
    expect(template.help?.link?.url).toBe('https://console.volcengine.com/iam/keymanage')
  })

  it('returns null for unknown or missing template ids', () => {
    expect(getBalanceTemplate('nope')).toBeNull()
    expect(getBalanceTemplate(undefined)).toBeNull()
  })
})

describe('volcengine billing query', () => {
  it('requires the access key pair', async () => {
    await expect(template.query({
      mapping: MAPPING,
      values: { accessKeyId: '', secretAccessKey: '' },
      timeoutSeconds: 5,
    })).rejects.toThrow('请先填写 Access Key ID')
  })

  it('signs with the parameters declared by the provider mapping', async () => {
    let seenUrl = ''
    stubFetch((url) => {
      seenUrl = url
      return Promise.resolve(jsonResponse({ Result: { AvailableBalance: '1', Currency: 'CNY' } }))
    })

    await template.query({
      mapping: { template: 'volcengine-billing', params: { region: 'cn-beijing', service: 'custom-svc', action: 'MyAction', version: '9-9-9' } },
      values: VALUES,
      timeoutSeconds: 5,
    })

    const params = new URL(seenUrl).searchParams
    expect(params.get('Action')).toBe('MyAction')
    expect(params.get('Version')).toBe('9-9-9')
    expect(params.get('X-Credential')).toContain('/cn-beijing/custom-svc/request')
  })

  it('maps the response into display rows', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({
      ResponseMetadata: { RequestId: 'x' },
      Result: { AccountID: 2131976370, AvailableBalance: '19.4', CashBalance: '19.4', Currency: 'CNY' },
    })))

    const result = await template.query({ mapping: MAPPING, values: VALUES, timeoutSeconds: 5 })
    expect(result.rows[0]).toEqual({ label: '可用余额', value: '¥19.40', primary: true })
    expect(result.rows.find((row) => row.label === '账号 ID')?.value).toBe('2131976370')
    expect(result.rows.filter((row) => row.primary)).toHaveLength(1)
  })

  it('aborts and reports a timeout', async () => {
    stubFetch((_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    await expect(template.query({ mapping: MAPPING, values: VALUES, timeoutSeconds: 1 })).rejects.toThrow('查询超时（1 秒）')
  }, 10000)

  it('explains a blocked cross-origin read when no proxy is available', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    await expect(template.query({ mapping: MAPPING, values: VALUES, timeoutSeconds: 5 })).rejects.toThrow('请求被浏览器拦截')
  })

  it('retries through the api proxy when the direct request is blocked', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    const urls: string[] = []
    stubFetch((url) => {
      urls.push(String(url))
      if (urls.length === 1) return Promise.reject(new TypeError('Failed to fetch'))
      return Promise.resolve(jsonResponse({ Result: { AvailableBalance: '19.4', Currency: 'CNY' } }))
    })

    const result = await template.query({ mapping: MAPPING, values: VALUES, timeoutSeconds: 5 })

    expect(urls).toHaveLength(2)
    expect(urls[0]).toContain('https://open.volcengineapi.com/?')
    expect(urls[1]).toContain('/api-proxy/?')
    expect(urls[1]).toContain('X-Signature=')
    expect(result.rows[0].value).toBe('¥19.40')
  })

  it('reports a failed proxy forwarding distinctly', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    await expect(template.query({ mapping: MAPPING, values: VALUES, timeoutSeconds: 5 })).rejects.toThrow('反向代理转发失败')
  })

  it('keeps service errors readable when they come back through the proxy', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    let calls = 0
    stubFetch(() => {
      calls += 1
      if (calls === 1) return Promise.reject(new TypeError('Failed to fetch'))
      return Promise.resolve(jsonResponse({ ResponseMetadata: { Error: { Code: 'InvalidCredential', Message: 'Invalid credential' } } }, 400))
    })

    await expect(template.query({ mapping: MAPPING, values: VALUES, timeoutSeconds: 5 })).rejects.toThrow('[InvalidCredential] Invalid credential')
  })

  it('surfaces the service error code and message', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({
      ResponseMetadata: { Error: { Code: 'InvalidSecretToken', Message: 'signature not match' } },
    }, 401)))
    await expect(template.query({ mapping: MAPPING, values: VALUES, timeoutSeconds: 5 })).rejects.toThrow('[InvalidSecretToken] signature not match')
  })
})
