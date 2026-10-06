import { describe, expect, mock, test } from 'claude-code/testing'

import { rowKey } from '../hooks/coach'

import { coachCommand, elementsOf, ENGINE_ROW, PANE_PROPS, reply, SESSION, textOf, typed, userRow, worldOf } from './world'

const PLUGIN = 'language-coach'
const SURFACES = ['terminal', 'desktop'] as const
const TAUGHT = reply([{ original: 'taught', fix: 'thought', reason: 'past tense of think', category: 'typo' }])

const settle = async (clock: { advance: (ms: number) => Promise<void>; settle: () => Promise<void> }) => {
  await clock.advance(0)
  await clock.settle()
}

describe('coaching a prompt', () => {
  test('a typed prompt is reviewed out of band and its fixes draw under it on every surface', async ($, on) => {
    const world = worldOf(on, [TAUGHT])
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.prompt.submit(typed('I taught we were moving them'))
    await settle(clock)

    expect(world.requests.length).toBe(1)
    expect(world.requests[0]?.model).toBe('haiku')
    expect(world.requests[0]?.prompt).toContain('I taught we were moving them')

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'UserMessage', requestId: 'row', props: userRow('I taught we were moving them', surface).props })
      const drawn = textOf(await ui.drawn())

      expect(drawn).toContain('the prompt as the engine draws it')
      expect(drawn).toContain('taught → thought')
      expect(drawn).toContain('past tense of think')
      await ui.unmount()
    }

    expect(await $.ui.render(userRow('A different prompt'))).toEqual(ENGINE_ROW)
  })

  test('a clean review leaves the engine row exactly as drawn', async ($, on) => {
    const world = worldOf(on, [reply([])])
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.prompt.submit(typed('Can we convert it to a minimal API?'))
    await settle(clock)

    expect(world.requests.length).toBe(1)
    expect(await $.ui.render(userRow('Can we convert it to a minimal API?'))).toEqual(ENGINE_ROW)
  })

  test('a failed review draws nothing extra and says why in the debug log', async ($, on) => {
    const world = worldOf(on, [])
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.prompt.submit(typed('I taught we were moving them'))
    await settle(clock)

    expect(await $.ui.render(userRow('I taught we were moving them'))).toEqual(ENGINE_ROW)
    expect(world.logs.join('\n')).toContain('api-error')
  })

  test('rows the person did not type are never reviewed', async ($, on) => {
    const world = worldOf(on, [TAUGHT, TAUGHT, TAUGHT])
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.prompt.submit(typed('Background task finished with a error', { kind: 'task-notification' }))
    await $.prompt.submit(typed('Scheduled check found a error', { kind: 'scheduled-trigger' }))
    await $.prompt.submit(typed('Another session says there is a error', { kind: 'peer' }))
    await $.prompt.submit(typed('! ls -la'))
    await settle(clock)

    expect(world.requests).toEqual([])
  })
})

describe('settings', () => {
  test('the configured model and languages reach the review', { options: { model: 'sonnet', targetLanguage: 'Spanish', nativeLanguage: 'English' } }, async ($, on) => {
    const world = worldOf(on, [reply([])])
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.prompt.submit(typed('Yo soy muy embarazada hoy'))
    await settle(clock)

    const request = world.requests[0]
    expect(request?.model).toBe('sonnet')
    expect(`${request?.system}\n${request?.prompt}`).toContain('Spanish')
    expect(`${request?.system}\n${request?.prompt}`).toContain('English')
  })

  test('turned off in the config, nothing is reviewed', { options: { enabled: false } }, async ($, on) => {
    const world = worldOf(on, [TAUGHT])
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.prompt.submit(typed('I taught we were moving them'))
    await settle(clock)

    expect(world.requests).toEqual([])
  })
})

