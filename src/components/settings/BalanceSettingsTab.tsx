import { useState } from 'react'
import { useStore } from '../../store'
import { hasRequiredBalanceFields, type BalanceTemplate } from '../../lib/balanceTemplates'
import { useBalanceQuery } from '../../hooks/useBalanceQuery'
import { getBalanceAccounts } from '../../lib/balanceTarget'
import { getApiProfileModels } from '../../lib/apiProfileModels'
import { getApiProviderLabel } from '../../lib/apiProfiles'
import {
  DEFAULT_AUTO_QUERY_INTERVAL_MINUTES,
  DEFAULT_BALANCE_TIMEOUT_SECONDS,
  MAX_AUTO_QUERY_INTERVAL_MINUTES,
  MAX_BALANCE_TIMEOUT_SECONDS,
  getAccountBalanceSettings,
  normalizeBoundedNumber,
  readBalanceSettings,
  saveBalanceSettings,
  type BalanceAccountSettings,
  type BalanceSettings,
} from '../../lib/balanceSettings'
import type { ApiProfile, CustomProviderDefinition } from '../../types'

const INPUT_CLASS = 'w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50'
const NUMBER_CLASS = 'w-full rounded-xl border border-gray-200/60 bg-white/50 px-3 py-1.5 text-xs text-gray-700 outline-none transition-all duration-200 hover:bg-white focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:hover:bg-white/[0.06] dark:focus:border-blue-500/50'

