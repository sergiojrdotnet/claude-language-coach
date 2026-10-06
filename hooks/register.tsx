import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderChildren, RenderSurface, RenderViewport } from 'claude-code'

import type { Entry, Fix } from '../types'
import { isCoachable, parseFixes, requestFor, rowIdOf, settingsOf, textKey } from './coach'
import type { Explanations, Settings } from './coach'
import {
  appendEntry,
  asDaily,
  asEntries,
  asRemembered,
  dayKey,
  nextStreak,
  recordReview,
  forget,
  remember,
  rememberedByKey,
  statusText,
  summarize,
} from './history'
import { glyphsOf, rasterCells, trendOf, trendSummary, trendSvg } from './trend'
import { linesWhenWrapped } from './wrap'

const PANE = 'language-coach'
const HISTORY_KEY = 'history'
const DAILY_KEY = 'daily'
const STREAK_KEY = 'streak'
const REMEMBERED_KEY = 'remembered'
const RECENT_FIXES = 15
const OWN_WORDS = new Set(['composer', 'bridge'])

const coaching = { plugin: 'language-coach', key: 'coaching' } as const
const history = atom({ plugin: 'language-coach', key: 'history' } as const, [])
const daily = atom({ plugin: 'language-coach', key: 'daily' } as const, {})
const remembered = atom({ plugin: 'language-coach', key: 'remembered' } as const, {})
const streak = atom({ plugin: 'language-coach', key: 'streak' } as const, 0)
const isPaused = atom({ plugin: 'language-coach', key: 'isPaused' } as const, false)

type Table = { Box: Elements['terminal']['Box']; Text: Elements['terminal']['Text'] }

type Layout = { explanations: Explanations; cardWidth: number }

const countOf = (stored: unknown) => (typeof stored === 'number' && Number.isFinite(stored) ? stored : 0)

const layoutOf = (surface: RenderSurface, viewport: RenderViewport | undefined, columns: number, explanations: Explanations): Layout => {
  const canHover = surface === 'desktop' || (surface === 'terminal' && viewport?.isFullscreen === true)

  return {
    explanations: explanations === 'popup' && !canHover ? 'inline' : explanations,
    cardWidth: Math.max(24, Math.min(72, columns - 6)),
  }
}

const explanationOf = (fix: Fix, layout: Layout) =>
  layout.explanations !== 'off' && fix.explanation !== undefined && fix.explanation !== fix.reason ? fix.explanation : undefined

