import { useCallback, useEffect, useRef, useState } from 'react'
import type { CustomProviderBalanceMapping } from '../types'
import { hasRequiredBalanceFields, type BalanceQueryResult, type BalanceTemplate } from '../lib/balanceTemplates'
import type { BalanceAccountSettings } from '../lib/balanceSettings'

export function useBalanceQuery(template: BalanceTemplate, mapping: CustomProviderBalanceMapping, settings: BalanceAccountSettings, queryOnOpen = false) {
  const [result, setResult] = useState<BalanceQueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  const requestId = useRef(0)
  const busy = useRef(false)
  const current = useRef({ template, mapping, settings })
  current.current = { template, mapping, settings }
  const queryable = hasRequiredBalanceFields(template, settings.values)
  const key = JSON.stringify([template.id, mapping, settings])

  const runQuery = useCallback(async () => {
    const opts = current.current
    if (busy.current || !hasRequiredBalanceFields(opts.template, opts.settings.values)) return
    const id = ++requestId.current
    busy.current = true
    setLoading(true)
    setError(null)
    try {
      const next = await opts.template.query({ mapping: opts.mapping, values: opts.settings.values, timeoutSeconds: opts.settings.timeoutSeconds })
      if (id !== requestId.current) return
      setResult(next)
      setLastUpdatedAt(new Date())
    } catch (err) {
      if (id !== requestId.current) return
      console.warn('余额查询失败', err)
      setResult(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (id === requestId.current) {
        busy.current = false
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    setResult(null)
    setError(null)
    setLastUpdatedAt(null)
    setLoading(false)
    busy.current = false
    const minutes = current.current.settings.autoQueryIntervalMinutes
    if (queryOnOpen || minutes > 0) void runQuery()
    const timer = queryable && minutes > 0 ? window.setInterval(() => void runQuery(), minutes * 60 * 1000) : undefined
    return () => {
      // 换账号、改凭证或离开页面后，丢弃旧请求的返回值。
      requestId.current += 1
      window.clearInterval(timer)
    }
  }, [key, queryable, queryOnOpen, runQuery])

  return { result, error, loading, lastUpdatedAt, queryable, runQuery }
}