function formatTime(date: Date) {
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

interface ProviderBalanceSectionProps {
  profile: ApiProfile
  provider: CustomProviderDefinition
  template: BalanceTemplate
  settings: BalanceAccountSettings
  onChange: (patch: Partial<BalanceAccountSettings>) => void
}

function ProviderBalanceSection({ profile, provider, template, settings, onChange }: ProviderBalanceSectionProps) {
  const { result, error, loading, lastUpdatedAt, runQuery } = useBalanceQuery(template, provider.balance!, settings)
  const [visibleSecrets, setVisibleSecrets] = useState<string[]>([])
  const [timeoutInput, setTimeoutInput] = useState(String(settings.timeoutSeconds))
  const [intervalInput, setIntervalInput] = useState(String(settings.autoQueryIntervalMinutes))

  const requiredFieldsFilled = hasRequiredBalanceFields(template, settings.values)

  const commitTimeout = () => {
    const value = normalizeBoundedNumber(timeoutInput, DEFAULT_BALANCE_TIMEOUT_SECONDS, 1, MAX_BALANCE_TIMEOUT_SECONDS)
    setTimeoutInput(String(value))
    if (value !== settings.timeoutSeconds) onChange({ timeoutSeconds: value })
  }

  const commitInterval = () => {
    const value = normalizeBoundedNumber(intervalInput, DEFAULT_AUTO_QUERY_INTERVAL_MINUTES, 0, MAX_AUTO_QUERY_INTERVAL_MINUTES)
    setIntervalInput(String(value))
    if (value === settings.autoQueryIntervalMinutes) return
    onChange({ autoQueryIntervalMinutes: value })
  }

  const primaryRow = result?.rows.find((row) => row.primary)
  const detailRows = result?.rows.filter((row) => !row.primary) ?? []

  return (
    <div className="space-y-4 rounded-2xl border border-gray-200/70 bg-white/40 p-4 dark:border-white/[0.08] dark:bg-white/[0.02]">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{profile.name}</span>
          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
            {template.name}
          </span>
        </div>
        <div data-selectable-text className="mt-1 text-xs text-gray-500 dark:text-gray-500">
          {template.description}
        </div>
      </div>

      {template.help && (
        <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
          {template.help.lines.map((line) => <div key={line}>{line}</div>)}
          {template.help.link && (
            <div>
              {template.help.link.label}：
              <a
                href={template.help.link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline underline-offset-2 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                {template.help.link.url}
              </a>
            </div>
          )}
        </div>
      )}

      {template.fields.map((field) => (
        <label key={field.key} className="block">
          <span className="mb-1.5 flex items-center justify-between">
            <span className="block text-sm text-gray-600 dark:text-gray-300">{field.label}</span>
            {field.secret && (
              <button
                type="button"
                onClick={() => setVisibleSecrets((prev) => prev.includes(field.key) ? prev.filter((key) => key !== field.key) : [...prev, field.key])}
                className="text-xs text-blue-600 transition hover:text-blue-700 dark:text-blue-400"
              >
                {visibleSecrets.includes(field.key) ? '隐藏' : '显示'}
              </button>
            )}
          </span>
          <input
            value={settings.values[field.key] ?? ''}
            onChange={(e) => onChange({ values: { ...settings.values, [field.key]: e.target.value } })}
            type={field.secret && !visibleSecrets.includes(field.key) ? 'password' : 'text'}
            placeholder={field.placeholder}
            autoComplete="off"
            className={INPUT_CLASS}
          />
        </label>
      ))}

      <div className="block">
        <div className="mb-1 flex items-center justify-between">
          <span className="block text-sm text-gray-600 dark:text-gray-300">超时时间（秒）</span>
          <div className="w-28 shrink-0">
            <input
              value={timeoutInput}
              onChange={(e) => setTimeoutInput(e.target.value)}
              onBlur={commitTimeout}
              type="number"
              min={1}
              max={MAX_BALANCE_TIMEOUT_SECONDS}
              className={NUMBER_CLASS}
            />
          </div>
        </div>
        <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
          单次查询的等待上限，超过则中止并提示超时。
        </div>
      </div>

      <div className="block">
        <div className="mb-1 flex items-center justify-between">
          <span className="block text-sm text-gray-600 dark:text-gray-300">自动查询间隔（分钟）</span>
          <div className="w-28 shrink-0">
            <input
              value={intervalInput}
              onChange={(e) => setIntervalInput(e.target.value)}
              onBlur={commitInterval}
              type="number"
              min={0}
              max={MAX_AUTO_QUERY_INTERVAL_MINUTES}
              className={NUMBER_CLASS}
            />
          </div>
        </div>
        <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
          填 0 表示不自动刷新。顶栏会显示最近一次查询结果，设置为非 0 后按此间隔自动刷新。
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void runQuery()}
          disabled={loading || !requiredFieldsFilled}
          className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? '查询中…' : '查询余额'}
        </button>
        {lastUpdatedAt && (
          <span className="text-xs text-gray-400 dark:text-gray-500">更新于 {formatTime(lastUpdatedAt)}</span>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200/70 bg-red-50/70 px-3.5 py-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3 rounded-xl border border-gray-200/70 bg-gray-50/70 px-3.5 py-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
          {primaryRow && (
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-300">{primaryRow.label}</span>
              <span className="text-xl font-bold text-gray-800 dark:text-gray-100">{primaryRow.value}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            {detailRows.map((row) => (
              <div key={row.label} className="col-span-2 grid grid-cols-2 gap-x-4">
                <span className="text-gray-500 dark:text-gray-400">{row.label}</span>
                <span className="text-right text-gray-700 dark:text-gray-200">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function BalanceSettingsTab() {
  const appSettings = useStore((s) => s.settings)
  const [settings, setSettings] = useState<BalanceSettings>(readBalanceSettings)
  const [selectedId, setSelectedId] = useState(appSettings.activeProfileId)
  const accounts = getBalanceAccounts(appSettings)
  const selected = accounts.find((item) => item.profile.id === selectedId) ?? accounts[0]

  const updateAccount = (profileId: string, patch: Partial<BalanceAccountSettings>) => {
    const current = getAccountBalanceSettings(settings, profileId)
    const next: BalanceSettings = { accounts: { ...settings.accounts, [profileId]: { ...current, ...patch } } }
    setSettings(next)
    saveBalanceSettings(next)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2" aria-label="余额账号列表">
        {accounts.map(({ profile, target }) => {
          const configured = target && hasRequiredBalanceFields(target.template, getAccountBalanceSettings(settings, profile.id).values)
          return (
            <button
              key={profile.id}
              type="button"
              onClick={() => setSelectedId(profile.id)}
              aria-pressed={selected.profile.id === profile.id}
              className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${selected.profile.id === profile.id ? 'border-blue-300 bg-blue-50/60 dark:border-blue-500/40 dark:bg-blue-500/10' : 'border-gray-200/70 hover:bg-gray-50 dark:border-white/[0.08] dark:hover:bg-white/[0.04]'}`}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-100">
                  <span className="truncate">{profile.name}</span>
                  {profile.id === appSettings.activeProfileId && <span className="shrink-0 text-[10px] text-blue-500">当前使用</span>}
                </span>
                <span className="mt-1 block truncate text-xs text-gray-500">{getApiProviderLabel(appSettings, profile.provider)} · {getApiProfileModels(appSettings, profile).length} 个模型</span>
              </span>
              <span className={`shrink-0 text-xs ${configured ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500'}`}>{target ? configured ? '可查询' : '待配置凭证' : '暂不支持查询'}</span>
            </button>
          )
        })}
      </div>
      {selected.target ? (
        <ProviderBalanceSection
          key={selected.profile.id}
          profile={selected.profile}
          provider={selected.target.provider}
          template={selected.target.template}
          settings={getAccountBalanceSettings(settings, selected.profile.id)}
          onChange={(patch) => updateAccount(selected.profile.id, patch)}
        />
      ) : (
        <div className="rounded-xl border border-gray-200/70 px-3.5 py-4 text-sm leading-6 text-gray-500 dark:border-white/[0.08] dark:text-gray-400">
          <div className="font-medium text-gray-700 dark:text-gray-200">{selected.profile.name} · 暂不支持查询</div>
          {selected.provider?.balance ? '该供应商的余额查询方式尚未接入。请前往供应商控制台查看余额。' : '该账号尚未提供可用的余额查询接口。请前往供应商控制台查看余额，图像生成不受影响。'}
        </div>
      )}
      <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
        凭证只保存在本浏览器的 localStorage，且与应用的配置导入/导出隔离，不会被随配置分享出去。
        账号级 Secret 权限很高，建议使用只具备账单只读权限的子账号密钥。
      </div>
    </div>
  )
}
