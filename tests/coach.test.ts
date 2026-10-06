import { describe, expect, test } from 'claude-code/testing'

import { fill, isCoachable, jsonObjects, parseFixes, requestFor, rowIdOf, settingsOf } from '../hooks/coach'
import { appendEntry, BYTE_BUDGET, dayKey, nextStreak, recordReview, statusText, summarize, withinBudget } from '../hooks/history'
import { glyphsOf, rasterCells, TREND_DAYS, trendOf, trendSummary, trendSvg } from '../hooks/trend'
import { linesWhenWrapped } from '../hooks/wrap'
import type { Entry } from '../types'

const SETTINGS = settingsOf({})
const reply_ = (fixes: object[]) => JSON.stringify({ fixes })

describe('reading the review', () => {
  test('takes the first JSON object and ignores the prose after it', () => {
    const reply = '```json\n{"fixes":[{"original":"taught","fix":"thought","reason":"past of think","category":"typo"}]}\n```\nThe rest is clean.'

    expect(parseFixes(reply, 'I taught we were done')).toEqual([
      { original: 'taught', fix: 'thought', reason: 'past of think', category: 'typo' },
    ])
  })

  test('braces and quotes inside strings do not end the object early', () => {
    expect(jsonObjects('{"a":"} \\" {","b":1} tail')).toEqual([{ a: '} " {', b: 1 }])
  })

  test('drops fixes whose original is not in the prompt, no-op fixes and duplicates', () => {
    const reply = JSON.stringify({
      fixes: [
        { original: 'invented words', fix: 'x', reason: '', category: 'typo' },
        { original: 'same', fix: 'same', reason: '', category: 'typo' },
        { original: 'a easy', fix: 'an easy', reason: 'article before a vowel sound', category: 'grammar' },
        { original: 'a easy', fix: 'an easy', reason: 'again', category: 'grammar' },
      ],
    })

    expect(parseFixes(reply, 'it is a easy and the same fix')).toEqual([
      { original: 'a easy', fix: 'an easy', reason: 'article before a vowel sound', category: 'grammar' },
    ])
  })

  test('keeps five fixes at most and files an unknown category as phrasing', () => {
    const prompt = 'aa bb cc dd ee ff'
    const fixes = prompt.split(' ').map(word => ({ original: word, fix: `${word}x`, reason: 'r', category: 'style' }))
    const parsed = parseFixes(JSON.stringify({ fixes }), prompt)

    expect(parsed?.length).toBe(5)
    expect(parsed?.[0]?.category).toBe('phrasing')
  })

  test('a reply with no fixes array is unreadable, an empty array is a clean prompt', () => {
    expect(parseFixes('Looks good to me!', 'hello there')).toBeUndefined()
    expect(parseFixes('{"fixes":[]}', 'hello there')).toEqual([])
  })
})

