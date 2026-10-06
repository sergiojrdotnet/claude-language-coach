import type { Category, Daily, Day, Entry, Fix, Remembered } from '../types'

export const HISTORY_LIMIT = 500

// $.store holds at most 4 MiB of JSON for the whole plugin; history and the cache each get well under half.
export const BYTE_BUDGET = 1_500_000

export const withinBudget = <T>(rows: readonly T[], budget = BYTE_BUDGET): T[] => {
  const sizes = rows.map(row => JSON.stringify(row).length + 1)
  let total = sizes.reduce((sum, size) => sum + size, 2)
  let first = 0
  while (total > budget && first < rows.length) total -= sizes[first++]!

  return rows.slice(first)
}

export type Recurring = { original: string; fix: string; count: number; explanation?: string }

export type Summary = {
  prompts: number
  corrections: number
  byCategory: { category: Category; count: number }[]
  recurring: Recurring[]
}

export const appendEntry = (entries: readonly Entry[], entry: Entry) =>
  withinBudget([...entries, entry].slice(-HISTORY_LIMIT))

export const asEntries = (stored: unknown): Entry[] =>
  Array.isArray(stored) ? stored.filter((entry): entry is Entry => Array.isArray(entry?.fixes)) : []

export const summarize = (entries: readonly Entry[], recurringLimit = 8): Summary => {
  const byCategory = new Map<Category, number>()
  const pairs = new Map<string, Recurring>()
  let corrections = 0

  for (const entry of entries) {
    for (const fix of entry.fixes) {
      corrections++
      byCategory.set(fix.category, (byCategory.get(fix.category) ?? 0) + 1)

      const key = `${fix.original.toLowerCase()}\u0000${fix.fix.toLowerCase()}`
      const pair = pairs.get(key)
      if (pair) pair.count++
      else pairs.set(key, { original: fix.original, fix: fix.fix, count: 1 })
      if (fix.explanation !== undefined) pairs.get(key)!.explanation = fix.explanation
    }
  }

  return {
    prompts: entries.length,
    corrections,
    byCategory: [...byCategory].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    recurring: [...pairs.values()]
      .filter(pair => pair.count > 1)
      .sort((a, b) => b.count - a.count)
      .slice(0, recurringLimit),
  }
}

const DAY_MS = 86_400_000
const DAILY_LIMIT = 90

const pad = (value: number) => String(value).padStart(2, '0')

export const dayKey = (at: number) => {
  const date = new Date(at)

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const lastDays = (now: number, count: number) =>
  Array.from({ length: count }, (_, index) => dayKey(now - (count - 1 - index) * DAY_MS))

export const asDaily = (stored: unknown): Daily => {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {}

  return Object.fromEntries(
    Object.entries(stored).filter(
      (entry): entry is [string, Day] => typeof entry[1]?.prompts === 'number' && typeof entry[1]?.fixes === 'number',
    ),
  )
}

export const recordReview = (daily: Daily, day: string, fixes: number): Daily => {
  const today = daily[day] ?? { prompts: 0, fixes: 0 }
  const updated = { ...daily, [day]: { prompts: today.prompts + 1, fixes: today.fixes + fixes } }
  const kept = Object.keys(updated).sort().slice(-DAILY_LIMIT)

  return Object.fromEntries(kept.map(key => [key, updated[key]!]))
}

export const nextStreak = (streak: number, fixes: number) => (fixes === 0 ? streak + 1 : 0)

export type CoachState = 'on' | 'paused' | 'off'

export const statusText = (state: CoachState, today: Day | undefined, streak: number) => {
  if (state === 'off') return undefined
  if (state === 'paused') return '✎ coach paused'

  const fixes = today?.fixes ?? 0

  return `✎ ${fixes} ${fixes === 1 ? 'fix' : 'fixes'} today · ${streak} clean in a row`
}

const REMEMBERED_LIMIT = 300

export const asRemembered = (stored: unknown): Remembered[] =>
  Array.isArray(stored)
    ? stored.filter((row): row is Remembered => typeof row?.key === 'string' && Array.isArray(row?.fixes))
    : []

export const remember = (rows: readonly Remembered[], key: string, fixes: Fix[]) =>
  withinBudget([...rows.filter(row => row.key !== key), { key, fixes }].slice(-REMEMBERED_LIMIT))

export const forget = (rows: readonly Remembered[], key: string) => rows.filter(row => row.key !== key)

export const rememberedByKey = (rows: readonly Remembered[]): Record<string, Fix[]> =>
  Object.fromEntries(rows.map(row => [row.key, row.fixes]))
