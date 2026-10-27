# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A cosmetic OpenCode **2.x** TUI plugin plus theme (`opencode-claude-style`) that makes OpenCode look like Claude Code. It changes appearance only; OpenCode's input handling, keybinds, agents, and tools stay OpenCode's. Pinned against OpenCode 2.0.20 (`@opencode/*` devDependencies). The last OpenCode 1.x–compatible commit is `9253328`.

## Commands

```sh
npm install                      # type definitions only; OpenCode provides the runtime
npm run typecheck                # tsc --noEmit
bun test                         # all tests (or, without Bun: BUN_BE_BUN=1 opencode test)
bun test test/format.test.ts     # one file
bun test -t "pattern"            # tests whose name matches
./scripts/preview.sh [args]      # run opencode with this plugin + theme layered on, config untouched
```

There is no build step: OpenCode loads `tui.ts` → `src/tui.tsx` directly with its own Bun runtime. `preview.sh` injects the plugin via `OPENCODE_CLI_CONFIG_CONTENT`; set `OPENCODE_BIN` to use a different opencode binary.

The TUI owns the terminal, so `console` output is invisible while running. Set `OPENCODE_CLAUDE_STYLE_DEBUG=/path/to/log` and use `debug()` from `src/tree.ts` to log.

## Architecture

**Entry and slots.** `src/tui.tsx` reads options (`Options` type; mirrored in the README's Options table) and claims the only slots OpenCode 2 offers: replaces `home.footer` (`HomeChrome`), prepends to `prompt.footer` (`PromptChrome`) and `session.composer.top` (`Status`), and appends to `app` (`ExpandKey`, the ctrl+o command). Each feature flag gates which slots are claimed.

**Everything else is done by reaching into OpenCode's rendered tree.** The logo, the prompt's internals, the home layout, and the transcript have no plugin API, so components mounted in those slots walk up to the renderer root and find nodes by ID, shape, or text (`src/tree.ts`: `find`, `drawn`, `textOf`, `isTextarea`, …). The firm rule: **a miss must leave OpenCode's version alone** — never throw or break if the layout differs, just skip the restyle.

Key techniques that are easy to break if you don't know about them:
- `onBeforeRender` (`src/tree.ts`) monkey-patches the root's `render` so restyling runs synchronously right before each frame. Renderer frame callbacks are async and would let OpenCode's updates flash for a frame.
- `interceptSetter` wraps a node's property setter. The transcript uses it on the markdown's text setter to hold streamed replies back to their last finished line, since OpenCode sets the text on every token.
- `blankBar` pins `customBorderChars` on a box, because OpenCode re-applies its colored left bar on re-render and turning the border off doesn't stick.
- `src/detach.tsx` renders our own Solid nodes outside the normal tree so they can be inserted anywhere in OpenCode's. It **must stay a `.tsx` file**: OpenCode maps `solid-js` to its own copy only for JSX modules, and nodes created with another copy can't find the renderer. The same applies to any module that creates Solid nodes.

**Theme.** `themes/claude-code.json` is an OpenCode theme document. OpenCode 2 plugins can't register themes, so `src/theme.ts` copies it into `~/.config/opencode/themes/` on load (leaving a user-edited copy alone, replacing the old 1.x-format copy) and, the first time only, selects it in `cli.json` unless a theme is already chosen. `test/theme.test.ts` validates it with OpenCode's own `parseThemeDocument`/`resolveThemeDocument`.

**Pure logic vs. UI.** `src/format.ts` holds the pure, tested helpers (model labels, durations, turn timing, tool-call summaries and shell-command classification). `src/palette.ts` holds Claude Code colors that have no theme token, spinner glyphs, verbs, and tips. `src/data.ts` adapts session messages into the shape these helpers read. Put new testable logic in `format.ts` rather than the components.

**Subscription limits.** `src/limits.ts` fetches 5h/7d usage from undocumented `chatgpt.com` / `api.anthropic.com` endpoints, only for `openai`/`anthropic` models with an active OAuth login read through OpenCode's credential API. It never refreshes a login itself, and any failure just omits the limits.

The README's "Known differences" section documents which parts of OpenCode can't be restyled and why. Check it before trying to change something that seems unstyled.
