import { getActiveApiProfile, getCustomProviderDefinition } from './apiProfiles'
import { callFalAiImageApi } from './falAiImageApi'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'
import type { CallApiOptions, CallApiResult } from './imageApiShared'
import { getImageGenerationModel } from './imageModels'
import { getSeedreamSizeConfig, getSeedreamSizeError, normalizeSeedreamSize } from './seedreamSize'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const profile = getActiveApiProfile(opts.settings)
  if (profile.provider === 'fal') return callFalAiImageApi(opts, profile)

  const seedream = getSeedreamSizeConfig(getImageGenerationModel(profile))
  const size = seedream ? normalizeSeedreamSize(opts.params.size) : opts.params.size
  const error = seedream ? getSeedreamSizeError(size, seedream) : null
  if (error) throw new Error(error)

  return callOpenAICompatibleImageApi({ ...opts, params: { ...opts.params, size } }, profile, getCustomProviderDefinition(opts.settings, profile.provider))
}
