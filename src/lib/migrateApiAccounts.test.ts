// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { importCustomProviderSettingsFromJson, mergePresetImportedSettings, normalizeSettings } from './apiProfiles'
import config from '../../doubao-ark-config.json'
import { migrateApiAccounts, migrateStoredApiAccounts } from './migrateApiAccounts'
import { putTask } from './db'

vi.mock('./db', () => ({ putTask: vi.fn() }))

function oldSettings() {
  return normalizeSettings({
    customProviders: [{ id: 'doubao', name: '豆包', submit: {}, balance: { template: 'volcengine-billing' } }],
    profiles: [
      { id: 'default', name: '默认', provider: 'openai' },
      ...['pro', 'lite', '4.5'].map((model) => ({
        id: model, model, name: `Seedream ${model}`, description: `${model} 使用说明`, provider: 'doubao',
        baseUrl: 'https://example.com/v3/', apiKey: 'test-account', isDefault: model === 'lite',
      })),
    ],
    activeProfileId: 'pro', agentImageProfileId: '4.5',
  })
}

const task: TaskRecord = {
  id: 'task', prompt: 'test', apiProfileId: 'pro', apiProfileName: 'Seedream pro', apiModel: 'pro',
  params: DEFAULT_PARAMS, inputImageIds: [], outputImages: [], status: 'done', error: null,
  createdAt: 1, finishedAt: 2, elapsed: 1,
}

beforeEach(() => {
  vi.stubGlobal('localStorage', (globalThis as unknown as { jsdom: { window: Window } }).jsdom.window.localStorage)
  localStorage.clear()
  vi.mocked(putTask).mockReset()
})

describe('one-time API account migration', () => {
  it('replaces three model profiles with one account and rewrites task and agent references', () => {
    const migrated = migrateApiAccounts(oldSettings(), [task])
    expect(migrated.settings.profiles).toHaveLength(2)
    expect(migrated.settings.profiles[1]).toMatchObject({ id: '4.5', name: '豆包', model: 'pro', apiKey: 'test-account', isDefault: true })
    expect(migrated.settings.customProviders[0].models).toEqual(['pro', 'lite', '4.5'].map((id) => ({ id, name: `Seedream ${id}`, description: `${id} 使用说明` })))
    expect(migrated.settings.activeProfileId).toBe('4.5')
    expect(migrated.settings.agentImageProfileId).toBe('4.5')
    expect(migrated.tasks[0]).toEqual({ ...task, apiProfileId: '4.5', apiProfileName: '豆包' })
  })

  it('keeps separate credentials, endpoints and request options as separate accounts', () => {
    for (const patch of [{ apiKey: 'another-test-account' }, { baseUrl: 'https://other.example.com' }, { responseFormatB64Json: true }]) {
      const settings = oldSettings()
      settings.profiles[2] = { ...settings.profiles[2], ...patch }
      expect(migrateApiAccounts(settings, []).settings.profiles).toHaveLength(3)
    }
  })

  it('is idempotent when a partial migration is retried', () => {
    const migrated = migrateApiAccounts(oldSettings(), [task])
    const repeated = migrateApiAccounts(migrated.settings, migrated.tasks)
    expect(repeated.settings).toEqual(migrated.settings)
    expect(repeated.tasks).toEqual(migrated.tasks)
  })

  it('merges empty model credentials into the sole configured account', () => {
    const settings = oldSettings()
    settings.profiles[1].apiKey = ''
    settings.profiles[3].apiKey = ''
    expect(migrateApiAccounts(settings, []).settings.profiles[1].apiKey).toBe('test-account')
    expect(migrateApiAccounts(settings, []).settings.profiles).toHaveLength(2)
  })

  it('removes duplicate model entries from the same account', () => {
    const settings = oldSettings()
    settings.profiles.push({ ...settings.profiles[1], id: 'pro-copy' })
    const migrated = migrateApiAccounts(settings, [])
    expect(migrated.settings.profiles).toHaveLength(2)
    expect(migrated.settings.customProviders[0].models).toHaveLength(3)
  })

  it('does not recreate old model profiles when the updated deployment loads', () => {
    const legacy = normalizeSettings({
      customProviders: [{ ...config.customProviders[0], models: undefined }],
      profiles: config.customProviders[0].models.map((model, idx) => ({
        ...config.profiles[0], id: ['custom-doubao-ark-seedream5', 'custom-doubao-ark-seedream5-lite', 'custom-doubao-ark-seedream5-std'][idx],
        model: model.id, name: model.name, isDefault: undefined, apiKey: idx === 1 ? 'test-account' : '',
      })).reverse(),
      activeProfileId: 'custom-doubao-ark-seedream5-lite',
    })
    const migrated = migrateApiAccounts(legacy, [])
    const preset = importCustomProviderSettingsFromJson(JSON.stringify(config), [], { deploymentConfig: true })
    const next = mergePresetImportedSettings(migrated.settings, preset)
    expect(next.settings.profiles).toHaveLength(1)
    expect(next.settings.profiles[0]).toMatchObject({ id: config.profiles[0].id, name: '豆包', apiKey: 'test-account' })
  })

  it('writes tasks before removing old profiles and moves balance credentials once', async () => {
    const settings = oldSettings()
    const state = { settings, previousPresetConfig: { profiles: settings.profiles, customProviders: settings.customProviders }, dismissedPresetProfileIds: [] }
    const balance = { values: { accessKeyId: 'test-ak' }, timeoutSeconds: 30, autoQueryIntervalMinutes: 0 }
    localStorage.setItem('gpt-image-playground.balance', JSON.stringify({ providers: { doubao: balance } }))
    const save = vi.fn((patch) => {
      expect(putTask).toHaveBeenCalledWith(expect.objectContaining({ apiProfileId: '4.5', apiModel: 'pro' }))
      Object.assign(state, patch)
    })
    const tasks = await migrateStoredApiAccounts(state, [task], save)
    expect(state.previousPresetConfig.profiles).toHaveLength(2)
    expect(JSON.parse(localStorage.getItem('gpt-image-playground.balance')!)).toEqual({ accounts: { '4.5': balance } })
    expect(localStorage.getItem('gpt-image-playground.api-accounts-v1-migrated')).toBe('done')
    await migrateStoredApiAccounts(state, tasks, save)
    expect(save).toHaveBeenCalledTimes(1)
    expect(putTask).toHaveBeenCalledTimes(1)
  })

  it('does not mark migration complete or delete profiles after a task write fails', async () => {
    vi.mocked(putTask).mockRejectedValueOnce(new Error('disk full'))
    const save = vi.fn()
    await expect(migrateStoredApiAccounts({ settings: oldSettings(), previousPresetConfig: null, dismissedPresetProfileIds: [] }, [task], save)).rejects.toThrow('disk full')
    expect(save).not.toHaveBeenCalled()
    expect(localStorage.getItem('gpt-image-playground.api-accounts-v1-migrated')).toBeNull()
  })
})
