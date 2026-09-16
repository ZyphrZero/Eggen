import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DurableObjectState } from '@cloudflare/workers-types'
import { transformWithEsbuild } from 'vite'
import { Miniflare, Response as WorkerResponse } from 'miniflare'
import { ArkTask } from './arkTasks'

const source = await readFile(new URL('./arkTasks.ts', import.meta.url), 'utf8')
const script = (await transformWithEsbuild(source, 'arkTasks.ts', { target: 'es2022' })).code
const inspectableScript = `${script}
export class InspectableArkTask extends ArkTask {
  async fetch(request) {
    if (new URL(request.url).pathname === '/inspect') return Response.json(Array.from(await this.ctx.storage.list()))
    return super.fetch(request)
  }
}`
const instances: Miniflare[] = []
const id = '00000000-0000-4000-8000-000000000001'
const url = `http://localhost/api/ark/tasks/${id}`
const headers = { Authorization: 'Bearer test-user-a', 'Content-Type': 'application/json' }
const body = JSON.stringify({ model: 'doubao-seedream-test', prompt: 'test', response_format: 'url', stream: true })

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('Ark task Worker in workerd', () => {
  it('continues after submission disconnects, isolates keys, and never submits the same ID twice', async () => {
    let release!: () => void
    let started!: () => void
    const upstreamStarted = new Promise<void>((resolve) => { started = resolve })
    const upstreamRelease = new Promise<void>((resolve) => { release = resolve })
    let requests = 0
    const result = { data: [{ url: 'https://ark-images.test/generated.png' }] }
    const mf = new Miniflare({
      modules: true,
      script: inspectableScript,
      compatibilityDate: '2026-05-07',
      durableObjects: { ARK_TASKS: { className: 'InspectableArkTask', useSQLite: true } },
      outboundService: async (request) => {
        if (request.url === result.data[0].url) {
          expect(request.headers.get('Authorization')).toBeNull()
          return new WorkerResponse('image-bytes', { headers: { 'Content-Type': 'image/png' } })
        }
        requests++
        expect(request.url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations')
        expect(request.headers.get('Authorization')).toBe(headers.Authorization)
        expect(await request.json()).toEqual({ ...JSON.parse(body), stream: false, response_format: 'url' })
        started()
        await upstreamRelease
        return WorkerResponse.json(result)
      },
    })
    instances.push(mf)
    const controller = new AbortController()
    const submitted = await mf.dispatchFetch(url, { method: 'POST', headers, body, signal: controller.signal })
    expect(submitted.status).toBe(202)
    await submitted.text()
    controller.abort()
    try {
      await upstreamStarted
      expect((await mf.dispatchFetch(url, { headers })).status).toBe(202)
      expect((await mf.dispatchFetch(url, { headers: { Authorization: 'Bearer test-user-b' } })).status).toBe(404)
      expect((await mf.dispatchFetch(url, { method: 'POST', headers, body })).status).toBe(202)
      expect((await mf.dispatchFetch(url, { method: 'POST', headers, body: JSON.stringify({ model: 'other', prompt: 'different' }) })).status).toBe(409)
    } finally {
      release()
    }
    await expect.poll(async () => (await mf.dispatchFetch(url, { headers })).status).toBe(200)
    const restored = await mf.dispatchFetch(url, { headers })
    expect(restored.headers.get('Cache-Control')).toBe('no-store')
    expect(await restored.json()).toEqual(result)
    const image = await mf.dispatchFetch(`${url}/images/0`, { headers })
    expect(image.headers.get('Content-Type')).toBe('image/png')
    expect(await image.text()).toBe('image-bytes')
    const namespace = await mf.getDurableObjectNamespace('ARK_TASKS')
    const objectId = namespace.idFromName(`${createHash('sha256').update('test-user-a').digest('hex')}:${id}`)
    const stored = await (await namespace.get(objectId).fetch('http://internal/inspect')).text()
    expect(stored).not.toContain('test-user-a')
    expect(stored).not.toContain('image-bytes')
    expect(stored).not.toContain('Authorization')
    expect(stored.length).toBeLessThan(2000)
    expect(requests).toBe(1)
    expect((await mf.dispatchFetch(url, { method: 'POST', headers, body })).status).toBe(202)
    expect(requests).toBe(1)
  }, 20_000)

  it('returns the real upstream failure without executing it again', async () => {
    let requests = 0
    const mf = new Miniflare({
      modules: true,
      script,
      compatibilityDate: '2026-05-07',
      durableObjects: { ARK_TASKS: { className: 'ArkTask', useSQLite: true } },
      outboundService: () => {
        requests++
        return WorkerResponse.json({ error: { message: 'quota exceeded' } }, { status: 500 })
      },
    })
    instances.push(mf)
    expect((await mf.dispatchFetch(url, { method: 'POST', headers, body })).status).toBe(202)
    await expect.poll(async () => {
      const response = await mf.dispatchFetch(url, { headers })
      return { status: response.status, body: await response.json() }
    }).toEqual({ status: 500, body: { error: { message: 'quota exceeded' } } })
    const restored = await mf.dispatchFetch(url, { headers })
    expect(restored.headers.get('X-Eggen-Task-Status')).toBe('done')
    expect(await restored.json()).toEqual({ error: { message: 'quota exceeded' } })
    expect(requests).toBe(1)
  }, 20_000)

  it('rejects unauthenticated and cross-origin requests before starting a job', async () => {
    const mf = new Miniflare({
      modules: true,
      script,
      compatibilityDate: '2026-05-07',
      durableObjects: { ARK_TASKS: { className: 'ArkTask', useSQLite: true } },
      outboundService: () => { throw new Error('Unexpected upstream request') },
    })
    instances.push(mf)
    expect((await mf.dispatchFetch(url, { method: 'POST', body })).status).toBe(401)
    expect((await mf.dispatchFetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://other.test' }, body })).status).toBe(403)
    expect((await mf.dispatchFetch(url, { method: 'POST', headers, body: 'invalid' })).status).toBe(400)
    expect((await mf.dispatchFetch(url, { method: 'POST', headers, body: 'a'.repeat(33 * 1024 * 1024) })).status).toBe(413)
  }, 20_000)
})

it.each(['queued', 'running'])('does not resubmit a %s task after its in-memory credentials are lost', async (status) => {
  const state = new Map<string, unknown>([['state', { status, expiresAt: Date.now() + 60_000, requestHash: 'request-hash' }]])
  const ctx = { storage: {
    get: async (key: string) => state.get(key),
    put: async (key: string, value: unknown) => { state.set(key, value) },
    setAlarm: vi.fn(async () => {}),
  } }
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected duplicate submission'))
  try {
    await new ArkTask(ctx as unknown as DurableObjectState).alarm()
    expect(state.get('state')).toMatchObject({ status: 'error', error: expect.stringContaining('后台运行实例已重启') })
    expect(fetchMock).not.toHaveBeenCalled()
  } finally {
    fetchMock.mockRestore()
  }
})
