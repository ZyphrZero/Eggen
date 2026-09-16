// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AUTO_QUERY_INTERVAL_MINUTES,
  DEFAULT_BALANCE_TIMEOUT_SECONDS,
  getAccountBalanceSettings,
  normalizeBoundedNumber,
  readBalanceSettings,
  saveBalanceSettings,
} from './balanceSettings'

const STORAGE_KEY = 'eggen.balance'

beforeEach(() => vi.stubGlobal('localStorage', (globalThis as unknown as { jsdom: { window: Window } }).jsdom.window.localStorage))
afterEach(() => localStorage.clear())

describe('normalizeBoundedNumber', () => {
  it('falls back for blank or non-numeric input', () => {
    expect(normalizeBoundedNumber('', 30, 1, 600)).toBe(30)
    expect(normalizeBoundedNumber('   ', 30, 1, 600)).toBe(30)
    expect(normalizeBoundedNumber('abc', 30, 1, 600)).toBe(30)
    expect(normalizeBoundedNumber(undefined, 0, 0, 1440)).toBe(0)
  })

  it('clamps to range and truncates decimals', () => {
    expect(normalizeBoundedNumber('9999', 30, 1, 600)).toBe(600)
    expect(normalizeBoundedNumber('-5', 0, 0, 1440)).toBe(0)
    expect(normalizeBoundedNumber('12.7', 0, 0, 1440)).toBe(12)
  })
})

describe('balance settings storage', () => {
  it('returns empty settings when nothing is stored', () => {
    expect(readBalanceSettings()).toEqual({ accounts: {} })
  })

  it('keeps accounts isolated from each other', () => {
    saveBalanceSettings({
      accounts: {
        'provider-a': { values: { accessKeyId: 'AK-A' }, timeoutSeconds: 45, autoQueryIntervalMinutes: 10 },
        'provider-b': { values: { accessKeyId: 'AK-B' }, timeoutSeconds: 5, autoQueryIntervalMinutes: 0 },
      },
    })

    const settings = readBalanceSettings()
    expect(getAccountBalanceSettings(settings, 'provider-a').values.accessKeyId).toBe('AK-A')
    expect(getAccountBalanceSettings(settings, 'provider-b').values.accessKeyId).toBe('AK-B')
    expect(getAccountBalanceSettings(settings, 'provider-a').timeoutSeconds).toBe(45)
    expect(getAccountBalanceSettings(settings, 'provider-b').timeoutSeconds).toBe(5)
  })

  it('falls back to defaults for an unknown provider', () => {
    const settings = getAccountBalanceSettings(readBalanceSettings(), 'missing')
    expect(settings.values).toEqual({})
    expect(settings.timeoutSeconds).toBe(DEFAULT_BALANCE_TIMEOUT_SECONDS)
    expect(settings.autoQueryIntervalMinutes).toBe(DEFAULT_AUTO_QUERY_INTERVAL_MINUTES)
  })

  it('clamps out-of-range numbers read from storage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      accounts: { 'provider-a': { values: { accessKeyId: 'AK-A' }, timeoutSeconds: 99999, autoQueryIntervalMinutes: -3 } },
    }))

    const settings = getAccountBalanceSettings(readBalanceSettings(), 'provider-a')
    expect(settings.timeoutSeconds).toBe(600)
    expect(settings.autoQueryIntervalMinutes).toBe(0)
  })

  it('recovers from malformed stored json', () => {
    localStorage.setItem(STORAGE_KEY, '{ not json')
    expect(readBalanceSettings()).toEqual({ accounts: {} })
  })
})
