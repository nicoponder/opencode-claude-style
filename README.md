# opencode-claude-style

## Disclaimer: This is entirely vibe-coded
This isn't representative of my work as an engineer and certainly isn't something I'll be maintaining for others' usage or taking PRs on-- please just fork it if you'd like something for the community. I threw this together in an afternoon because my workplace switched to Codex from Claude, and don't care for the default behavior or styling of Codex and OpenCode. This is public mostly so that I can easily install it where it's necessary.

## Description
A cosmetic theme and TUI plugin that makes [OpenCode](https://opencode.ai) look
like Claude Code, so it feels familiar if you're used to Claude Code.

It changes appearance only. OpenCode's commands, keybinds, agents, and tools all
work exactly as before. None of Claude Code's features are copied.

![Home screen with the Claude Code-style welcome banner and Clawd](docs/home.png)

| Session (busy)                                | Diffs                               | Light mode                                        |
| --------------------------------------------- | ----------------------------------- | ------------------------------------------------- |
| ![Busy session with spinner](docs/session-busy.png) | ![Edit diff](docs/diff.png) | ![Light mode home screen](docs/home-light.png) |

## What you get

| Piece | What it changes |
| --- | --- |
| **`claude-code` theme** | Claude Code's dark and light palettes: brand orange `#D77757`, the gray user-message background, the lavender accent used for inline code and links, success/error/warning colors, diff backgrounds, Monokai Extended (dark) and GitHub (light) syntax colors. The background is transparent, so your terminal's background shows through as it does in Claude Code. |
| **Welcome banner** | Replaces the OpenCode logo with Claude Code's welcome box: an orange rounded border with the name and version in the top edge, "Welcome back *name*!", **Clawd**, your model and directory, plus "Tips for getting started" and "Recent activity" (your latest OpenCode sessions). Below 64 columns it switches to Claude Code's compact three-line header. |
| **Clawd** | Drawn from the same quadrant-block characters Claude Code uses (`▐▛███▜▌` / `▝▜█████▛▘` / `▘▘ ▝▝`), with black eyes. |
| **Prompt** | Sits at the bottom of the home screen, as it does in a session, and spans the full terminal width between two horizontal rules, like Claude Code's input. It starts with Claude Code's `❯` (`!` in shell mode) instead of OpenCode's colored bar, has no filled background, and uses Claude Code's placeholder suggestions (`Try "fix lint errors"`, `Try "how does <filepath> work?"`, …). OpenCode's agent and model row is removed from inside the prompt. |
| **Mode line** | The bottom line, under the prompt, in place of OpenCode's directory: `⏵⏵ build mode on (shift+tab to cycle)` or `⏸ plan mode on (shift+tab to cycle)`, like Claude Code's. Build is lavender and plan is teal, as in Claude Code, unless you've given the agent a `color`; other agents get `⏵⏵` in their OpenCode color. Shell mode shows `! shell mode on`, and the key shown is whatever `agent.cycle` is bound to. The model isn't shown, as in Claude Code. |
| **Spinner line** | While a session is working, shows `✻ Pondering… (12s · ↓ 1.2k tokens · thinking)` above the prompt, timed from your message, with `⎿  Tip: …` underneath. The glyph cycles through `· ✢ ✳ ✶ ✻ ✽`, the verb is picked at random from a whimsical list, and a highlight sweeps across it. `thinking` shows while the model is reasoning. The tips are OpenCode's own. OpenCode's own progress indicator is still there. |
| **Usage line** | Left of `ctrl+p commands` under the prompt, OpenCode's `15.9K (8%)` becomes `14.9k \| ctx 25% \| 5h: 48% \| 7d: 6%`: the session's tokens, how full the context is, and, when you're signed in with a ChatGPT Plus/Pro or Claude Pro/Max subscription, how much of its 5-hour and 7-day limits you've used. In a narrow terminal it drops the token count, then the cost, the context, and the 7-day limit to fit. |
| **Transcript** | Your earlier prompts show as `❯ text` on a gray band instead of in a box with a colored bar. Replies start with `⏺`, and while one streams only its finished lines show, so prose arrives a paragraph at a time instead of word by word, as in Claude Code. Runs of reads, searches, shell commands, and web fetches fold into one line. While the run is going, a dim `⏺` blinks beside `Listing 1 directory, running 2 shell commands…` (or the running command's description, if the model gave one), with `⎿  $ npm test` underneath. The line stays put between calls instead of flickering, and each command stays up for at least 0.7s so you can read it. Once the reply moves on, it becomes a dim `Listed 1 directory, ran 2 shell commands`. Shell commands that only list, read, or search (`ls`, `cat`, `grep`, …) count as such, as Claude Code counts them. Thinking is hidden, and the spinner line says when the model is thinking. <kbd>ctrl+o</kbd> expands everything to OpenCode's full view, with thinking shown, and collapses it again. OpenCode's `Build · model · 12s` line after each reply becomes `✻ Worked for 12s · done 4:00 PM` (the verb varies, as in Claude Code), or `⎿  Interrupted · What should OpenCode do instead?`. |

## Install

Requires OpenCode **2.0** or later; tested with 2.0.20. (OpenCode 1.x plugins
don't run in 2.0; use the last 1.x-compatible commit, `9253328`, for OpenCode
1.18.) OpenCode loads CLI plugins with its own Bun runtime, so there's no build
step.

### Try it without changing your config

```sh
./scripts/preview.sh            # same as `opencode`, with this plugin layered on
./scripts/preview.sh ~/my/repo  # extra arguments are passed through to opencode
```

This uses `OPENCODE_CLI_CONFIG_CONTENT` to add the plugin and theme on top of
your `cli.json`. Your providers, logins, and keybinds still apply. Your config
files aren't touched, but the plugin does copy `claude-code.json` into
`~/.config/opencode/themes/` when it loads.

### Install permanently

Clone this repo somewhere, then add the folder to the `plugins` list in
**`~/.config/opencode/cli.json`**. It's a CLI-only plugin, so it doesn't go in
`opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/absolute/path/to/opencode-claude"]
}
```

When the plugin loads, it copies `themes/claude-code.json` into
`~/.config/opencode/themes/` if it isn't there yet (OpenCode 2 plugins can't
register themes directly), and replaces the old-format copy that OpenCode 1.x
installed. It leaves a copy you've edited alone; delete the file to get the
bundled one back. The first time it installs the theme, it also picks it in
`cli.json`, unless you've already chosen a theme there. After that, `/themes`
switches themes as usual.

To use **only the theme**, copy `themes/claude-code.json` into
`~/.config/opencode/themes/` and set `"theme": { "name": "claude-code" }` in
`cli.json`.

## Options

Pass options with the object form of a `plugins` entry:

```jsonc
// cli.json
{
  "plugins": [
    { "package": "/absolute/path/to/opencode-claude", "options": { "name": "Nico", "spinner": false } }
  ]
}
```

| Option | Default | Effect |
| --- | --- | --- |
| `banner` | `true` | Replace the OpenCode logo with the welcome banner and Clawd, and remove OpenCode's home footer (MCP status and version; the banner shows the version). |
| `prompt` | `true` | Full-width prompt between rules, Claude Code-style placeholders, the prompt at the bottom of the home screen, and the mode line. |
| `spinner` | `true` | Show the `✻ Pondering… (12s · ↓ 1.2k tokens)` line and a tip while a session is busy. With `transcript` off, the line becomes `✻ Worked for 12s · done 4:00 PM` once the turn is done. |
| `transcript` | `true` | Restyle and pace the session transcript: `❯` prompts, `⏺` replies shown a finished line at a time, folded tool calls with <kbd>ctrl+o</kbd> to expand, thinking hidden until <kbd>ctrl+o</kbd>, and `✻ Worked for 12s · done 4:00 PM` after each reply. |
| `usage` | `true` | Show `14.9k \| ctx 25% \| 5h: 48% \| 7d: 6%` under the prompt. The 5h and 7d parts need a ChatGPT or Claude subscription login (see below). |
| `name` | your OS user | The name in "Welcome back *name*!". |
| `activateTheme` | `true` | Pick `claude-code` in `cli.json` the first time the plugin installs it, if no theme is chosen there. |

## Subscription limits

OpenCode doesn't track 5-hour and 7-day limits, so the plugin asks the provider,
the way Codex's `/status` and Claude Code's `/usage` do. It does this only when
the session's model comes from `openai` or `anthropic` and OpenCode has an
active OAuth login (not an API key) for that provider, which the plugin reads
through OpenCode's credential API. The login is sent only to the provider it
belongs to (`chatgpt.com` or `api.anthropic.com`). It is fetched when the
session opens, after each turn (at most every 30 seconds), and every 5 minutes.
The plugin never refreshes a login itself: if it has expired, the limits are
left out until OpenCode refreshes it. Any other provider, or a failed request,
just leaves them out. These endpoints aren't documented, so a provider could
change them without notice.

## Color mapping

OpenCode 2 themes build every color from nine-step hue scales plus semantic
tokens. The theme anchors each hue's step 200 on a Claude Code color:

| Claude Code | OpenCode theme token | Dark | Light |
| --- | --- | --- | --- |
| `claude` (brand, Clawd) | `hue.orange` (= `interactive`), `scrollbar` | `#D77757` | `#D77757` |
| `text` / `inactive` | `text.base` / `text.muted` | `#FFFFFF` / `#999999` | `#000000` / `#666666` |
| `promptBorder` / `subtle` | `border.base` / markdown rules | `#888888` / `#505050` | `#999999` / `#AFAFAF` |
| `userMessageBackground` | `background.raised.base` (`hue.band.200`) | `#373737` | `#F0F0F0` |
| `suggestion` / `permission` | `hue.purple`, markdown code and links | `#B1B9F9` | `#5769F7` |
| `planMode` | `hue.cyan` (= `accent`) | `#48968C` | `#006666` |
| `success` / `error` / `warning` | `text.feedback.*` | `#4EBA65` / `#FF6B80` / `#FFC107` | `#2C7A39` / `#AB2B3F` / `#966C1E` |
| `diffAdded` / `diffRemoved` | `diff.background.*` | `#225C2B` / `#7A2936` | `#69DB7C` / `#FFA8B4` |
| `diffAddedDimmed` / `diffRemovedDimmed` | `diff.lineNumber.background.*` | `#47584A` / `#69484D` | `#C7E1CB` / `#FDD2D8` |
| `diffAddedWord` / `diffRemovedWord` | `diff.highlight.*` | `#38A660` / `#B3596B` | `#2F9D44` / `#D1454B` |

OpenCode fills its prompt with the step below `background.raised.base`, so the
theme's `band` hue is transparent at step 100: messages keep their gray band
while the prompt stays unfilled. `categorical` starts with lavender and teal, the
colors OpenCode gives agents by their position.

## Known differences

These parts of OpenCode's UI aren't exposed to plugins, so they keep their
OpenCode styling:

- OpenCode 2 gives plugins slots only for the home footer, the prompt footer, the
  area above the session prompt, the sidebar, and the app root. Everything else
  the plugin changes (the logo, the prompt's inside, the home screen's layout, and
  the transcript) is found in the rendered layout: the logo's box (hidden, with the
  banner put in its place), the prompt's agent and model row (hidden, and read to
  get the current agent), its colored bar (blanked, with `❯` drawn over it), the
  home screen's spacers (rearranged so the prompt sits at the bottom), and the
  transcript's rows (recognized by their IDs and by what OpenCode draws in them).
  If a future OpenCode version changes that layout, those parts stay as OpenCode
  draws them and the mode line stays empty, rather than anything breaking. Hiding
  the agent row also hides the model variant (reasoning effort) and the `auto`
  permissions tag.