describe('/language-coach', () => {
  test('off pauses the reviews for the session and on resumes them, adding nothing for the model', async ($, on) => {
    const world = worldOf(on, [TAUGHT])
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    expect(world.commands).toEqual(['language-coach'])

    expect(await $.command.run(coachCommand('off'))).toEqual({})
    await $.prompt.submit(typed('I taught we were moving them'))
    await settle(clock)
    expect(world.requests).toEqual([])

    expect(await $.command.run(coachCommand('on'))).toEqual({})
    await $.prompt.submit(typed('I taught we were moving them, again'))
    await settle(clock)
    expect(world.requests.length).toBe(1)
    expect(world.toasts).toEqual(['Coaching paused for this session.', 'Coaching resumed.'])
  })

  test('opens a pane with the history, which Clear history empties, on every surface', async ($, on) => {
    const world = worldOf(on, [TAUGHT, TAUGHT])
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.prompt.submit(typed('I taught we were moving them'))
    await $.prompt.submit(typed('I taught it was done'))
    await settle(clock)

    expect(await $.command.run(coachCommand())).toEqual({})
    expect(world.opened).toEqual(['language-coach'])

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'language-coach', props: PANE_PROPS })
      const drawn = textOf(await ui.drawn())

      expect(drawn).toContain('2 corrections across 2 prompts')
      expect(drawn).toContain('2× taught → thought')
      await ui.unmount()
    }

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'language-coach', props: PANE_PROPS })
    await ui.press({ key: 'clear' })
    expect(textOf(await ui.drawn())).toContain('No corrections yet')
    await ui.unmount()
  })
})

describe('the richer UI', () => {
  const EXPLAINED = reply([
    { original: 'taught', fix: 'thought', reason: 'past tense of think', category: 'typo', explanation: '"Taught" is the past of "teach"; "thought" is the past of "think", which is what you meant.' },
  ])

  test('a fix with an explanation carries a hover card on every surface, opening below its row', async ($, on) => {
    worldOf(on, [EXPLAINED])
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.prompt.submit(typed('I taught we were moving them'))
    await settle(clock)

    for (const surface of SURFACES) {
      const row = userRow('I taught we were moving them', surface)
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'UserMessage', requestId: 'row', props: row.props, viewport: row.viewport })
      const drawn = await ui.drawn()
      const card = elementsOf(drawn, 'Box').find(box => box.props?.position === 'absolute')

      expect(textOf(drawn)).toContain('typo · past tense of think')
      expect(card?.props?.display).toBe('none')
      expect(card?.hover).toEqual({ display: 'flex' })
      expect(card?.props?.backgroundColor, 'opaque, so the transcript underneath never shows through').toBe('userMessageBackground')
      expect(card?.props?.top, 'opens below the fix, keeping the prompt above it visible').toBeUndefined()
      expect(Number(card?.props?.bottom)).toBeLessThan(0)
      expect(textOf(card)).toContain('past of "teach"')
      expect(elementsOf(drawn, 'Text').some(text => text.props?.color === 'error')).toBe(true)
      expect(elementsOf(drawn, 'Text').some(text => text.props?.backgroundColor !== undefined)).toBe(false)
      await ui.unmount()
    }
  })

  test('a fix without an explanation draws no card', async ($, on) => {
    worldOf(on, [TAUGHT])
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.prompt.submit(typed('I taught we were moving them'))
    await settle(clock)

    const drawn = await $.ui.render(userRow('I taught we were moving them'))
    expect(elementsOf(drawn, 'Box').some(box => box.props?.position === 'absolute')).toBe(false)
  })

  test('the status-line counter stays off unless enabled', async ($, on) => {
    const world = worldOf(on, [TAUGHT])
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.prompt.submit(typed('I taught we were moving them'))
    await settle(clock)

    expect(world.statuses.filter(status => status !== undefined)).toEqual([])
  })

  test('enabled, it counts today\'s fixes and the clean streak', { options: { statusLine: true } }, async ($, on) => {
    const world = worldOf(on, [reply([]), TAUGHT])
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.prompt.submit(typed('Can we convert it to a minimal API?'))
    await settle(clock)
    expect(world.statuses.at(-1)).toBe('✎ 0 fixes today · 1 clean in a row')

    await $.prompt.submit(typed('I taught we were moving them'))
    await settle(clock)
    expect(world.statuses.at(-1)).toBe('✎ 1 fix today · 0 clean in a row')

    await $.command.run(coachCommand('off'))
    expect(world.statuses.at(-1)).toBe('✎ coach paused')
  })

  test('the pane draws the trend as a Raster on the terminal and an Svg on desktop', async ($, on) => {
    worldOf(on, [TAUGHT])
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.prompt.submit(typed('I taught we were moving them'))
    await settle(clock)
    await $.command.run(coachCommand())

    const terminal = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'language-coach', props: PANE_PROPS })
    expect(elementsOf(await terminal.drawn(), 'Raster').length).toBe(1)
    await terminal.unmount()

    const desktop = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'language-coach', props: PANE_PROPS })
    const svg = elementsOf(await desktop.drawn(), 'Svg')[0]
    expect(String(svg?.props?.source)).toContain('<rect')
    await desktop.unmount()
  })
})

