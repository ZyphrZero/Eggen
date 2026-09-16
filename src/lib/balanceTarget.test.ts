// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { normalizeSettings } from './apiProfiles'
import { getBalanceAccounts, resolveActiveBalanceTarget } from './balanceTarget'

function buildProvider(overrides: Record<string, unknown> = {}) {
  return { id: 'custom-volc', name: '火山自定义', submit: {}, balance: { template: 'volcengine-billing' }, ...overrides }
}

function buildProfile(provider: string) {
  return {
    id: 'p1',
    name: 'P1',
    provider,
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'key',
    model: 'image-model',
    timeout: 300,
    apiMode: 'images',
    codexCli: false,
    apiProxy: false,
  }
}

describe('resolveActiveBalanceTarget', () => {
  it('lists all configured accounts and keeps two accounts of one provider separate', () => {
    const settings = normalizeSettings({
      customProviders: [buildProvider(), buildProvider({ id: 'unused', name: 'Unused' })],
      profiles: [buildProfile('openai'), { ...buildProfile('custom-volc'), id: 'a' }, { ...buildProfile('custom-volc'), id: 'b', apiKey: 'other-test-account' }],
    })
    const accounts = getBalanceAccounts(settings)
    expect(accounts.map((item) => item.profile.id)).toEqual(['p1', 'a', 'b'])
    expect(accounts[0].target).toBeNull()
    expect(accounts[1].target?.profile.id).toBe('a')
    expect(accounts[2].target?.profile.id).toBe('b')
  })
  it('resolves the balance template of the active profile provider', () => {
    const target = resolveActiveBalanceTarget(normalizeSettings({
      customProviders: [buildProvider()],
      profiles: [buildProfile('custom-volc')],
      activeProfileId: 'p1',
    }))

    expect(target?.provider.id).toBe('custom-volc')
    expect(target?.mapping).toEqual({ template: 'volcengine-billing' })
    expect(target?.template.id).toBe('volcengine-billing')
  })

  it('returns null when the provider declares no balance capability', () => {
    const settings = normalizeSettings({
      customProviders: [{ id: 'custom-plain', name: '普通服务商', submit: {} }],
      profiles: [buildProfile('custom-plain')],
      activeProfileId: 'p1',
    })

    expect(resolveActiveBalanceTarget(settings)).toBeNull()
  })

  it('returns null when the declared template is not implemented', () => {
    const settings = normalizeSettings({
      customProviders: [{ id: 'custom-unknown', name: '未知模板', submit: {}, balance: { template: 'not-implemented' } }],
      profiles: [buildProfile('custom-unknown')],
      activeProfileId: 'p1',
    })

    expect(resolveActiveBalanceTarget(settings)).toBeNull()
  })

  it('ignores balance capabilities declared by other providers', () => {
    const settings = normalizeSettings({
      customProviders: [
        { id: 'custom-active', name: '生效服务商', submit: {} },
        buildProvider({ id: 'custom-other' }),
      ],
      profiles: [buildProfile('custom-active')],
      activeProfileId: 'p1',
    })

    expect(resolveActiveBalanceTarget(settings)).toBeNull()
  })

  it('returns null for an empty settings object', () => {
    expect(resolveActiveBalanceTarget({})).toBeNull()
  })
})
