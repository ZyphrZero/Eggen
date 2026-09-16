import type { ApiProfile } from '../types'
import { blobToDataUrl } from './dataUrl'
import { getApiErrorMessage } from './imageApiShared'

const TASK_PREFIX = 'eggen-ark:'
const TASK_PATH = '/api/ark/tasks/'
const BACKEND_ERROR = '当前站点未启用豆包后台任务，请使用包含 Durable Object 配置的 Cloudflare Workers 部署。'

export class ArkTaskQueryError extends Error {}

export function isArkImageProfile(profile: Pick<ApiProfile, 'baseUrl'>) {
  try {
    const url = new URL(profile.baseUrl)
    return url.origin === 'https://ark.cn-beijing.volces.com' && url.pathname.replace(/\/+$/, '') === '/api/v3'
  } catch {
    return false
  }
}

export function isArkBackgroundTask(taskId: string | undefined) {
  return Boolean(taskId?.startsWith(TASK_PREFIX))
}

export async function waitForArkBackgroundTask(apiKey: string, taskId: string): Promise<Response> {
  const deadline = Date.now() + 16 * 60_000
  while (Date.now() < deadline) {
    let response: Response | undefined
    try {
      response = await fetch(`${TASK_PATH}${encodeURIComponent(taskId.slice(TASK_PREFIX.length))}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
      })
      if (response.status === 200 && response.headers.get('Content-Type')?.includes('application/json')) {
        const payload = await response.json()
        if (Array.isArray(payload?.data)) {
          for (let index = 0; index < payload.data.length; index++) {
            const item = payload.data[index]
            if (typeof item?.url !== 'string') continue
            const image = await fetch(`${TASK_PATH}${encodeURIComponent(taskId.slice(TASK_PREFIX.length))}/images/${index}`, {
              headers: { Authorization: `Bearer ${apiKey}` },
              cache: 'no-store',
              signal: AbortSignal.timeout(60_000),
            })
            if (!image.ok) throw new Error(await getApiErrorMessage(image))
            item.b64_json = await blobToDataUrl(await image.blob())
            delete item.url
          }
        }
        return Response.json(payload)
      }
    } catch (err) {
      if (!(err instanceof TypeError) && !(err instanceof Error && ['TimeoutError', 'AbortError'].includes(err.name))) throw err
      response = undefined
    }
    if (response) {
      if (response.headers.get('X-Eggen-Task-Status') === 'done') return response
      if (response.status !== 202 && response.status !== 429 && response.status < 500) {
        if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error(BACKEND_ERROR)
        return response
      }
      await response.body?.cancel()
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
  throw new ArkTaskQueryError('豆包后台任务暂时无法连接，稍后会继续查询，不会重新提交生成请求。')
}

export async function submitArkBackgroundTask(
  apiKey: string,
  body: string,
  timeout: number,
  onEnqueued?: (request: { taskId: string }) => void | Promise<void>,
): Promise<Response> {
  const taskId = `${TASK_PREFIX}${crypto.randomUUID()}`
  // 先落盘再发送，刷新或丢失提交回执后仍能定位同一次请求。
  await onEnqueued?.({ taskId })
  let response: Response | undefined
  try {
    response = await fetch(`${TASK_PATH}${taskId.slice(TASK_PREFIX.length)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Eggen-Timeout': String(timeout),
      },
      body,
      signal: AbortSignal.timeout(60_000),
    })
  } catch (err) {
    if (!(err instanceof TypeError) && !(err instanceof Error && ['TimeoutError', 'AbortError'].includes(err.name))) throw err
  }
  if (response) {
    if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error(BACKEND_ERROR)
    if (!response.ok && response.status < 500) return response
    await response.body?.cancel()
  }
  return waitForArkBackgroundTask(apiKey, taskId)
}