describe('explanations everywhere', () => {
  const EXPLANATION = '"Taught" is the past of "teach"; "thought" is the past of "think".'
  const EXPLAINED = reply([{ original: 'taught', fix: 'thought', reason: 'past tense of think', category: 'typo', explanation: EXPLANATION }])

  test('without pointer hover the explanation prints as a second line instead of a card', async ($, on) => {
    worldOf(on, [EXPLAINED])
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.prompt.submit(typed('I taught we were moving them'))
    await settle(clock)

    const row = userRow('I taught we were moving them', 'terminal', false)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'UserMessage', requestId: 'row', props: row.props, viewport: row.viewport })
    const drawn = await ui.drawn()

    expect(textOf(drawn)).toContain(`↳ ${EXPLANATION}`)
    expect(elementsOf(drawn, 'Box').some(box => box.props?.position === 'absolute')).toBe(false)
    await ui.unmount()
  })

  test('the pane rows carry the same hover cards', async ($, on) => {
    worldOf(on, [EXPLAINED])
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.prompt.submit(typed('I taught we were moving them'))
    await settle(clock)
    await $.command.run(coachCommand())

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'language-coach', props: PANE_PROPS, viewport: { columns: 160, rows: 48, isFullscreen: true } })
      const cards = elementsOf(await ui.drawn(), 'Box').filter(box => box.props?.position === 'absolute')

      expect(cards.length).toBe(1)
      expect(textOf(cards[0])).toContain('past of "teach"')
      await ui.unmount()
    }
  })

  test('fixes from an earlier session draw again under the same prompt, with no new review', async ($, on) => {
    const fixes = [{ original: 'taught', fix: 'thought', reason: 'past tense of think', category: 'typo', explanation: EXPLANATION }]
    const world = worldOf(on, [], { remembered: [{ key: rowKey('I taught we were moving them'), fixes }] })

    await $.session.start(SESSION)
    const drawn = textOf(await $.ui.render(userRow('I taught we were moving them')))

    expect(drawn).toContain('taught → thought')
    expect(world.requests).toEqual([])
  })

  test('Clear history also forgets the remembered fixes and the trend', async ($, on) => {
    worldOf(on, [EXPLAINED])
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.prompt.submit(typed('I taught we were moving them'))
    await settle(clock)
    await $.command.run(coachCommand())

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'language-coach', props: PANE_PROPS })
    await ui.press({ key: 'clear' })
    const drawn = await ui.drawn()

    expect(textOf(drawn)).toContain('No corrections yet')
    expect(elementsOf(drawn, 'Raster').length).toBe(0)
    await ui.unmount()
  })
})