describe('hardening against what Haiku actually did in the evaluation', () => {
  const fix = (original: string, to: string, extra: object = {}) => ({ original, fix: to, reason: 'r', category: 'grammar', ...extra })

  test('a self-correction after the first object wins: the last object with fixes is the answer', () => {
    const reply = `${reply_([fix('"Ready"', '"ready"')])}\nWait, I need to reconsider: quoted text is out of scope.\n${reply_([])}`

    expect(parseFixes(reply, 'Set the status to "Ready" now')).toEqual([])
  })

  test('a malformed first object does not hide a valid later one', () => {
    const reply = `{"fixes":[{"original":"a easy","fix":"an easy" "x"}]}\n${reply_([fix('a easy', 'an easy')])}`

    expect(parseFixes(reply, 'it is a easy one')?.map(f => f.fix)).toEqual(['an easy'])
  })

  test('case-only and punctuation-only changes are dropped, as the policy says', () => {
    const prompt = 'ok. are the claude settings done'
    const reply = reply_([fix('ok. are', 'OK. Are'), fix('claude', 'Claude'), fix('settings done', 'settings, done')])

    expect(parseFixes(reply, prompt)).toEqual([])
  })

  test('overlapping spans keep only the first fix', () => {
    const prompt = 'Does it changes the person presence?'
    const reply = reply_([fix('Does it changes', 'Does it change'), fix('it changes the', 'it change the'), fix('person presence', "person's presence")])

    expect(parseFixes(reply, prompt)?.map(f => f.original)).toEqual(['Does it changes', 'person presence'])
  })

  test('control characters and runaway lengths never reach the UI', () => {
    const reply = reply_([fix('taught', 'thought', { reason: 'past\u001b[31m tense', explanation: 'x'.repeat(1000) })])
    const [parsed] = parseFixes(reply, 'I taught so') ?? []

    expect(parsed?.reason).toBe('past[31m tense')
    expect(parsed?.explanation?.length).toBe(400)
  })

  test('a missing category is filed as phrasing instead of dropping the fix', () => {
    const reply = JSON.stringify({ fixes: [{ original: 'taught', fix: 'thought', reason: 'r' }] })

    expect(parseFixes(reply, 'I taught so')?.[0]?.category).toBe('phrasing')
  })
})

describe('asking for the review', () => {
  test('fills the languages and the prompt in one pass, so a prompt naming a placeholder stays as typed', () => {
    expect(fill('{{TARGET_LANGUAGE}} / {{PROMPT}}', { TARGET_LANGUAGE: 'German', PROMPT: 'say {{TARGET_LANGUAGE}}' })).toBe(
      'German / say {{TARGET_LANGUAGE}}',
    )
  })

  test('the request names the configured model and languages and carries the prompt verbatim', () => {
    const settings = settingsOf({ model: 'sonnet', targetLanguage: 'Spanish', nativeLanguage: 'English' })
    const request = requestFor('Yo soy muy embarazada', settings)

    expect(request.model).toBe('sonnet')
    expect(`${request.system}\n${request.prompt}`).toContain('Spanish')
    expect(`${request.system}\n${request.prompt}`).toContain('English')
    expect(request.prompt).toContain('Yo soy muy embarazada')
    expect(`${request.system}${request.prompt}`).not.toContain('{{')
  })
})

describe('effort', () => {
  test('defaults to low, passes a chosen level through, and sends none for the model default', () => {
    expect(requestFor('Can you check it?', settingsOf({})).effort).toBe('low')
    expect(requestFor('Can you check it?', settingsOf({ model: 'opus', effort: 'high' })).effort).toBe('high')
    expect('effort' in requestFor('Can you check it?', settingsOf({ effort: 'model default' }))).toBe(false)
  })
})

describe('explanations', () => {
  test('default to popup, take a listed mode, and fall back to popup for anything else', () => {
    expect(settingsOf({}).explanations).toBe('popup')
    expect(settingsOf({ explanations: 'inline' }).explanations).toBe('inline')
    expect(settingsOf({ explanations: 'off' }).explanations).toBe('off')
    expect(settingsOf({ explanations: 'tooltip' }).explanations).toBe('popup')
  })
})

describe('what gets coached', () => {
  test('skips commands, shell input, framed engine rows and prompts outside the length bounds', () => {
    expect(isCoachable('Can you check the deploy logs?', SETTINGS)).toBe(true)
    expect(isCoachable('/coach off', SETTINGS)).toBe(false)
    expect(isCoachable('! ls -la', SETTINGS)).toBe(false)
    expect(isCoachable('<bash-input>ls</bash-input>', SETTINGS)).toBe(false)
    expect(isCoachable('ok', SETTINGS)).toBe(false)
    expect(isCoachable('x'.repeat(2001), SETTINGS)).toBe(false)
  })
})

