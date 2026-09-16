import type { ApiProfile, AppSettings, CustomProviderModel } from '../types'
import { getCustomProviderModels } from './apiProfiles'

export function getApiProfileModels(settings: AppSettings, profile: ApiProfile): CustomProviderModel[] {
  const models = getCustomProviderModels(settings, profile.provider)
  if (models.some((model) => model.id === profile.model)) return models
  return [...models, { id: profile.model, name: profile.model }]
}

export function selectApiProfileModel(settings: AppSettings, profileId: string, model: string): Partial<AppSettings> {
  return {
    activeProfileId: profileId,
    profiles: settings.profiles.map((profile) => profile.id === profileId ? { ...profile, model } : profile),
  }
}
