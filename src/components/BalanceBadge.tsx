import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { resolveActiveBalanceTarget, type BalanceTarget } from '../lib/balanceTarget'
import { getAccountBalanceSettings, readBalanceSettings } from '../lib/balanceSettings'
import { useBalanceQuery } from '../hooks/useBalanceQuery'

const BADGE_CLASS = 'hidden items-center gap-1.5 rounded-lg border border-gray-200/70 bg-gray-100/70 px-2 py-1.5 text-xs text-gray-700 transition-colors hover:bg-gray-200/60 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08] sm:flex'

function AccountBalanceBadge({ target }: { target: BalanceTarget }) {
  const showSettings = useStore((s) => s.showSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const [balanceSettings, setBalanceSettings] = useState(readBalanceSettings)
  const settings = getAccountBalanceSettings(balanceSettings, target.profile.id)
  const { result, error, loading, lastUpdatedAt, queryable } = useBalanceQuery(target.template, target.mapping, settings, true)

  useEffect(() => {
    if (!showSettings) setBalanceSettings(readBalanceSettings())
  }, [showSettings])

  const primaryRow = result?.rows.find((row) => row.primary) ?? result?.rows[0]
  const title = [
    target.profile.name,
    ...(result?.rows ?? []).map((row) => `${row.label}：${row.value}`),
    error ?? '',
    lastUpdatedAt ? `更新于 ${lastUpdatedAt.toLocaleTimeString('zh-CN', { hour12: false })}` : '',
    '点击前往「账户余额」设置',
  ].filter(Boolean).join('\n')

  return (
    <button type="button" onClick={() => setShowSettings(true, 'billing')} title={title} className={BADGE_CLASS}>
      {error ? (
        <span className="font-medium text-amber-600 dark:text-amber-400">余额查询失败</span>
      ) : primaryRow ? (
        <><span className="text-gray-500 dark:text-gray-400">{primaryRow.label}</span><span className="font-medium">{primaryRow.value}</span></>
      ) : (
        <span className="text-gray-500 dark:text-gray-400">{loading ? '余额查询中…' : queryable ? '账户余额' : '配置余额查询'}</span>
      )}
    </button>
  )
}

export default function BalanceBadge() {
  const settings = useStore((s) => s.settings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const target = resolveActiveBalanceTarget(settings)
  if (target) return <AccountBalanceBadge key={target.profile.id} target={target} />
  return (
    <button type="button" onClick={() => setShowSettings(true, 'billing')} title="查看所有 API 账号的余额查询状态" className={BADGE_CLASS}>
      账户余额
    </button>
  )
}