describe('history', () => {
  test('counts corrections by category and surfaces repeated mistakes', () => {
    const fix = (original: string, to: string, category: Entry['fixes'][number]['category']) => ({ original, fix: to, reason: '', category })
    const entries: Entry[] = [
      { at: 1, language: 'English', fixes: [fix('taught', 'thought', 'typo'), fix('a easy', 'an easy', 'grammar')] },
      { at: 2, language: 'English', fixes: [fix('Taught', 'thought', 'typo')] },
      { at: 3, language: 'English', fixes: [fix('explain me', 'explain to me', 'transfer')] },
    ]
    const summary = summarize(entries)

    expect(summary.prompts).toBe(3)
    expect(summary.corrections).toBe(4)
    expect(summary.byCategory[0]).toEqual({ category: 'typo', count: 2 })
    expect(summary.recurring).toEqual([{ original: 'taught', fix: 'thought', count: 2 }])
  })
})

describe('daily stats, streak and trend', () => {
  test('a review adds to its day, and the streak counts clean reviews in a row', () => {
    let daily = recordReview({}, '2026-10-06', 2)
    daily = recordReview(daily, '2026-10-06', 0)

    expect(daily['2026-10-06']).toEqual({ prompts: 2, fixes: 2 })
    expect(nextStreak(nextStreak(0, 0), 0)).toBe(2)
    expect(nextStreak(5, 1)).toBe(0)
    expect(statusText(daily['2026-10-06'], 2)).toBe('✎ 2 fixes today · 2 clean in a row')
    expect(statusText({ prompts: 1, fixes: 1 }, 0)).toBe('✎ 1 fix today · 0 clean in a row')
  })

  test('the trend covers the last 30 days, a dot where nothing was reviewed', () => {
    const now = new Date(2026, 9, 6, 12).getTime()
    const bars = trendOf({ [dayKey(now)]: { prompts: 4, fixes: 2 } }, now)

    expect(bars.length).toBe(TREND_DAYS)
    expect(bars.at(-1)).toEqual({ day: dayKey(now), prompts: 4, rate: 0.5 })
    expect(glyphsOf(bars)[0]?.glyph).toBe('·')
    expect(trendSvg(bars)).toContain('<title>')
    expect(trendSummary(bars)).toContain('average 0.50 over 4 prompts')
  })

  test('the raster holds one cell per day', () => {
    const now = new Date(2026, 9, 6, 12).getTime()
    const cells = rasterCells(trendOf({}, now))
    const bytes = (Uint8Array as unknown as { fromBase64: (text: string) => Uint8Array }).fromBase64(cells)

    expect(bytes.length).toBe(TREND_DAYS * 3 * 4)
  })

  test('the hover card is sized by how its explanation wraps', () => {
    expect(linesWhenWrapped('short', 20)).toBe(1)
    expect(linesWhenWrapped('one two three four five', 9)).toBe(3)
    expect(linesWhenWrapped('x'.repeat(25), 10)).toBe(3)
  })
})

describe('storage stays inside the 4 MiB store', () => {
  test('history and the cache drop their oldest rows once past the byte budget', () => {
    const big = 'x'.repeat(1000)
    const fix = { original: big.slice(0, 200), fix: big.slice(0, 200), reason: big.slice(0, 160), category: 'typo' as const, explanation: big.slice(0, 400) }
    let entries: Entry[] = []
    for (let at = 0; at < 500; at++) entries = appendEntry(entries, { at, language: 'English', fixes: [fix, fix, fix, fix, fix] })

    expect(JSON.stringify(entries).length).toBeLessThanOrEqual(BYTE_BUDGET)
    expect(entries.at(-1)?.at).toBe(499)
    expect(withinBudget([1, 2, 3], 6)).toEqual([2, 3])
  })
})

describe('row identity', () => {
  test('the stored uuid and the render id of the same prompt row map to one key', () => {
    expect(rowIdOf('5b6df2c7-929a-484a-a28f-c83b79a23ddc')).toBe(rowIdOf('5b6df2c7-929a-484a-a28f-000000000000'))
    expect(rowIdOf('placeholder')).toBeUndefined()
    expect(rowIdOf('row')).toBeUndefined()
  })
})