- The transcript is restyled just before each frame is drawn, by hooking into
  OpenCode's renderer. Reply text is held back by wrapping the markdown's text
  setter, since OpenCode sets it on every token.
- Only reads, searches, shell commands, web fetches, web searches, and skills
  fold into summary lines. Edits, writes, subagents, todos, questions, other
  tools, and failed or denied calls keep OpenCode's style, as do all tool calls
  once expanded with <kbd>ctrl+o</kbd>. There are no `⏺ Bash(…)` / `⎿` result
  lines. OpenCode groups web searches with searches, so they count as searches.
- <kbd>ctrl+o</kbd> is OpenCode's shortcut for its recent sessions menu. In a
  session the plugin takes it over (the menu is still on <kbd>ctrl+o</kbd> on the
  home screen, and in the command palette). To use another key, bind
  `claude.transcript.expand` in `cli.json`'s `keybinds`.
- <kbd>ctrl+o</kbd> switches OpenCode's thinking display on while expanded, and
  back off when collapsed or when OpenCode exits. OpenCode saves that setting to
  `cli.json`, so it's written each time.
- Expanding with <kbd>ctrl+o</kbd> shows OpenCode's own view, where reads and
  searches stay grouped under `→ Explored: …` (click one to open it).
- The token count in the spinner line is estimated from the text streamed so
  far, until OpenCode reports the real count at the end of each step.
