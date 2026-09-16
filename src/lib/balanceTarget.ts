import type { ApiProfile, AppSettings, CustomProviderBalanceMapping, CustomProviderDefinition } from '../types'
import { getActiveApiProfile, getCustomProviderDefinition, normalizeSettings } from './apiProfiles'
import { getBalanceTemplate, type BalanceTemplate } from './balanceTemplates'

export interface BalanceTarget {
  profile: ApiProfile
  provider: CustomProviderDefinition
  mapping: CustomProviderBalanceMapping
  template: BalanceTemplate
}

/** 主界面展示的余额取当前生效配置所属服务商；服务商未声明或模板未实现时返回 null */
export function resolveActiveBalanceTarget(settings: Partial<AppSettings> | unknown): BalanceTarget | null {
  const profile = getActiveApiProfile(settings)
  const provider = getCustomProviderDefinition(settings, profile.provider)
  const mapping = provider?.balance
  const template = getBalanceTemplate(mapping?.template)
  if (!provider || !mapping || !template) return null
  return { profile, provider, mapping, template }
}

export function getBalanceAccounts(settings: AppSettings) {
  return settings.profiles.map((profile) => ({
    profile,
    target: resolveActiveBalanceTarget(normalizeSettings({ ...settings, activeProfileId: profile.id })),
    provider: getCustomProviderDefinition(settings, profile.provider),
  }))
}
