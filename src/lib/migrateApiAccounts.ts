import type { ApiProfile, AppSettings, TaskRecord } from '../types'
import { normalizeSettings } from './apiProfiles'
import { putTask } from './db'

/** 仅用于首次升级的数据转换；转换后不再保留旧配置或别名。 */
export function migrateApiAccounts(settings: AppSettings, tasks: TaskRecord[]) {
  const buckets = new Map<string, ApiProfile[]>()
  const groups: ApiProfile[][] = []
  for (const profile of settings.profiles) {
    const custom = settings.customProviders.some((provider) => provider.id === profile.provider)
    const keys = [...new Set(settings.profiles.filter((item) => item.provider === profile.provider && item.baseUrl.trim() === profile.baseUrl.trim() && item.apiKey.trim()).map((item) => item.apiKey.trim()))]
    const apiKey = profile.apiKey.trim() || (keys.length === 1 ? keys[0] : '')
    const key = JSON.stringify([
      profile.provider, profile.baseUrl.trim(), apiKey,
      profile.apiMode, profile.imageGenerationModel, profile.timeout, profile.reasoningEffort,
      profile.codexCli, profile.apiProxy, profile.responseFormatB64Json, profile.streamImages,
      profile.streamPartialImages, profile.transparentBackgroundMethod,
    ])
    const group = custom ? buckets.get(key) : undefined
    if (group) group.push({ ...profile, apiKey })
    else {
      const next = [custom ? { ...profile, apiKey } : profile]
      groups.push(next)
      buckets.set(key, next)
    }
  }

  const idMap = new Map<string, string>()
  const customProviders = settings.customProviders.map((provider) => {
    const models = [...(provider.models ?? [])]
    for (const profile of settings.profiles.filter((item) => item.provider === provider.id)) {
      if (!models.some((model) => model.id === profile.model)) {
        models.push({ id: profile.model, name: profile.name, description: profile.description })
      }
    }
    return { ...provider, models }
  })
  const profiles = groups.map((group) => {
    // 按 ID 固定主配置，避免拖拽顺序或本地默认标记影响部署配置的合并。
    const profile = [...group].sort((a, b) => a.id.localeCompare(b.id, 'en'))[0]
    for (const item of group) idMap.set(item.id, profile.id)
    if (group.length === 1) return profile
    const selected = group.find((item) => item.id === settings.activeProfileId) ?? profile
    return {
      ...profile,
      isDefault: group.some((item) => item.isDefault) ? true : undefined,
      name: customProviders.find((provider) => provider.id === profile.provider)!.name,
      description: undefined,
      model: selected.model,
    }
  })
  const next = normalizeSettings({
    ...settings,
    customProviders,
    profiles,
    activeProfileId: idMap.get(settings.activeProfileId) ?? settings.activeProfileId,
    agentTextProfileId: idMap.get(settings.agentTextProfileId ?? '') ?? settings.agentTextProfileId,
    agentImageProfileId: idMap.get(settings.agentImageProfileId ?? '') ?? settings.agentImageProfileId,
  })
  return {
    settings: next,
    tasks: tasks.map((task) => {
      const id = idMap.get(task.apiProfileId ?? '')
      if (!id) return task
      const profile = profiles.find((item) => item.id === id)!
      const model = task.apiModel ?? settings.profiles.find((item) => item.id === task.apiProfileId)!.model
      if (id === task.apiProfileId && profile.name === task.apiProfileName && model === task.apiModel) return task
      return { ...task, apiProfileId: id, apiProfileName: profile.name, apiModel: model }
    }),
    idMap,
  }
}

export async function migrateStoredApiAccounts(
  state: {
    settings: AppSettings
    previousPresetConfig: Pick<AppSettings, 'profiles' | 'customProviders'> | null
    dismissedPresetProfileIds: string[]
  },
  tasks: TaskRecord[],
  saveState: (patch: Partial<typeof state>) => void,
) {
  if (localStorage.getItem('eggen.api-accounts-v1-migrated') === 'done') return tasks
  const migrated = migrateApiAccounts(state.settings, tasks)
  const previous = state.previousPresetConfig
    ? migrateApiAccounts(normalizeSettings(state.previousPresetConfig), []).settings
    : null
  const rawBalance = localStorage.getItem('eggen.balance')
  const balance = rawBalance ? JSON.parse(rawBalance) : {}
  const accounts = { ...balance.accounts }
  for (const provider of migrated.settings.customProviders) {
    const profiles = migrated.settings.profiles.filter((profile) => profile.provider === provider.id)
    const profile = profiles.find((item) => item.id === migrated.settings.activeProfileId) ?? profiles[0]
    // 原凭证只迁往一个账号，其余独立账号需要各自设置查询凭证。
    if (profile && balance.providers?.[provider.id] && !accounts[profile.id]) {
      accounts[profile.id] = balance.providers[provider.id]
    }
  }
  await Promise.all(migrated.tasks.filter((task, idx) => task !== tasks[idx]).map((task) => putTask(task)))
  // 先落盘任务引用再移除旧配置；中断后可重跑，主配置的 ID 始终存在。
  saveState({
    settings: migrated.settings,
    previousPresetConfig: previous ? { profiles: previous.profiles, customProviders: previous.customProviders } : null,
    dismissedPresetProfileIds: [...new Set(state.dismissedPresetProfileIds.map((id) => migrated.idMap.get(id) ?? id))],
  })
  if (rawBalance) localStorage.setItem('eggen.balance', JSON.stringify({ accounts }))
  localStorage.setItem('eggen.api-accounts-v1-migrated', 'done')
  return migrated.tasks
}
