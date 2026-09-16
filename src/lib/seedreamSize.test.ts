import { describe, expect, it } from 'vitest'
import { calculateSeedreamSize, getSeedreamSizeConfig, getSeedreamSizeError, normalizeSeedreamSize } from './seedreamSize'

const pro = getSeedreamSizeConfig('doubao-seedream-5-0-pro-260628')!
const lite = getSeedreamSizeConfig('doubao-seedream-5-0-260128')!

describe('Seedream image sizes', () => {
  it('selects model-specific resolution tiers', () => {
    expect(pro.tiers).toEqual(['1K', '1.5K', '2K'])
    expect(lite.tiers).toEqual(['2K', '3K', '4K'])
    expect(getSeedreamSizeConfig('doubao-seedream-4-5-251128')?.tiers).toEqual(['2K', '4K'])
    expect(getSeedreamSizeConfig('doubao-seedream-4-0-250828')?.tiers).toEqual(['1K', '2K', '4K'])
    expect(getSeedreamSizeConfig('doubao-seedream-5-0-lite')?.tiers).toEqual(lite.tiers)
    expect(getSeedreamSizeConfig('gpt-image-2')).toBeNull()
    expect(getSeedreamSizeConfig('ep-custom-endpoint')).toBeNull()
  })

  it.each(['auto', ' AUTO ', ''])('converts %j to intelligent 2K', (size) => {
    expect(normalizeSeedreamSize(size)).toBe('2K')
  })

  it('normalizes syntax without resizing exact dimensions', () => {
    expect(normalizeSeedreamSize(' 1.5k ')).toBe('1.5K')
    expect(normalizeSeedreamSize(' 3750 × 1250 ')).toBe('3750x1250')
  })

  it('validates each model without substituting unsupported selections', () => {
    expect(getSeedreamSizeError('1.5K', pro)).toBeNull()
    expect(getSeedreamSizeError('4K', pro)).toContain('1K、1.5K、2K')
    expect(getSeedreamSizeError('1K', lite)).toContain('2K、3K、4K')
    expect(getSeedreamSizeError('1024x1024', pro)).toBeNull()
    expect(getSeedreamSizeError('1024x1024', lite)).toContain('3686400')
    expect(getSeedreamSizeError('4096x4096', pro)).toContain('4624220')
    expect(getSeedreamSizeError('4096x4096', lite)).toBeNull()
    expect(getSeedreamSizeError('3750x1250', lite)).toBeNull()
    expect(getSeedreamSizeError('8192x512', lite)).toBeNull()
    expect(getSeedreamSizeError('8193x512', lite)).toContain('1:16')
    expect(getSeedreamSizeError('0x1024', lite)).toContain('正整数')
    expect(getSeedreamSizeError('NaNx1024', lite)).not.toBeNull()
  })

  it('uses the documented sizes for Pro and Lite', () => {
    expect(calculateSeedreamSize('1.5K', '16:9', pro)).toBe('2048x1152')
    expect(calculateSeedreamSize('2K', '16:9', pro)).toBe('2816x1584')
    expect(calculateSeedreamSize('2K', '3:4', pro)).toBe('1776x2368')
    expect(calculateSeedreamSize('2K', '16:9', lite)).toBe('2848x1600')
    expect(calculateSeedreamSize('3K', '9:16', lite)).toBe('2304x4096')
    expect(calculateSeedreamSize('4K', '21:9', lite)).toBe('6240x2656')
    expect(calculateSeedreamSize('2K', '32:18', lite)).toBe('2848x1600')
  })

  it.each([pro, lite])('keeps every preset and custom ratio within model limits', (config) => {
    for (const tier of config.tiers) {
      for (const ratio of ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', '21:9', '5:4', '16:1', '1:16']) {
        const size = calculateSeedreamSize(tier, ratio, config)
        expect(size, `${tier} ${ratio}`).not.toBeNull()
        expect(getSeedreamSizeError(size!, config), `${tier} ${ratio}`).toBeNull()
      }
    }
  })

  it('rejects invalid ratios and unsupported tiers', () => {
    expect(calculateSeedreamSize('4K', '1:1', pro)).toBeNull()
    expect(calculateSeedreamSize('2K', '17:1', lite)).toBeNull()
    expect(calculateSeedreamSize('2K', '0:1', lite)).toBeNull()
  })
})
