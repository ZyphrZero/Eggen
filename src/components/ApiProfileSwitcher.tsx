import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { getActiveApiProfile } from '../lib/apiProfiles'
import { getApiProfileModels, selectApiProfileModel } from '../lib/apiProfileModels'
import type { ApiProfile } from '../types'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { ChevronDownIcon } from './icons'

export default function ApiProfileSwitcher() {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const setReusedTaskApiProfile = useStore((s) => s.setReusedTaskApiProfile)
  const showToast = useStore((s) => s.showToast)
  const [open, setOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const activeProfile = getActiveApiProfile(settings)
  const activeModels = getApiProfileModels(settings, activeProfile)
  const activeModel = activeModels.find((model) => model.id === activeProfile.model)

  useCloseOnEscape(open, () => setOpen(false))

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const applyModel = (profile: ApiProfile, model: string) => {
    setOpen(false)
    if (profile.id === activeProfile.id && model === activeProfile.model) return
    // 清除任务复用配置，否则下一次提交仍会走被复用的旧配置。
    setReusedTaskApiProfile(null)
    setSettings(selectApiProfileModel(settings, profile.id, model))
    showToast(`已切换到「${profile.name} · ${getApiProfileModels(settings, profile).find((item) => item.id === model)?.name ?? model}」`, 'success')
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => {
          setExpandedId(activeProfile.id)
          setOpen(!open)
        }}
        aria-label="切换模型配置"
        aria-expanded={open}
        title={`当前配置「${activeProfile.name}」：${activeModel?.name ?? activeProfile.model}`}
        className="flex min-w-0 max-w-[9rem] items-center gap-1.5 rounded-lg border border-gray-200/70 bg-gray-100/70 py-1.5 pl-2 pr-1.5 text-xs text-gray-700 transition-colors hover:bg-gray-200/60 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08] sm:max-w-[14rem]"
      >
        <span className="min-w-0 flex-1 truncate font-medium">{activeModels.length > 1 ? `${activeProfile.name} · ${activeModel?.name ?? activeProfile.model}` : activeProfile.name}</span>
        <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform duration-200 dark:text-gray-500 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="custom-scrollbar absolute left-0 top-full z-50 mt-1.5 max-h-[60vh] w-[17rem] overflow-y-auto rounded-xl border border-gray-200/60 bg-white/95 py-1 shadow-[0_8px_30px_rgb(0,0,0,0.12)] ring-1 ring-black/5 backdrop-blur-xl animate-dropdown-down dark:border-white/[0.08] dark:bg-gray-900/95 dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] dark:ring-white/10">
          {settings.profiles.map((profile) => {
            const models = getApiProfileModels(settings, profile)
            const multiple = models.length > 1
            const expanded = expandedId === profile.id
            const active = profile.id === activeProfile.id
            return (
              <div key={profile.id}>
                <button
                  type="button"
                  onClick={() => multiple ? setExpandedId(expanded ? null : profile.id) : applyModel(profile, profile.model)}
                  aria-expanded={multiple ? expanded : undefined}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs transition-colors ${active ? 'font-medium text-blue-600 dark:text-blue-400' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]'}`}
                >
                  <span className="min-w-0 truncate">{profile.name}</span>
                  {multiple ? <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} /> : active && <span aria-label="当前选择">✓</span>}
                </button>
                {multiple && expanded && (
                  <div className="mb-1 ml-3 border-l border-gray-200 dark:border-white/10">
                    {models.map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => applyModel(profile, model.id)}
                        aria-pressed={active && activeProfile.model === model.id}
                        title={model.id}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs ${active && activeProfile.model === model.id ? 'bg-blue-50 font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-400' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]'}`}
                      >
                        <span className="min-w-0 truncate">{model.name}</span>
                        {active && activeProfile.model === model.id && <span aria-label="当前选择">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
