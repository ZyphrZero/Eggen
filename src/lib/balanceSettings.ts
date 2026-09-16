/**
 * 余额/用量查询的通用设置存储。
 * 按账号配置 id 分区，凭证不会随应用配置导出。
 */
const SETTINGS_STORAGE_KEY = 'gpt-image-playground.balance'

export const DEFAULT_BALANCE_TIMEOUT_SECONDS = 30
export const MAX_BALANCE_TIMEOUT_SECONDS = 600
export const DEFAULT_AUTO_QUERY_INTERVAL_MINUTES = 0
export const MAX_AUTO_QUERY_INTERVAL_MINUTES = 1440

export interface BalanceAccountSettings {
  /** 模板声明的凭证字段值，键为字段 key */
  values: Record<string, string>
  timeoutSeconds: number
  autoQueryIntervalMinutes: number
}

export interface BalanceSettings {
  accounts: Record<string, BalanceAccountSettings>
}

/** 空值/非法值回落到 fallback，其余按 min~max 取整 */
export function normalizeBoundedNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value === 'string' && !value.trim()) return fallback
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(numeric)))
}

export function createDefaultBalanceAccountSettings(): BalanceAccountSettings {
  return {
    values: {},
    timeoutSeconds: DEFAULT_BALANCE_TIMEOUT_SECONDS,
    autoQueryIntervalMinutes: DEFAULT_AUTO_QUERY_INTERVAL_MINUTES,
  }
}

function normalizeValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => typeof key === 'string' && key)
    .map(([key, item]) => [key, typeof item === 'string' ? item : item === undefined || item === null ? '' : String(item)] as const)
  return Object.fromEntries(entries)
}

function normalizeAccountSettings(value: unknown): BalanceAccountSettings {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    values: normalizeValues(record.values),
    timeoutSeconds: normalizeBoundedNumber(record.timeoutSeconds, DEFAULT_BALANCE_TIMEOUT_SECONDS, 1, MAX_BALANCE_TIMEOUT_SECONDS),
    autoQueryIntervalMinutes: normalizeBoundedNumber(record.autoQueryIntervalMinutes, DEFAULT_AUTO_QUERY_INTERVAL_MINUTES, 0, MAX_AUTO_QUERY_INTERVAL_MINUTES),
  }
}

export function readBalanceSettings(): BalanceSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return { accounts: {} }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const accounts = parsed.accounts && typeof parsed.accounts === 'object' && !Array.isArray(parsed.accounts)
      ? Object.fromEntries(
          Object.entries(parsed.accounts as Record<string, unknown>)
            .filter(([id]) => typeof id === 'string' && id)
            .map(([id, item]) => [id, normalizeAccountSettings(item)]),
        )
      : {}
    return { accounts }
  } catch {
    return { accounts: {} }
  }
}

export function saveBalanceSettings(settings: BalanceSettings) {
  const accounts = Object.fromEntries(
    Object.entries(settings.accounts).map(([id, item]) => [id, {
      values: normalizeValues(item.values),
      timeoutSeconds: item.timeoutSeconds,
      autoQueryIntervalMinutes: item.autoQueryIntervalMinutes,
    }]),
  )
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ accounts }))
}

export function getAccountBalanceSettings(settings: BalanceSettings, profileId: string): BalanceAccountSettings {
  return settings.accounts[profileId] ?? createDefaultBalanceAccountSettings()
}
