// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBalanceQuery } from './useBalanceQuery'
import type { BalanceQueryResult, BalanceTemplate } from '../lib/balanceTemplates'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('account balance query', () => {
  it('discards a stale response after credentials change', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    let resolveFirst!: (result: BalanceQueryResult) => void
    const first = new Promise<BalanceQueryResult>((resolve) => { resolveFirst = resolve })
    const template: BalanceTemplate = {
      id: 'test', name: 'Test', description: '', fields: [],
      query: vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce({ rows: [{ label: 'Balance', value: '20' }] }),
    }
    let current!: ReturnType<typeof useBalanceQuery>
    function Probe({ keyValue }: { keyValue: string }) {
      current = useBalanceQuery(template, { template: 'test' }, { values: { key: keyValue }, timeoutSeconds: 30, autoQueryIntervalMinutes: 0 }, true)
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(createElement(Probe, { keyValue: 'first-test-key' })))
      await act(async () => root.render(createElement(Probe, { keyValue: 'second-test-key' })))
      expect(current.result?.rows[0].value).toBe('20')
      await act(async () => resolveFirst({ rows: [{ label: 'Balance', value: '10' }] }))
      expect(current.result?.rows[0].value).toBe('20')
      expect(current.loading).toBe(false)
    } finally {
      await act(async () => root.unmount())
    }
  })

  it('does not schedule queries before required credentials are filled', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    const query = vi.fn()
    const template: BalanceTemplate = { id: 'test', name: 'Test', description: '', fields: [{ key: 'key', label: 'Key', required: true }], query }
    function Probe() {
      useBalanceQuery(template, { template: 'test' }, { values: {}, timeoutSeconds: 30, autoQueryIntervalMinutes: 1 }, true)
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(createElement(Probe)))
      await act(async () => vi.advanceTimersByTime(120000))
      expect(query).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
    }
  })
})
