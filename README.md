# opencode-claude-style

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
| **Prompt** | Claude Code-style placeholder suggestions (`"fix lint errors"`, `"how does <filepath> work?"`, …), a dim hint in the spot where Claude Code shows `? for shortcuts`, and no filled background. |
| **Spinner line** | While a session is working, shows `✻ Pondering… (12s)` above the prompt. The glyph cycles through `· ✢ ✳ ✶ ✻ ✽`, the verb is picked at random from a whimsical list, and a highlight sweeps across it. This is decoration only; OpenCode's own progress indicator is still there. |
| **Agent colors** (optional server plugin) | Build uses lavender. Plan uses teal, like Claude Code's plan mode. Without this, OpenCode colors agents by their position in the list, and plan comes out yellow. |

## Install

Requires OpenCode **1.18** or later; tested with 1.18.32. TUI plugins and
`oc-themes` are loaded by OpenCode's Bun runtime, so there's no build step.

### Try it without changing your config

```sh
./scripts/preview.sh            # same as `opencode`, with this plugin layered on
./scripts/preview.sh ~/my/repo  # extra arguments are passed through to opencode
```

This uses `OPENCODE_TUI_CONFIG` and `OPENCODE_CONFIG` to add the plugin on top of
your existing config. Your providers, auth, and keybinds still apply. Your config
files aren't touched, but OpenCode does copy `claude-code.json` into
`~/.config/opencode/themes/` when the plugin loads.

### Install permanently

Clone this repo somewhere, then point OpenCode at the folder.

**`~/.config/opencode/tui.json`** holds the theme, banner, prompt, and spinner:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "theme": "claude-code",
  "plugin": ["/absolute/path/to/opencode-claude"]
}
```

**`~/.config/opencode/opencode.json`** is optional and only sets agent colors:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["/absolute/path/to/opencode-claude"]
}
```

The first time the plugin loads, OpenCode copies `themes/claude-code.json` into
its themes folder. If `tui.json` doesn't already set a theme, the plugin also
switches to `claude-code` that first time only. After that, `/themes` (or
<kbd>ctrl+x t</kbd>) switches themes as usual.

To use **only the theme**, copy `themes/claude-code.json` into
`~/.config/opencode/themes/` and set `"theme": "claude-code"`.

## Options

Pass options with OpenCode's `[spec, options]` plugin syntax:

```jsonc
// tui.json
{
  "plugin": [
    ["/absolute/path/to/opencode-claude", { "name": "Nico", "spinner": false }]
  ]
}
```

| Option | Default | Effect |
| --- | --- | --- |
| `banner` | `true` | Replace the OpenCode logo with the welcome banner and Clawd. |
| `prompt` | `true` | Claude Code-style placeholders and hint text. |
| `spinner` | `true` | Show the `✻ Pondering… (12s)` line while a session is busy. |
| `name` | `username` from config, then your OS user | The name in "Welcome back *name*!". |
| `activateTheme` | `true` | Switch to `claude-code` on first load if `tui.json` sets no theme. |

The server plugin in `opencode.json` takes one option: `agentColors`
(default `true`). It never overrides a `color` you've set on an agent yourself.

## Color mapping

| Claude Code | OpenCode theme key | Dark | Light |
| --- | --- | --- | --- |
| `claude` (brand, Clawd) | `primary`, `borderActive` | `#D77757` | `#D77757` |
| `text` / `inactive` | `text` / `textMuted` | `#FFFFFF` / `#999999` | `#000000` / `#666666` |
| `promptBorder` / `subtle` | `border` / `borderSubtle` | `#888888` / `#505050` | `#999999` / `#AFAFAF` |
| `userMessageBackground` | `backgroundPanel`, `backgroundMenu` | `#373737` | `#F0F0F0` |
| `suggestion` / `permission` | `secondary`, markdown code and links | `#B1B9F9` | `#5769F7` |
| `planMode` | `accent` | `#48968C` | `#006666` |
| `success` / `error` / `warning` | same names | `#4EBA65` / `#FF6B80` / `#FFC107` | `#2C7A39` / `#AB2B3F` / `#966C1E` |
| `diffAdded` / `diffRemoved` | `diffAddedBg` / `diffRemovedBg` | `#225C2B` / `#7A2936` | `#69DB7C` / `#FFA8B4` |
| `diffAddedDimmed` / `diffRemovedDimmed` | `diff*LineNumberBg` | `#47584A` / `#69484D` | `#C7E1CB` / `#FDD2D8` |
| `diffAddedWord` / `diffRemovedWord` | `diffHighlight*` | `#38A660` / `#B3596B` | `#2F9D44` / `#D1454B` |

## Known differences

These parts of OpenCode's UI aren't exposed to plugins, so they keep their
OpenCode styling:

- The prompt keeps OpenCode's colored left bar and its `Ask anything… "…"` prefix.
  Claude Code's `>` marker and horizontal rules can't be added inside it. (Adding
  rules around the whole prompt was tried; it looked worse.)
- Messages keep OpenCode's layout. There are no `⏺` bullets or `⎿` result
  connectors, and no `>` before user messages.
- Shell mode (`!`) uses the theme's primary orange rather than Claude Code's
  pink bash border.
- OpenCode's own home footer and startup tips are left in place.

## Development

```sh
npm install        # type definitions only; OpenCode provides the runtime
npm run typecheck
bun test           # or, without Bun installed: BUN_BE_BUN=1 opencode test
```

Layout:

```
themes/claude-code.json  the OpenCode theme (registered through "oc-themes")
src/tui.tsx              TUI plugin entry: registers slots, reads options
src/welcome.tsx          welcome banner and compact header
src/clawd.tsx            Clawd
src/prompt.tsx           prompt wrappers and the spinner line
src/palette.ts           Claude Code colors with no theme key, spinner glyphs and verbs
src/format.ts            pure helpers (model label, truncation, relative time)
src/server.ts            optional server plugin that sets agent colors
scripts/preview.sh       run OpenCode with the plugin, without editing config
```

The plugin fills OpenCode's `home_logo`, `home_prompt`, and `session_prompt`
slots. The prompt slots render OpenCode's own `api.ui.Prompt` with different
props, so input handling, autocomplete, and keybinds are OpenCode's.