const fixRow = ({ Box, Text }: Table, fix: Fix, key: string, layout: Layout, lead: RenderChildren, tag: string) => {
  const explanation = explanationOf(fix, layout)
  const cardRows = explanation === undefined ? 0 : linesWhenWrapped(explanation, layout.cardWidth - 4) + 2

  return (
    <Box key={key} flexDirection="column">
      <Text wrap="wrap">
        {lead}
        <Text color="error">{fix.original}</Text>
        <Text dimColor>{' → '}</Text>
        <Text color="success" bold>
          {fix.fix}
        </Text>
        <Text dimColor>{tag}</Text>
      </Text>
      {explanation !== undefined && layout.explanations === 'inline' && (
        <Text dimColor italic wrap="wrap">
          {`  ↳ ${explanation}`}
        </Text>
      )}
      {explanation !== undefined && layout.explanations === 'popup' && (
        <Box
          position="absolute"
          top={-cardRows}
          left={2}
          width={layout.cardWidth}
          height={cardRows}
          overflow="hidden"
          display="none"
          hover={{ display: 'flex' }}
          borderStyle="round"
          borderColor="suggestion"
          backgroundColor="userMessageBackground"
        >
          <Box paddingX={1} flexGrow={1}>
            <Text wrap="wrap">{explanation}</Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}

const tagOf = (fix: Fix) => `  ${fix.category}${fix.reason === '' ? '' : ` · ${fix.reason}`}`

async function showStatus($: EngineInterface, settings: Settings) {
  if (!settings.showsStatus || !settings.isEnabled) {
    $.ui.status(undefined)
    return
  }
  if (await read($, isPaused)) {
    $.ui.status('✎ coach paused')
    return
  }

  const days = await read($, daily)
  $.ui.status(statusText(days[dayKey(await $.clock.now())], await read($, streak)))
}

async function coach($: EngineInterface, settings: Settings, prompt: string, key: string) {
  const reply = await $.model.complete(requestFor(prompt, settings))
  if (!reply.isAnswered) {
    $.ui.log(`language-coach: no review (${reply.reason})`, { to: 'debug' })
    return
  }

  const fixes = parseFixes(reply.text, prompt)
  if (fixes === undefined) {
    $.ui.log('language-coach: the review was not the JSON the coach asked for', { to: 'debug' })
    return
  }

  const now = await $.clock.now()
  const days = recordReview(asDaily(await $.store.get(DAILY_KEY)), dayKey(now), fixes.length)
  const run = nextStreak(countOf(await $.store.get(STREAK_KEY)), fixes.length)
  await $.store.set(DAILY_KEY, days)
  await $.store.set(STREAK_KEY, run)
  await update($, daily, () => days)
  await update($, streak, () => run)

  const rows = asRemembered(await $.store.get(REMEMBERED_KEY))
  await $.store.set(REMEMBERED_KEY, fixes.length > 0 ? remember(rows, key, fixes) : forget(rows, key))

  if (fixes.length > 0) {
    await $.state.set({ ...coaching, id: key }, { fixes })

    const entry: Entry = { at: now, language: settings.targetLanguage, fixes }
    const entries = appendEntry(asEntries(await $.store.get(HISTORY_KEY)), entry)
    await $.store.set(HISTORY_KEY, entries)
    await update($, history, () => entries)
  }

  await showStatus($, settings)
}

async function fixesFor($: EngineInterface, keys: readonly string[]) {
  for (const key of keys) {
    const live = await read($, { ...coaching, id: key })
    if (live !== undefined) return live.fixes
  }

  const rows = await read($, remembered)

  return keys.map(key => rows[key]).find(fixes => fixes !== undefined) ?? []
}

export const register: Register = (on, options) => {
  const settings = settingsOf(options)
  const appendedRows = new Map<string, string>()

  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    const stored = await next(e)
    const row = rowIdOf(e.uuid)
    const text = e.message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('\n').trim()
    if (row !== undefined && e.agentId === undefined && OWN_WORDS.has(e.origin.kind)) appendedRows.set(textKey(text), row)

    return stored
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'language-coach',
      description: `Your ${settings.targetLanguage} coaching history; /language-coach off or on pauses or resumes it`,
      argumentHint: '[on|off]',
      immediate: true,
    })

    const entries = asEntries(await $.store.get(HISTORY_KEY))
    const days = asDaily(await $.store.get(DAILY_KEY))
    const run = countOf(await $.store.get(STREAK_KEY))
    const rows = rememberedByKey(asRemembered(await $.store.get(REMEMBERED_KEY)))
    await update($, history, () => entries)
    await update($, daily, () => days)
    await update($, streak, () => run)
    await update($, remembered, () => rows)
    await showStatus($, settings)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const entered = await next(e)
    if (!settings.isEnabled || entered.drop !== undefined || !OWN_WORDS.has(e.origin.kind)) return entered

    const prompt = entered.text.trim()
    if (!isCoachable(prompt, settings) || (await read($, isPaused))) return entered

    const text = textKey(prompt)
    const key = appendedRows.get(text) ?? text
    appendedRows.delete(text)
    // Fixes remembered from an earlier review of the same text must not stand in for the new one.
    await $.state.set({ ...coaching, id: key }, { fixes: [] })
    // A timer runs the review in a dispatch of its own, so interrupting the turn does not abort it.
    $.clock.after(0, () => void coach($, settings, prompt, key))

    return entered
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.requestId === 'placeholder') return drawn

    const keys = [rowIdOf(e.requestId), textKey(e.props.text)].filter((key): key is string => key !== undefined)
    const fixes = await fixesFor($, keys)
    if (fixes.length === 0) return drawn

    const { Box, Text } = $.ui.resolve(e)
    const layout = layoutOf(e.surface, e.viewport, e.viewport?.columns ?? 80, settings.explanations)
    const lead = (
      <Text dimColor hover={{ color: 'suggestion', dimColor: false }}>
        {'✎ '}
      </Text>
    )

    return (
      <Box flexDirection="column">
        {drawn}
        <Box flexDirection="column" paddingLeft={2}>
          {fixes.map((fix, index) => fixRow({ Box, Text }, fix, `fix-${index}`, layout, lead, tagOf(fix)))}
        </Box>
      </Box>
    )
  })

  on('command.run', { command: 'language-coach' }, async ($, e) => {
    const verb = e.args.trim().toLowerCase()
    if (verb === 'off' || verb === 'on') {
      await update($, isPaused, () => verb === 'off')
      await showStatus($, settings)
      $.ui.toast(verb === 'off' ? 'Coaching paused for this session.' : 'Coaching resumed.')

      return {}
    }

    await $.ui.open({ id: PANE, title: `${settings.targetLanguage} coach` })

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const entries = await read($, history)
    const paused = await read($, isPaused)
    const bars = trendOf(await read($, daily), await $.clock.now())
    const hasTrend = bars.some(bar => bar.rate !== undefined)
    const summary = summarize(entries)
    const recent = entries.flatMap(entry => entry.fixes).slice(-RECENT_FIXES).reverse()
    const state = !settings.isEnabled ? 'off in /config' : paused ? 'paused' : 'on'
    const layout = layoutOf(e.surface, e.viewport, e.props.bodyColumns, settings.explanations)

    const chart = () => {
      if (e.surface === 'terminal') {
        const { Raster } = $.ui.resolve(e)

        return <Raster key="trend" columns={bars.length} rows={1} cells={rasterCells(bars)} />
      }
      if (e.surface === 'desktop') {
        const { Svg } = $.ui.resolve(e)

        return <Svg source={trendSvg(bars)} alt={trendSummary(bars)} isInteractive />
      }

      return (
        <Text>
          {glyphsOf(bars).map(({ glyph, color }) => (
            <Text color={color}>{glyph}</Text>
          ))}
        </Text>
      )
    }

    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>{settings.targetLanguage} coach</Text>
          <Text dimColor>
            {' · '}
            {state} · {summary.corrections} corrections across {summary.prompts} prompts
          </Text>
        </Text>
        {summary.byCategory.length > 0 && (
          <Text dimColor wrap="wrap">
            {summary.byCategory.map(({ category, count }) => `${category} ${count}`).join(' · ')}
          </Text>
        )}
        {hasTrend && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Trend</Text>
            {chart()}
            <Text dimColor wrap="wrap">
              {trendSummary(bars)}
            </Text>
          </Box>
        )}
        {summary.corrections === 0 && (
          <Box marginTop={1}>
            <Text dimColor wrap="wrap">
              No corrections yet. Fixes show up under each prompt you write in {settings.targetLanguage}.
            </Text>
          </Box>
        )}
        {summary.recurring.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Recurring</Text>
            {summary.recurring.map((pair, index) =>
              fixRow(
                { Box, Text },
                { original: pair.original, fix: pair.fix, reason: '', category: 'phrasing', ...(pair.explanation !== undefined && { explanation: pair.explanation }) },
                `recurring-${index}`,
                layout,
                <Text dimColor>{`${pair.count}× `}</Text>,
                '',
              ),
            )}
          </Box>
        )}
        {recent.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Recent</Text>
            {recent.map((fix, index) => fixRow({ Box, Text }, fix, `recent-${index}`, layout, '', tagOf(fix)))}
          </Box>
        )}
        <Box marginTop={1} gap={1}>
          <Button
            key="pause"
            label={paused ? 'Resume' : 'Pause'}
            onPress={async () => {
              await update($, isPaused, value => !value)
              await showStatus($, settings)
            }}
          />
          <Button
            key="clear"
            label="Clear history"
            onPress={async () => {
              await Promise.all([HISTORY_KEY, REMEMBERED_KEY].map(key => $.store.set(key, [])))
              await $.store.set(DAILY_KEY, {})
              await $.store.set(STREAK_KEY, 0)
              await update($, history, () => [])
              await update($, remembered, () => ({}))
              await update($, daily, () => ({}))
              await update($, streak, () => 0)
              await showStatus($, settings)
            }}
          />
        </Box>
      </Box>
    )
  })
}
