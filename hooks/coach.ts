import type { ModelCompleteRequest, ModelEffort, PluginOptions } from 'claude-code'

import type { Category, Fix } from '../types'
import { SYSTEM, USER_TEMPLATE } from './prompt'

export type Explanations = 'popup' | 'inline' | 'off'

export type Settings = {
  targetLanguage: string
  nativeLanguage: string
  model: string
  effort: ModelEffort | undefined
  minLength: number
  maxLength: number
  explanations: Explanations
  isEnabled: boolean
  showsStatus: boolean
}

const CATEGORIES: readonly Category[] = ['typo', 'grammar', 'transfer', 'word-choice', 'phrasing']
const EFFORTS: readonly ModelEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const EXPLANATIONS: readonly Explanations[] = ['popup', 'inline', 'off']
const MAX_FIXES = 5
const REPLY_TOKENS = 600
const REPLY_TIMEOUT_MS = 30_000
const ENGINE_FRAMED = /^<(bash-input|bash-stdout|bash-stderr|command-name|command-message|local-command)/

const text = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback

const count = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback

export const settingsOf = (options: PluginOptions): Settings => ({
  targetLanguage: text(options.targetLanguage, 'English'),
  nativeLanguage: text(options.nativeLanguage, 'Brazilian Portuguese'),
  model: text(options.model, 'haiku'),
  effort: options.effort === undefined ? 'low' : EFFORTS.find(level => level === options.effort),
  minLength: count(options.minLength, 8),
  maxLength: count(options.maxLength, 2000),
  explanations: EXPLANATIONS.find(mode => mode === options.explanations) ?? 'popup',
  isEnabled: options.enabled !== false,
  showsStatus: options.statusLine === true,
})

// A prompt row's render id is its stored uuid with the last group zeroed, so the first four groups name the row.
const ROW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-/

export const rowIdOf = (id: string) => (ROW_ID.test(id) ? `row:${id.slice(0, 23)}` : undefined)

export const textKey = (prompt: string) => {
  let hash = 0x811c9dc5
  for (const char of prompt.trim().replace(/\s+/g, ' ')) {
    hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193)
  }

  return (hash >>> 0).toString(16)
}

export const isCoachable = (prompt: string, settings: Settings) =>
  prompt.length >= settings.minLength &&
  prompt.length <= settings.maxLength &&
  !prompt.startsWith('/') &&
  !prompt.startsWith('!') &&
  !ENGINE_FRAMED.test(prompt)

export const fill = (template: string, values: Readonly<Record<string, string>>) =>
  template.replace(/\{\{([A-Z_]+)\}\}/g, (placeholder, name: string) => values[name] ?? placeholder)

export const requestFor = (prompt: string, settings: Settings): ModelCompleteRequest => {
  const values = {
    PROMPT: prompt,
    TARGET_LANGUAGE: settings.targetLanguage,
    NATIVE_LANGUAGE: settings.nativeLanguage,
  }

  return {
    model: settings.model,
    ...(settings.effort !== undefined && { effort: settings.effort }),
    system: fill(SYSTEM, values),
    prompt: fill(USER_TEMPLATE, values),
    maxTokens: REPLY_TOKENS,
    timeoutMs: REPLY_TIMEOUT_MS,
  }
}

export const jsonObjects = (reply: string): unknown[] => {
  const objects: unknown[] = []
  let start = -1
  let depth = 0
  let isInString = false
  let isEscaped = false

  for (let at = 0; at < reply.length; at++) {
    const char = reply[at]

    if (isInString) {
      if (isEscaped) isEscaped = false
      else if (char === '\\') isEscaped = true
      else if (char === '"') isInString = false
      continue
    }

    if (char === '"' && depth > 0) isInString = true
    else if (char === '{' && depth++ === 0) start = at
    else if (char === '}' && depth > 0 && --depth === 0) {
      try {
        objects.push(JSON.parse(reply.slice(start, at + 1)))
      } catch {
        // A malformed object is skipped; a later one may still be the answer.
      }
    }
  }

  return objects
}

const hasFixes = (value: unknown): value is { fixes: unknown[] } =>
  typeof value === 'object' && value !== null && 'fixes' in value && Array.isArray(value.fixes)

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g
const LIMITS = { original: 200, fix: 200, reason: 160, explanation: 400 }

const clean = (value: unknown, limit: number) =>
  typeof value === 'string' ? value.replace(CONTROL, '').replace(/\s+/g, ' ').trim().slice(0, limit) : ''

const skeleton = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

const categoryOf = (value: unknown): Category =>
  CATEGORIES.find(category => category === value) ?? 'phrasing'

export const parseFixes = (reply: string, prompt: string): Fix[] | undefined => {
  const answer = jsonObjects(reply).filter(hasFixes).at(-1)
  if (answer === undefined) return undefined

  const lowered = prompt.toLowerCase()
  const taken: { from: number; to: number }[] = []
  const fixes: Fix[] = []

  for (const candidate of answer.fixes) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const fields = candidate as Record<string, unknown>
    const original = clean(fields.original, LIMITS.original)
    const replacement = clean(fields.fix, LIMITS.fix)
    if (original === '' || replacement === '') continue

    const isCosmetic = skeleton(original) === skeleton(replacement)
    const from = lowered.indexOf(original.toLowerCase())
    const to = from + original.length
    const overlaps = taken.some(span => from < span.to && span.from < to)
    if (isCosmetic || from === -1 || overlaps) continue

    taken.push({ from, to })
    const explanation = clean(fields.explanation, LIMITS.explanation)
    fixes.push({
      original,
      fix: replacement,
      reason: clean(fields.reason, LIMITS.reason),
      category: categoryOf(fields.category),
      ...(explanation !== '' && { explanation }),
    })
  }

  return fixes.slice(0, MAX_FIXES)
}