- While a session is busy, OpenCode shows its own `esc interrupt` indicator where
  the mode line is, so the mode line comes back when the turn finishes.
- OpenCode's `shift+tab agents` and `ctrl+p commands` hints stay at the right of the mode line.
- The home prompt ignores OpenCode's 75-column cap so it can span the terminal.
- The rules are drawn only while the theme leaves the prompt unfilled (as
  `claude-code` does). Under a theme with a filled prompt, the fill already shows
  its width.
- Shell mode (`!`) uses the theme's primary orange rather than Claude Code's
  pink bash border.
- Hovering over one of your earlier prompts clears its gray band, since OpenCode
  highlights it with the same (transparent) color as the prompt.

## Development

```sh
npm install        # type definitions only; OpenCode provides the runtime
npm run typecheck
bun test           # or, without Bun installed: BUN_BE_BUN=1 opencode test
```

Set `OPENCODE_CLAUDE_STYLE_DEBUG=/tmp/claude-style.log` to log the plugin's
errors while OpenCode owns the terminal.

Layout:

```
themes/claude-code.json  the OpenCode theme (installed into the themes folder by src/theme.ts)
tui.ts                   entry point when the plugin is loaded from this folder
src/tui.tsx              plugin entry: reads options, claims slots
src/theme.ts             installs the theme and picks it on first load
src/home.tsx             home screen: banner in place of the logo, prompt at the bottom
src/welcome.tsx          welcome banner and compact header
src/clawd.tsx            Clawd
src/prompt.tsx           prompt restyling, mode line, and the spinner line
src/transcript.tsx       transcript restyling and the ctrl+o key
src/usage.tsx            the usage line under the prompt
src/limits.ts            5-hour and 7-day limits for ChatGPT and Claude subscriptions
src/detach.tsx           rendering our nodes to place inside OpenCode's layout
src/tree.ts              helpers for finding parts of OpenCode's rendered layout
src/data.ts              session messages in the shape the helpers read
src/palette.ts           Claude Code colors with no theme token, spinner glyphs, verbs, and tips
src/format.ts            pure helpers (model label, durations, turn timing, tool summaries)
scripts/preview.sh       run OpenCode with the plugin, without editing config
```

The plugin replaces the `home.footer` slot, prepends to `prompt.footer` and
`session.composer.top`, and appends to `app` (for the ctrl+o key). The prompt
itself is still OpenCode's, so input handling, autocomplete, and keybinds are
OpenCode's.
