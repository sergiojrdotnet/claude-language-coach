<p align="center">
  <img src="Logo.png" alt="Language Coach, a Claude Code plugin" width="640">
</p>

# Language Coach for Claude Code

Get writing feedback on every prompt you type, in the language you are practising. A small model reviews each prompt in a separate call and shows the fixes under it. Nothing is added to the main conversation, so its context stays clean. Each review is a small, separate request that counts against your usage (see [Cost and privacy](#cost-and-privacy)).

```
> I taught we were moving them to the same bucket
  ✎ taught → thought  typo · past tense of think
    ‾‾‾‾‾‾   ‾‾‾‾‾‾‾
    red      green, bold   (your theme's error and success colors)
```

Each fix also comes with a short explanation of the rule behind it:

- **Fullscreen terminal or desktop app:** hover over the fix to see the explanation in a card.
- **Other surfaces:** the explanation prints as a dim `↳` line under the fix.

Fixes stay attached to their prompts after `--resume`.

## Install

In a Claude Code terminal session:

```
/plugin install language-coach --marketplace sergiojrdotnet/claude-language-coach
```

Answer `y` to add the marketplace, then pick the **user** scope so the coach runs in every session.

Requires Claude Code **2.1.291 or newer** (mods / function hooks). The mods API is early access and can change between releases.

## Use

| You do | You get |
| --- | --- |
| Type a prompt | About 1–2 s later, any fixes appear under your prompt. A clean prompt shows nothing. |
| `/language-coach` | A pane with your history: corrections by category, a 30-day trend of fixes per prompt, your recurring mistakes, and recent fixes. It has **Pause** and **Clear history** buttons. |
| `/language-coach off` / `/language-coach on` | Pause or resume the coach for the current session. |

Prompts are skipped when they:

- are not mainly in your target language
- start with `/` or `!`
- are shorter than the minimum length
- are longer than the maximum length (usually pasted logs)

Prompts that you did not type are also skipped: task notifications, scheduled runs and messages from other sessions.

## Settings

Change them under `/config` → **language-coach**:

| Setting | Default | What it does |
| --- | --- | --- |
| Language you practise | `English` | The language your prompts are coached in. |
| Your native language | `Brazilian Portuguese` | Helps the coach spot transfer errors (false friends, calques, prepositions). |
| Coach model | `haiku` | `haiku`, `sonnet` or `opus`. Haiku is fast and cheap. |
| Minimum prompt length | `8` | Shorter prompts are not coached. |
| Maximum prompt length | `2000` | Longer prompts are not coached. |
| Coach my prompts | on | Turns the coach off without uninstalling it. |
| Status-line counter | off | Shows `✎ 2 fixes today · 5 clean in a row` under the prompt box. |

## How it works

```
you type ──► prompt.submit hook ──► the prompt goes to the main model unchanged
                   │
                   └─► (timer) $.model.complete({ model: haiku }) ──► JSON fixes
                                                                       │
          UserMessage row ◄── ui.render wraps the engine's row ◄───────┘
```

- **Separate review call:** the review is a one-shot `$.model.complete` call. It has no tools and no conversation history, and it uses the credentials of your Claude Code session.
- **Display only:** fixes go into session state and are drawn by a `ui.render` hook on your prompt's row. The stored message and the model's context are never changed.
- **History:** stored with the mod's `$.store`, on your machine. It keeps the corrected fragments (original, fix, reason, category, explanation) of the last 500 prompts with fixes, plus a daily count of reviews and fixes for the trend. It never stores whole prompts.

### Cost and privacy

- **Tokens per review:** about 1k input tokens and a few dozen output tokens on Haiku. Most of the input is Claude Code's fixed identity block.
- **Plan usage:** reviews count against your plan or API usage like any other request.
- **Where prompts go:** your prompts go to Anthropic through your own Claude Code login, the same destination as the prompt itself. Nothing is sent anywhere else.

## How the prompt was chosen

The coach prompt in `hooks/prompt.ts` was picked by a blind evaluation on real Claude Haiku 4.5, run through the same `$.model.complete` path the mod uses:

1. **Test set:** 70 prompts (real developer prompts plus synthetic traps), each labeled with the errors a native editor would fix.
2. **Split:** the prompts were divided into a tuning half and a held-out test half.
3. **Candidates:** five prompt designs were tuned on the first half only.
4. **Judging:** blind judges scored each design's output on the held-out half for missed errors, false flags, fix quality and format.

| Prompt (held-out half) | Recall | Precision | Output tokens |
| --- | --- | --- | --- |
| Shipped: calibrated + explanations | 0.76 | 0.82 | ~83 |
| Same prompt without explanations | 0.76 | 0.93 | ~46 |
| Original hook prompt | 0.91 | 0.80 | ~119 (prose outside the JSON) |

Precision is weighted heavily because the coach runs on every prompt: a wrong correction costs more than a missed one. The evaluation data contains private prompts, so it is not published.

## Development

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .          # run a session with the local copy
```

The coach prompt lives in `hooks/prompt.ts`. It uses `{{TARGET_LANGUAGE}}`, `{{NATIVE_LANGUAGE}}` and `{{PROMPT}}` placeholders, so it stays language-generic.

## License

MIT
