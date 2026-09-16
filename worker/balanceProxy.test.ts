import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { transformWithEsbuild } from 'vite'
import { Miniflare, Response as WorkerResponse } from 'miniflare'
import { buildSignedQuery } from '../src/lib/volcengineSign'

const script = (await transformWithEsbuild(await readFile(new URL('./arkTasks.ts', import.meta.url), 'utf8'), 'arkTasks.ts', { target: 'es2022' })).code
const query = await buildSignedQuery({
  method: 'POST', pathname: '/', service: 'billing', region: 'cn-shanghai',
  params: { Action: 'QueryBalanceAcct', Version: '2022-01-01' },
}, { accessKeyId: 'AKTEST', secretAccessKey: 'test-secret' })
const endpoint = 'http://localhost/api/ark/balance'
const headers = { 'Content-Type': 'application/json', Origin: 'http://localhost' }
const instances: Miniflare[] = []

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('Volcengine balance proxy in workerd', () => {
  it.each([200, 403])('forwards only the signed balance query and preserves the upstream HTTP %s response', async (status) => {
    const result = status === 200
      ? { Result: { AvailableBalance: '19.4', Currency: 'CNY' } }
      : { ResponseMetadata: { Error: { Code: 'AccessDenied', Message: 'Permission denied' } } }
    const calls: Array<{ url: string; method: string; body: string; cookie: string | null; authorization: string | null }> = []
    const mf = new Miniflare({
      modules: true, script, compatibilityDate: '2026-05-07',
      serviceBindings: { ASSETS: () => new WorkerResponse('Not found', { status: 404 }) },
      outboundService: async (request) => {
        calls.push({ url: request.url, method: request.method, body: await request.text(), cookie: request.headers.get('Cookie'), authorization: request.headers.get('Authorization') })
        return WorkerResponse.json(result, { status, headers: { 'Set-Cookie': 'upstream-session=private' } })
      },
    })
    instances.push(mf)
    const response = await mf.dispatchFetch(endpoint, { method: 'POST', headers: { ...headers, Cookie: 'local-session=private' }, body: JSON.stringify({ query }) })
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual(result)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(calls).toEqual([{ url: `https://open.volcengineapi.com/?${query}`, method: 'POST', body: '{}', cookie: null, authorization: null }])
  })

  it('rejects other actions, duplicate parameters, unsigned requests, alternate targets and oversized payloads', async () => {
    let calls = 0
    const mf = new Miniflare({
      modules: true, script, compatibilityDate: '2026-05-07',
      serviceBindings: { ASSETS: () => new WorkerResponse('Not found', { status: 404 }) },
      outboundService: () => { calls++; return WorkerResponse.json({}) },
    })
    instances.push(mf)
    const params = new URLSearchParams(query)
    params.delete('X-Signature')
    for (const body of [
      JSON.stringify({ query: query.replace('QueryBalanceAcct', 'DeleteUser') }),
      JSON.stringify({ query: `${query}&Action=QueryBalanceAcct` }),
      JSON.stringify({ query: params.toString() }),
      JSON.stringify({ query, endpoint: 'https://other.test/' }),
      'not json',
    ]) {
      expect((await mf.dispatchFetch(endpoint, { method: 'POST', headers, body })).status).toBe(400)
    }
    expect((await mf.dispatchFetch(endpoint, { method: 'POST', headers, body: 'x'.repeat(33 * 1024) })).status).toBe(413)
    expect((await mf.dispatchFetch(endpoint, { method: 'POST', headers: { ...headers, Origin: 'https://other.test' }, body: JSON.stringify({ query }) })).status).toBe(403)
    expect((await mf.dispatchFetch(endpoint)).status).toBe(405)
    expect(calls).toBe(0)
  })
})
