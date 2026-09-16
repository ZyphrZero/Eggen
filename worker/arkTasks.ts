import type { DurableObjectNamespace, DurableObjectState, Fetcher, Request as WorkerRequest } from '@cloudflare/workers-types'

interface Env {
  ARK_TASKS: DurableObjectNamespace
  ASSETS: Fetcher
}

interface TaskState {
  status: 'queued' | 'running' | 'done' | 'error'
  expiresAt: number
  requestHash: string
  responseStatus?: number
  responseBody?: string
  error?: string
}

const TASK_PATH = '/api/ark/tasks/'
const UPSTREAM_URL = 'https://ark.cn-beijing.volces.com/api/v3/images/generations'
const RETENTION_MS = 24 * 60 * 60_000
const MAX_REQUEST_BYTES = 32 * 1024 * 1024
const MAX_RESULT_BYTES = 128 * 1024

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function digest(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function proxyVolcengineBalance(request: WorkerRequest) {
  if (request.method !== 'POST') return json({ error: { message: '余额查询仅支持 POST。' } }, 405)
  const origin = request.headers.get('Origin')
  if (origin && origin !== new URL(request.url).origin) return json({ error: { message: '余额查询仅接受本站请求。' } }, 403)
  if (!request.headers.get('Content-Type')?.includes('application/json')) return json({ error: { message: '余额查询需要 JSON 请求。' } }, 415)
  if (Number(request.headers.get('Content-Length')) > 32 * 1024) return json({ error: { message: '余额查询请求过大。' } }, 413)
  const reader = request.body?.getReader()
  if (!reader) return json({ error: { message: '缺少余额查询签名。' } }, 400)
  const parts: Uint8Array[] = []
  let size = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.byteLength
    if (size > 32 * 1024) {
      await reader.cancel()
      return json({ error: { message: '余额查询请求过大。' } }, 413)
    }
    parts.push(chunk.value)
  }
  let payload: unknown
  try {
    payload = JSON.parse(await new Blob(parts as BlobPart[]).text())
  } catch {
    return json({ error: { message: '余额查询请求不是有效的 JSON。' } }, 400)
  }
  if (!payload || typeof payload !== 'object' || Object.keys(payload).length !== 1 || !('query' in payload) || typeof payload.query !== 'string') {
    return json({ error: { message: '余额查询只接受签名后的 query 参数。' } }, 400)
  }
  const params = new URLSearchParams(payload.query)
  const keys = [...params.keys()]
  const allowedKeys = new Set(['Action', 'Version', 'X-Algorithm', 'X-Credential', 'X-Date', 'X-NotSignBody', 'X-SignedHeaders', 'X-Security-Token', 'X-SignedQueries', 'X-Signature'])
  if (
    keys.length !== new Set(keys).size || keys.some((key) => !allowedKeys.has(key)) ||
    params.get('Action') !== 'QueryBalanceAcct' || params.get('Version') !== '2022-01-01' ||
    params.get('X-Algorithm') !== 'HMAC-SHA256' || params.get('X-NotSignBody') !== '1' ||
    params.get('X-SignedHeaders') !== '' || !/^\d{8}T\d{6}Z$/.test(params.get('X-Date') ?? '') ||
    !/^[^/]+\/\d{8}\/[^/]+\/billing\/request$/.test(params.get('X-Credential') ?? '') ||
    !/^[a-f0-9]{64}$/i.test(params.get('X-Signature') ?? '') ||
    params.get('X-SignedQueries') !== keys.filter((key) => key !== 'X-Signature' && key !== 'X-SignedQueries').sort().join(';')
  ) {
    return json({ error: { message: '余额代理仅支持已签名的 billing:QueryBalanceAcct 请求。' } }, 400)
  }
  const requestedTimeout = Number(request.headers.get('X-Eggen-Timeout'))
  const timeout = Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? Math.min(requestedTimeout, 600) : 30
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout * 1000)
  try {
    // Secret 留在浏览器；固定上游和只读动作，不接收客户端提供的转发地址。
    const response = await fetch(`https://open.volcengineapi.com/?${payload.query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: '{}',
      signal: controller.signal,
      redirect: 'manual',
    })
    if (!response.headers.get('Content-Type')?.includes('application/json') || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel()
      return json({ error: { message: `火山余额接口返回了异常响应（HTTP ${response.status}）。` } }, 502)
    }
    return new Response(response.body, {
      status: response.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  } catch {
    // 网络错误可能包含签名 URL，日志只记录固定说明。
    console.warn('Volcengine balance proxy request failed', { timeout: controller.signal.aborted })
    return json({ error: { message: controller.signal.aborted ? `余额查询超时（${timeout} 秒）。` : '无法连接火山余额接口，请稍后重试。' } }, controller.signal.aborted ? 504 : 502)
  } finally {
    clearTimeout(timer)
  }
}

export default {
  async fetch(request: WorkerRequest, env: Env) {
    const url = new URL(request.url)
    if (url.pathname === '/api/ark/balance') return proxyVolcengineBalance(request)
    if (!url.pathname.startsWith(TASK_PATH)) return env.ASSETS.fetch(request)
    const [id, action, imageIndex, extra] = url.pathname.slice(TASK_PATH.length).split('/')
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) {
      return json({ error: { message: '无效的后台任务 ID。' } }, 400)
    }
    if (!['GET', 'POST'].includes(request.method)) return json({ error: { message: '请求方法不支持。' } }, 405)
    if (action && (action !== 'images' || !/^\d+$/.test(imageIndex ?? '') || extra || request.method !== 'GET')) return json({ error: { message: '无效的图片请求。' } }, 400)
    const origin = request.headers.get('Origin')
    if (origin && origin !== url.origin) return json({ error: { message: '后台任务仅接受本站请求。' } }, 403)
    const key = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1]
    if (!key || key.length > 4096) return json({ error: { message: '请填写豆包 API Key。' } }, 401)
    // 不同 API Key 的任务隔离，凭据不进入 URL、持久化状态或日志。
    const objectId = env.ARK_TASKS.idFromName(`${await digest(key)}:${id}`)
    return env.ARK_TASKS.get(objectId).fetch(request)
  },
}

export class ArkTask {
  private pending?: { key: string; body: string; timeout: number }

  constructor(private ctx: DurableObjectState) {}

  async fetch(request: WorkerRequest) {
    if (request.method === 'GET') {
      const state = await this.ctx.storage.get<TaskState>('state')
      if (!state || state.expiresAt <= Date.now()) {
        return json({ error: { message: '后台任务不存在或已过期；若提交时连接中断，请重新生成。' } }, 404)
      }
      if (state.status === 'error') return json({ error: { message: state.error } }, 409)
      if (state.status !== 'done') return json({ status: state.status }, 202)
      const imageIndex = new URL(request.url).pathname.match(/\/images\/(\d+)$/)?.[1]
      if (imageIndex !== undefined) {
        const payload = JSON.parse(state.responseBody!)
        const imageUrl = payload.data?.[Number(imageIndex)]?.url
        if (typeof imageUrl !== 'string' || !imageUrl.startsWith('https://')) return json({ error: { message: '任务没有这张图片。' } }, 404)
        const response = await fetch(imageUrl, { redirect: 'manual' })
        if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/')) {
          await response.body?.cancel()
          return json({ error: { message: `豆包图片下载失败（HTTP ${response.status}），链接可能已过期。` } }, 502)
        }
        // 原图直接流式转发，不写入 Durable Object，也不在 Worker 中转 Base64。
        return new Response(response.body, { headers: { 'Content-Type': response.headers.get('Content-Type')!, 'Cache-Control': 'no-store' } })
      }
      return new Response(state.responseBody, {
        status: state.responseStatus,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Eggen-Task-Status': 'done' },
      })
    }

    if (!request.headers.get('Content-Type')?.includes('application/json')) return json({ error: { message: '需要 JSON 请求。' } }, 415)
    if (Number(request.headers.get('Content-Length')) > MAX_REQUEST_BYTES) return json({ error: { message: '后台任务请求不能超过 32 MiB。' } }, 413)
    const reader = request.body?.getReader()
    if (!reader) return json({ error: { message: '缺少请求内容。' } }, 400)
    const parts: Uint8Array[] = []
    let size = 0
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel()
        return json({ error: { message: '后台任务请求不能超过 32 MiB。' } }, 413)
      }
      parts.push(chunk.value)
    }
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(await new Blob(parts as BlobPart[]).text())
    } catch {
      return json({ error: { message: '请求不是有效的 JSON。' } }, 400)
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.model !== 'string' || !payload.model.trim() || typeof payload.prompt !== 'string' || !payload.prompt.trim()) {
      return json({ error: { message: '生图请求需要 model 和 prompt。' } }, 400)
    }
    // 只保存短期有效的结果链接，原图在客户端取结果时转发。
    const body = JSON.stringify({ ...payload, stream: false, response_format: 'url' })
    const requestHash = await digest(body)
    const requestedTimeout = Number(request.headers.get('X-Eggen-Timeout'))
    const timeout = Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? Math.min(requestedTimeout, 840) : 840
    return this.ctx.blockConcurrencyWhile(async () => {
      const existing = await this.ctx.storage.get<TaskState>('state')
      if (existing) {
        if (existing.requestHash !== requestHash) return json({ error: { message: '同一任务 ID 不能用于不同的请求。' } }, 409)
        return json({ status: existing.status }, 202)
      }
      this.pending = { key: request.headers.get('Authorization')!.slice(7), body, timeout }
      await this.ctx.storage.put<TaskState>('state', { status: 'queued', expiresAt: Date.now() + RETENTION_MS, requestHash })
      // alarm 有独立执行生命周期，浏览器刷新不会取消上游请求。
      await this.ctx.storage.setAlarm(Date.now())
      return json({ status: 'queued' }, 202)
    })
  }

  async alarm() {
    const state = await this.ctx.storage.get<TaskState>('state')
    if (!state) return
    if (state.expiresAt <= Date.now()) {
      await this.ctx.storage.deleteAll()
      return
    }
    if (state.status === 'done' || state.status === 'error') {
      await this.ctx.storage.setAlarm(state.expiresAt)
      return
    }
    const pending = this.pending
    this.pending = undefined
    // 实例重启时不能确定上游是否已受理，不自动重发付费请求。
    if (state.status === 'running' || !pending) {
      await this.ctx.storage.put('state', { ...state, status: 'error', error: '后台运行实例已重启，无法接续这次豆包请求。请先检查服务商记录，再决定是否重新生成。' })
      await this.ctx.storage.setAlarm(state.expiresAt)
      return
    }
    await this.ctx.storage.put('state', { ...state, status: 'running' })
    await this.ctx.storage.setAlarm(Date.now() + 15 * 60_000)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), pending.timeout * 1000)
    try {
      const response = await fetch(UPSTREAM_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${pending.key}`, 'Content-Type': 'application/json' },
        body: pending.body,
        signal: controller.signal,
        redirect: 'manual',
      })
      if (!response.headers.get('Content-Type')?.includes('application/json') || !response.body) {
        throw new Error(`豆包接口返回了非 JSON 响应（HTTP ${response.status}）。`)
      }
      const reader = response.body.getReader()
      const parts: Uint8Array[] = []
      let bytes = 0
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > MAX_RESULT_BYTES) {
          await reader.cancel()
          throw new Error('豆包任务响应超过 128 KiB；后台仅支持返回图片链接。')
        }
        parts.push(chunk.value)
      }
      const responseBody = await new Blob(parts as BlobPart[]).text()
      JSON.parse(responseBody)
      await this.ctx.storage.put('state', { ...state, status: 'done', responseBody, responseStatus: response.status })
    } catch (err) {
      const error = controller.signal.aborted ? `豆包后台请求超时（${pending.timeout} 秒）。` : err instanceof Error ? err.message : '豆包后台请求失败。'
      await this.ctx.storage.put('state', { ...state, status: 'error', error })
    } finally {
      clearTimeout(timer)
      await this.ctx.storage.setAlarm(state.expiresAt)
    }
  }
}
