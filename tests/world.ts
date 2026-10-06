import type { ModelCompleteRequest, ModelCompleteResult, On, PromptOrigin, PromptSubmitInput, RenderElement, RenderInput } from 'claude-code'

export type World = {
  requests: ModelCompleteRequest[]
  replies: string[]
  commands: string[]
  opened: string[]
  toasts: string[]
  logs: string[]
  statuses: (string | undefined)[]
  stored: Record<string, unknown>
}

export const USAGE = { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

export const ENGINE_ROW: RenderElement = { type: 'Text', props: {}, children: ['> the prompt as the engine draws it'] } as RenderElement

export const worldOf = (on: On, replies: string[] = [], stored: Readonly<Record<string, unknown>> = {}): World => {
  const world: World = { requests: [], replies: [...replies], commands: [], opened: [], toasts: [], logs: [], statuses: [], stored: { ...stored } }

  on('store.get', ($, e) => ({ value: world.stored[e.key] }))
  on('store.set', ($, e) => {
    world.stored[e.key] = e.value

    return { value: undefined }
  })
  on('model.complete', ($, e): { value: ModelCompleteResult } => {
    world.requests.push(e)
    const text = world.replies.shift()

    return {
      value:
        text === undefined
          ? { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }
          : { isAnswered: true, text, usage: USAGE },
    }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('command.register', ($, e) => {
    world.commands.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', ($, e) => {
    world.opened.push(e.id)

    return { value: { isPlaced: true } } as never
  })
  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    world.logs.push(e.text)

    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    world.statuses.push(e.text)

    return { value: undefined }
  })
  on('ui.render', () => ENGINE_ROW)

  return world
}

export const SESSION = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

export const typed = (text: string, origin: PromptOrigin = { kind: 'composer' }): PromptSubmitInput => ({ text, origin, wait: false })

export const userRow = (text: string, surface: 'terminal' | 'desktop' = 'terminal', isFullscreen = true): RenderInput<'UserMessage'> => ({
  component: 'UserMessage',
  surface,
  requestId: 'row',
  viewport: { columns: 120, rows: 40, isFullscreen },
  props: { text, origin: { kind: 'composer' }, isExpanded: false },
})

export const coachCommand = (args = '') => ({
  command: 'language-coach',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
})

export const PANE_PROPS = {
  title: 'English coach',
  isFocused: false,
  bodyColumns: 72,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

export const reply = (fixes: object[]) => JSON.stringify({ fixes })

export function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (node === null || typeof node !== 'object') return ''
  const children = (node as { children?: unknown[] }).children ?? []
  const label = (node as { props?: { label?: unknown } }).props?.label

  return (typeof label === 'string' ? `[${label}]` : '') + children.map(textOf).join('')
}

type Node = { type?: string; props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }

export function elementsOf(node: unknown, type: string): Node[] {
  if (node === null || typeof node !== 'object') return []
  const element = node as Node

  return [...(element.type === type ? [element] : []), ...(element.children ?? []).flatMap(child => elementsOf(child, type))]
}
