import { describe, expect, it } from 'vitest'
import { importCustomProviderSettingsFromJson, normalizeSettings } from './apiProfiles'
import { getApiProfileModels, selectApiProfileModel } from './apiProfileModels'
import config from '../../doubao-ark-config.json'

describe('account model selection', () => {
  it('ships one Doubao account with named models and preserves its credentials when switching', () => {
    const imported = importCustomProviderSettingsFromJson(JSON.stringify(config), [], { deploymentConfig: true })
    expect(imported.profiles).toHaveLength(1)
    const settings = normalizeSettings(imported)
    const profile = settings.profiles[0]
    profile.apiKey = 'test-account'
    const models = getApiProfileModels(settings, profile)
    expect(models.map((model) => model.name)).toEqual(['豆包 Seedream 5.0 Pro', '豆包 Seedream 5.0 Lite', '豆包 Seedream 4.5'])
    const next = normalizeSettings({ ...settings, ...selectApiProfileModel(settings, profile.id, models[0].id) })
    expect(next.profiles).toHaveLength(1)
    expect(next.model).toBe(models[0].id)
    expect(next.apiKey).toBe('test-account')
    expect(next.activeProfileId).toBe(profile.id)
  })

  it('keeps a custom endpoint model selectable without duplicating catalog entries', () => {
    const settings = normalizeSettings(config)
    const profile = { ...settings.profiles[0], model: 'ep-custom' }
    expect(getApiProfileModels(settings, profile).map((model) => model.id)).toContain('ep-custom')
    expect(getApiProfileModels(settings, settings.profiles[0])).toHaveLength(3)
  })

  it('normalizes invalid and duplicate model definitions during import', () => {
    const settings = normalizeSettings({ customProviders: [{ id: 'custom', name: 'Custom', submit: {}, models: [null, {}, { id: ' pro ', name: ' Pro ', description: '说明' }, { id: 'pro', name: 'Duplicate' }] }] })
    expect(settings.customProviders[0].models).toEqual([{ id: 'pro', name: 'Pro', description: '说明' }])
  })
})
