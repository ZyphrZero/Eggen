import { parseRatio } from './size'

export type SeedreamSizeTier = '1K' | '1.5K' | '2K' | '3K' | '4K'

export interface SeedreamSizeConfig {
  tiers: SeedreamSizeTier[]
  minPixels: number
  maxPixels: number
}

const PRO: SeedreamSizeConfig = { tiers: ['1K', '1.5K', '2K'], minPixels: 921600, maxPixels: 4624220 }
const LITE: SeedreamSizeConfig = { tiers: ['2K', '3K', '4K'], minPixels: 3686400, maxPixels: 16777216 }
const V45: SeedreamSizeConfig = { tiers: ['2K', '4K'], minPixels: 3686400, maxPixels: 16777216 }
const V40: SeedreamSizeConfig = { tiers: ['1K', '2K', '4K'], minPixels: 921600, maxPixels: 16777216 }

export function getSeedreamSizeConfig(model: string) {
  const name = model.trim().toLowerCase()
  if (/^doubao-seedream-5[-.]0-pro(?:-|$)/.test(name)) return PRO
  if (/^doubao-seedream-5[-.]0(?:-|$)/.test(name)) return LITE
  if (/^doubao-seedream-4[-.]5(?:-|$)/.test(name)) return V45
  if (/^doubao-seedream-4[-.]0(?:-|$)/.test(name)) return V40
  return null
}

export function normalizeSeedreamSize(size: string) {
  const value = size.trim()
  // 生图的智能模式通过分辨率档位交给模型决定比例；auto 仅用于图层拆分。
  if (!value || value.toLowerCase() === 'auto') return '2K'
  return value.replace(/k$/i, 'K').replace(/\s*[xX×]\s*/, 'x')
}

export function getSeedreamSizeError(size: string, config: SeedreamSizeConfig) {
  const value = normalizeSeedreamSize(size)
  if (config.tiers.includes(value as SeedreamSizeTier)) return null
  const match = value.match(/^(\d+)x(\d+)$/)
  if (!match) return `当前模型支持 ${config.tiers.join('、')} 智能分辨率，或自定义宽高。`
  const width = Number(match[1])
  const height = Number(match[2])
  const pixels = width * height
  if (!width || !height || !Number.isFinite(pixels)) return '请输入有效的正整数宽高。'
  if (Math.max(width / height, height / width) > 16) return '当前模型的宽高比须在 1:16 至 16:1 之间。'
  if (pixels < config.minPixels || pixels > config.maxPixels) {
    return `当前尺寸为 ${pixels} 像素，总像素须在 ${config.minPixels}–${config.maxPixels} 之间，请调整尺寸。`
  }
  return null
}

// 文档中的常用比例尺寸。横竖比例通过交换宽高复用，避免套用 GPT Image 的像素预算。
const PRESETS: Record<SeedreamSizeTier, Record<string, string>> = {
  '1K': { '1:1': '1024x1024', '4:3': '1152x864', '16:9': '1424x800', '3:2': '1248x832', '21:9': '1568x672' },
  '1.5K': { '1:1': '1536x1536', '4:3': '1792x1344', '16:9': '2048x1152', '3:2': '1872x1248', '21:9': '2352x1008' },
  '2K': { '1:1': '2048x2048', '4:3': '2304x1728', '16:9': '2848x1600', '3:2': '2496x1664', '21:9': '3136x1344' },
  '3K': { '1:1': '3072x3072', '4:3': '3456x2592', '16:9': '4096x2304', '3:2': '3744x2496', '21:9': '4704x2016' },
  '4K': { '1:1': '4096x4096', '4:3': '4704x3520', '16:9': '5504x3040', '3:2': '4992x3328', '21:9': '6240x2656' },
}

export function calculateSeedreamSize(tier: SeedreamSizeTier, ratio: string, config: SeedreamSizeConfig) {
  const parsed = parseRatio(ratio)
  if (!parsed || !config.tiers.includes(tier)) return null
  const value = parsed.width / parsed.height
  if (value < 1 / 16 || value > 16) return null
  const landscape = Math.max(value, 1 / value)
  const preset = Object.entries(PRESETS[tier]).find(([key]) => {
    const [w, h] = key.split(':').map(Number)
    return Math.abs(w / h - landscape) < 0.000001
  })
  if (preset) {
    const size = config === PRO && tier === '2K'
      ? ({ '4:3': '2368x1776', '16:9': '2816x1584' }[preset[0]] ?? preset[1])
      : preset[1]
    return value < 1 ? size.split('x').reverse().join('x') : size
  }

  const pixels = (parseFloat(tier) * 1024) ** 2
  const width = Math.floor(Math.sqrt(pixels * value) / 16) * 16
  const height = Math.floor(Math.sqrt(pixels / value) / 16) * 16
  const size = `${width}x${height}`
  return getSeedreamSizeError(size, config) ? null : size
}
