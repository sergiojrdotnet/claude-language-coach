import type { Daily } from '../types'
import { lastDays } from './history'

export const TREND_DAYS = 30

export type TrendBar = { day: string; prompts: number; rate: number | undefined }

const LEVELS = '▁▂▃▄▅▆▇█'
const NO_PROMPTS = '·'
const DEFAULT_COLOR = 0x01000000
const GOOD = 0x3fb950
const FAIR = 0xd29922
const POOR = 0xf85149
const EMPTY = 0x8b949e

export const trendOf = (daily: Daily, now: number): TrendBar[] =>
  lastDays(now, TREND_DAYS).map(day => {
    const stats = daily[day]

    return { day, prompts: stats?.prompts ?? 0, rate: stats && stats.prompts > 0 ? stats.fixes / stats.prompts : undefined }
  })

const colorOf = (rate: number | undefined) =>
  rate === undefined ? EMPTY : rate < 0.25 ? GOOD : rate < 0.75 ? FAIR : POOR

export const hexOf = (rate: number | undefined) => `#${colorOf(rate).toString(16).padStart(6, '0')}`

const scaleOf = (bars: readonly TrendBar[]) => Math.max(1, ...bars.map(bar => bar.rate ?? 0))

export const glyphOf = (rate: number | undefined, scale: number) => {
  if (rate === undefined) return NO_PROMPTS
  const level = rate === 0 ? 0 : Math.min(LEVELS.length - 1, Math.max(1, Math.ceil((rate / scale) * (LEVELS.length - 1))))

  return LEVELS[level]!
}

export const glyphsOf = (bars: readonly TrendBar[]) => {
  const scale = scaleOf(bars)

  return bars.map(bar => ({ glyph: glyphOf(bar.rate, scale), color: hexOf(bar.rate) }))
}

export const rasterCells = (bars: readonly TrendBar[]) => {
  const scale = scaleOf(bars)
  const words = new Uint32Array(bars.length * 3)

  bars.forEach((bar, index) => {
    words[index * 3] = glyphOf(bar.rate, scale).codePointAt(0)!
    words[index * 3 + 1] = colorOf(bar.rate)
    words[index * 3 + 2] = DEFAULT_COLOR
  })

  return (new Uint8Array(words.buffer) as Uint8Array & { toBase64: () => string }).toBase64()
}

export const trendSvg = (bars: readonly TrendBar[]) => {
  const scale = scaleOf(bars)
  const width = 10
  const height = 40
  const shapes = bars.map((bar, index) => {
    const x = index * width + 1
    const tip = `${bar.day}: ${bar.rate === undefined ? 'no prompts' : `${bar.rate.toFixed(2)} fixes per prompt (${bar.prompts} prompts)`}`
    if (bar.rate === undefined) {
      return `<circle cx="${x + 4}" cy="${height - 2}" r="1.5" fill="${hexOf(undefined)}"><title>${tip}</title></circle>`
    }
    const barHeight = Math.max(2, Math.round((bar.rate / scale) * (height - 4)))

    return `<rect x="${x}" y="${height - barHeight}" width="${width - 2}" height="${barHeight}" rx="1.5" fill="${hexOf(bar.rate)}"><title>${tip}</title></rect>`
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bars.length * width} ${height}" width="${bars.length * width}" height="${height}">${shapes.join('')}</svg>`
}

export const trendSummary = (bars: readonly TrendBar[]) => {
  const active = bars.filter(bar => bar.rate !== undefined)
  const prompts = active.reduce((sum, bar) => sum + bar.prompts, 0)
  const average = prompts === 0 ? 0 : active.reduce((sum, bar) => sum + (bar.rate ?? 0) * bar.prompts, 0) / prompts

  return `fixes per prompt, last ${bars.length} days · average ${average.toFixed(2)} over ${prompts} prompts`
}
