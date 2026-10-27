# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A cosmetic OpenCode **2.x** TUI plugin plus theme (`opencode-claude-style`) that makes OpenCode look like Claude Code. It changes appearance only; OpenCode's input handling, keybinds, agents, and tools stay OpenCode's. Pinned against OpenCode 2.2.0 and OpenTUI 0.7 (`@opencode/*` and `@opentui/*` devDependencies); OpenTUI changes are the usual cause of breakage. The last OpenCode 1.x–compatible commit is `9253328`.

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

**Entry and slots.** `src/tui.tsx` reads options (`Options` type; mirrored in the README's Options table) and claims slots: replaces `home.footer` (`HomeChrome`), replaces `prompt.footer.status` with the mode line (`claimModeLine`, which releases the claim while the current session is busy so OpenCode's progress and interrupt hint show), prepends to `prompt.footer` (`PromptChrome`, which only anchors the prompt restyle) and `session.composer.top` (`Status`), and appends to `prompt.footer` (`UsageFooter` in `src/usage.tsx`). Each feature flag gates which slots are claimed. The slot paths are in `SlotMap` in `@opencode/plugin/dist/tui/context.d.ts`. Prefer a slot over tree surgery whenever one fits.

OpenCode's own usage text, subagent/shell counts, and `ctrl+p commands` hints come from a built-in plugin, `opencode.prompt.footer`, not from the slot. `UsageFooter` reimplements that whole right side, so the built-in has to be disabled with a `"-opencode.prompt.footer"` entry in `cli.json`'s `plugins` (`scripts/preview.sh` adds it). A `-<id>` plugins entry disables any built-in by ID.

**Everything else is done by reaching into OpenCode's rendered tree.** The logo, the prompt's internals, the home layout, and the transcript have no plugin API, so components mounted in those slots walk up to the renderer root and find nodes by ID, shape, or text (`src/tree.ts`: `find`, `drawn`, `textOf`, `isTextarea`, …). The firm rule: **a miss must leave OpenCode's version alone** — never throw or break if the layout differs, just skip the restyle.

Key techniques that are easy to break if you don't know about them:
- `onBeforeRender` (`src/tree.ts`) monkey-patches the root's `render` so restyling runs synchronously right before each frame. Renderer frame callbacks are async and would let OpenCode's updates flash for a frame.
- `interceptSetter` wraps a node's property setter. The prompt uses it to swap OpenCode's rotating placeholder for Claude Code's.
- `interceptPrototypeSetter` wraps a setter for every instance of a class. `src/pacing.tsx` uses it on the markdown component's `content`, taking the prototype from one of OpenCode's markdown nodes (the plugin's OpenTUI copy may not be OpenCode's), and holds back only text matching the reply streaming in the open session (from `context.data`). That keeps pacing independent of the transcript's row structure.
- `blankBar` pins `customBorderChars` on a box, because OpenCode re-applies its colored left bar on re-render and turning the border off doesn't stick.
- `src/detach.tsx` renders our own Solid nodes outside the normal tree so they can be inserted anywhere in OpenCode's. It **must stay a `.tsx` file**: OpenCode maps `solid-js` to its own copy only for JSX modules, and nodes created with another copy can't find the renderer. The same applies to any module that creates Solid nodes.

**Theme.** `themes/claude-code.json` is an OpenCode theme document. OpenCode 2 plugins can't register themes, so `src/theme.ts` copies it into `~/.config/opencode/themes/` on load (leaving a user-edited copy alone, replacing the old 1.x-format copy) and, the first time only, selects it in `cli.json` unless a theme is already chosen. `test/theme.test.ts` validates it with OpenCode's own `parseThemeDocument`/`resolveThemeDocument`.

**Pure logic vs. UI.** `src/format.ts` holds the pure, tested helpers (model labels, durations, turn timing, tool-call summaries and shell-command classification). `src/palette.ts` holds Claude Code colors that have no theme token, spinner glyphs, verbs, and tips. `src/data.ts` adapts session messages into the shape these helpers read. Put new testable logic in `format.ts` rather than the components.

**Folding** is OpenCode's own `session.verbosity: "low"`. `transcript.tsx` only rewords its summary line (found by its text, via `claudeSummary` in `format.ts`) and drives ctrl+o by dispatching `session.verbosity.cycle`, reading the current level from that command's title. Don't read `context.keymap.commands()` inside a `keymap.layer` factory: the list includes the layer, and the cycle hangs the TUI before its first frame. Read it in an effect and pass a signal.

**Commands.** Plugin commands are registered with `context.keymap.layer`. A command with `slash` only shows up in slash completion when its layer has `mode: "global"`, as OpenCode's own `/btw` does (see `LimitsCommand` in `src/usage.tsx`).

**Prompt suggestions** (`src/suggest.tsx`, off by default). An `app` slot component asks for a suggestion after each turn through `context.client.session.generate` (the one-off, out-of-transcript request OpenCode's `/btw` uses; it always runs on the session's model). `PromptChrome` shows it through the placeholder wrapper and inserts it on tab with the textarea's `insertText`.

**Subscription limits.** `src/limits.ts` fetches 5h/7d usage from undocumented `chatgpt.com` / `api.anthropic.com` endpoints, only for `openai`/`anthropic` models with an active OAuth login read through OpenCode's credential API. It never refreshes a login itself, and any failure just omits the limits.

The README's "Known differences" section documents which parts of OpenCode can't be restyled and why. Check it before trying to change something that seems unstyled.
