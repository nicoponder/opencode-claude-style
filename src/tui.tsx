/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { HomeChrome } from "./home"
import { startPacing } from "./pacing"
import { claimModeLine, PromptChrome, Status } from "./prompt"
import type { StatusLineConfig } from "./statusline"
import { SuggestionWatcher } from "./suggest"
import { installTheme } from "./theme"
import { ExpandKey } from "./transcript"
import { LimitsCommand, UsageFooter } from "./usage"

export type Options = {
  /** Replace the OpenCode logo with Claude Code's welcome banner and Clawd. Default: true. */
  banner?: boolean
  /**
   * Restyle the prompt like Claude Code's input: full width between two rules,
   * Claude Code-style placeholders, and a "⏵⏵ build mode on" line underneath.
   * Default: true.
   */
  prompt?: boolean
  /**
   * Show a "✻ Pondering… (12s · ↓ 1.2k tokens)" line and a tip above the prompt
   * while a session is busy. Default: true.
   */
  spinner?: boolean
  /**
   * Restyle the session transcript like Claude Code's, and pace it the same way:
   * `❯` before your messages, `⏺` before replies, replies shown a finished line at
   * a time, runs of tool calls folded into one line in Claude Code's words (from
   * OpenCode's low verbosity, which ctrl+o switches to high and back), and
   * "✻ Worked for 12s · done 4:00 PM" in place of OpenCode's agent and model
   * line. Default: true.
   */
  transcript?: boolean
  /**
   * Show the session's usage under the prompt as "14.9k | ctx 25% | 5h: 48% |
   * 7d: 6%", a warning once the context is 80% full, and /limits for the details.
   * The 5h and 7d parts appear for a ChatGPT Plus/Pro or Claude Pro/Max login,
   * and are fetched from that provider. This draws the whole right of the footer,
   * so OpenCode's built-in footer has to be turned off in cli.json with
   * "-opencode.prompt.footer". Default: true.
   */
  usage?: boolean
  /**
   * After each turn, ask the session's model for your likely next prompt, show it
   * in the empty prompt, and put it in on tab, like Claude Code's prompt
   * suggestions. Each suggestion is one more request on the session's model, with
   * the whole conversation as context. Needs `prompt`. Default: false.
   */
  suggestions?: boolean
  /**
   * A command whose output shows by the prompt, like Claude Code's status line:
   * it gets the session's details as JSON on stdin and can print ANSI colors.
   * A string, or { command, padding } where padding indents it. Default: none.
   */
  statusLine?: string | { command: string; padding?: number }
  /** Name for "Welcome back <name>!". Defaults to the OS user. */
  name?: string
  /**
   * Switch to the bundled `claude-code` theme the first time the plugin installs
   * it, unless cli.json already picks a theme. Default: true.
   */
  activateTheme?: boolean
}

export type ResolvedOptions = Required<Omit<Options, "name" | "statusLine">> &
  Pick<Options, "name"> & { statusLine?: StatusLineConfig }

function readStatusLine(value: Options["statusLine"]): StatusLineConfig | undefined {
  if (typeof value === "string") return value.trim() ? { command: value, padding: 0 } : undefined
  if (!value || typeof value !== "object" || typeof value.command !== "string" || !value.command.trim()) return
  const padding = typeof value.padding === "number" && value.padding > 0 ? Math.floor(value.padding) : 0
  return { command: value.command, padding }
}

export function readOptions(raw: unknown): ResolvedOptions {
  const opts = (raw && typeof raw === "object" ? raw : {}) as Options
  return {
    banner: opts.banner !== false,
    prompt: opts.prompt !== false,
    spinner: opts.spinner !== false,
    transcript: opts.transcript !== false,
    usage: opts.usage !== false,
    suggestions: opts.suggestions === true,
    activateTheme: opts.activateTheme !== false,
    name: typeof opts.name === "string" && opts.name.trim() ? opts.name.trim() : undefined,
    statusLine: readStatusLine(opts.statusLine),
  }
}

export default Plugin.define({
  id: "opencode-claude-style",
  setup(context) {
    const options = readOptions(context.options)
    installTheme({ activate: options.activateTheme })

    const claims: Array<() => void> = []
    if (options.banner || options.prompt || options.statusLine) {
      // The home screen has no slot for its logo or prompt, so this takes over the
      // footer (which the banner makes redundant) and works from there.
      claims.push(
        context.ui.slot({
          replace: "home.footer",
          render: () => <HomeChrome context={context} options={options} />,
        }),
      )
    }
    if (options.prompt) {
      claims.push(
        context.ui.slot({
          prepend: "prompt.footer",
          render: (input) => <PromptChrome context={context} options={options} input={input} />,
        }),
        claimModeLine(context),
      )
    }
    if (options.transcript) {
      claims.push(startPacing(context), context.ui.slot({ append: "app", render: () => <ExpandKey context={context} /> }))
    }
    if (options.prompt && options.suggestions) {
      claims.push(context.ui.slot({ append: "app", render: () => <SuggestionWatcher context={context} /> }))
    }
    if (options.usage) {
      // In place of OpenCode's built-in footer, which cli.json turns off with "-opencode.prompt.footer".
      claims.push(
        context.ui.slot({ append: "prompt.footer", render: (input) => <UsageFooter context={context} input={input} /> }),
        context.ui.slot({ append: "app", render: () => <LimitsCommand context={context} /> }),
      )
    }
    if (options.spinner || options.transcript || options.statusLine) {
      claims.push(
        context.ui.slot({
          prepend: "session.composer.top",
          render: (input) => <Status context={context} options={options} sessionID={input.sessionID} />,
        }),
      )
    }
    return () => {
      for (const release of claims) release()
    }
  },
})
