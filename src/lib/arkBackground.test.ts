import { afterEach, describe, expect, it, vi } from 'vitest'
import { isArkBackgroundTask, isArkImageProfile, submitArkBackgroundTask, waitForArkBackgroundTask } from './arkBackground'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Ark background tasks', () => {
  it('only selects the official Ark image endpoint', () => {
    expect(isArkImageProfile({ baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/' })).toBe(true)
    expect(isArkImageProfile({ baseUrl: 'https://ark.cn-beijing.volces.com.evil.test/api/v3/' })).toBe(false)
    expect(isArkImageProfile({ baseUrl: 'https://example.com/v1' })).toBe(false)
    expect(isArkBackgroundTask('eggen-ark:123')).toBe(true)
    expect(isArkBackgroundTask('provider-task-123')).toBe(false)
  })

  it('persists the task ID before submitting, and polls the same task', async () => {
    const events: string[] = []
    const payload = { data: [{ b64_json: 'aW1hZ2U=' }] }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      events.push(init?.method ?? 'GET')
      return init?.method === 'POST'
        ? Response.json({ status: 'queued' }, { status: 202 })
        : Response.json(payload)
    })
    const response = await submitArkBackgroundTask('key', '{"model":"seedream","prompt":"test"}', 120, async (request) => {
      expect(isArkBackgroundTask(request.taskId)).toBe(true)
      await Promise.resolve()
      events.push('persisted')
    })
    expect(events).toEqual(['persisted', 'POST', 'GET'])
    expect(fetchMock.mock.calls[0][0]).toBe(fetchMock.mock.calls[1][0])
    expect(fetchMock.mock.calls[0][0]).not.toContain('key')
    expect(await response.json()).toEqual(payload)
  })

  it('recovers an accepted submission whose acknowledgement was lost without resubmitting', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('connection lost'))
      .mockResolvedValueOnce(Response.json({ data: [{ b64_json: 'aW1hZ2U=' }] }))
    const response = await submitArkBackgroundTask('key', '{}', 120)
    expect(response.ok).toBe(true)
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['POST', 'GET'])
  })

  it('reports missing backend support explicitly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>app</html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(submitArkBackgroundTask('key', '{}', 120)).rejects.toThrow('Cloudflare')
  })

  it('resumes by querying, and preserves upstream errors instead of retrying generation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(
      { error: { message: 'quota exceeded' } },
      { status: 500, headers: { 'X-Eggen-Task-Status': 'done' } },
    ))
    const response = await waitForArkBackgroundTask('key', 'eggen-ark:task')
    expect(response.status).toBe(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined()
  })

  it('keeps polling across a temporary network failure', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(Response.json({ status: 'running' }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ data: [{ b64_json: 'aW1hZ2U=' }] }))
    const pending = waitForArkBackgroundTask('key', 'eggen-ark:task')
    await vi.runAllTimersAsync()
    expect((await pending).ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('downloads images through the authenticated task endpoint without using the upstream URL in the browser', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ data: [{ url: 'https://images.test/result.png', size: '2048x2048' }] }))
      .mockResolvedValueOnce(new Response('image', { headers: { 'Content-Type': 'image/png' } }))
    const response = await waitForArkBackgroundTask('key', 'eggen-ark:task')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/ark/tasks/task/images/0')
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({ Authorization: 'Bearer key' })
    expect(await response.json()).toEqual({ data: [{ b64_json: 'data:image/png;base64,aW1hZ2U=', size: '2048x2048' }] })
  })

  it('retries a disconnected image download using the completed task', async () => {
    vi.useFakeTimers()
    const payload = { data: [{ url: 'https://images.test/result.png' }] }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(payload, { headers: { 'X-Eggen-Task-Status': 'done' } }))
      .mockRejectedValueOnce(new TypeError('download disconnected'))
      .mockResolvedValueOnce(Response.json(payload))
      .mockResolvedValueOnce(new Response('image', { headers: { 'Content-Type': 'image/png' } }))
    const pending = waitForArkBackgroundTask('key', 'eggen-ark:task')
    await vi.runAllTimersAsync()
    expect(await (await pending).json()).toEqual({ data: [{ b64_json: 'data:image/png;base64,aW1hZ2U=' }] })
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method)).toBe(true)
  })
})
