export type Category = 'typo' | 'grammar' | 'transfer' | 'word-choice' | 'phrasing'

export type Fix = { original: string; fix: string; reason: string; category: Category; explanation?: string }

export type Coaching = { fixes: Fix[] }

export type Entry = { at: number; language: string; fixes: Fix[] }

export type Day = { prompts: number; fixes: number }

export type Daily = Record<string, Day>

export type Remembered = { key: string; fixes: Fix[] }

declare module 'claude-code' {
  interface PluginState {
    'language-coach': {
      coaching: StateFamily<Coaching>
      history: Entry[]
      daily: Daily
      remembered: Record<string, Fix[]>
      streak: number
      isPaused: boolean
    }
  }
}
