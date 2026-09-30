/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { HomeChrome } from "./home"
import { PromptChrome, Status } from "./prompt"
import { installTheme } from "./theme"
import { ExpandKey } from "./transcript"

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
   * a time, runs of reads, searches, and shell commands folded into one line
   * (ctrl+o expands them), thinking hidden until ctrl+o, and "✻ Worked for 12s ·
   * done 4:00 PM" in place of OpenCode's agent and model line. Default: true.
   */
  transcript?: boolean
  /**
   * Show the session's usage under the prompt as "14.9k | ctx 25% | 5h: 48% |
   * 7d: 6%". The 5h and 7d parts appear for a ChatGPT Plus/Pro or Claude Pro/Max
   * login, and are fetched from that provider. Default: true.
   */
  usage?: boolean
  /** Name for "Welcome back <name>!". Defaults to the OS user. */
  name?: string
  /**
   * Switch to the bundled `claude-code` theme the first time the plugin installs
   * it, unless cli.json already picks a theme. Default: true.
   */
  activateTheme?: boolean
}

export type ResolvedOptions = Required<Omit<Options, "name">> & Pick<Options, "name">

export function readOptions(raw: unknown): ResolvedOptions {
  const opts = (raw && typeof raw === "object" ? raw : {}) as Options
  return {
    banner: opts.banner !== false,
    prompt: opts.prompt !== false,
    spinner: opts.spinner !== false,
    transcript: opts.transcript !== false,
    usage: opts.usage !== false,
    activateTheme: opts.activateTheme !== false,
    name: typeof opts.name === "string" && opts.name.trim() ? opts.name.trim() : undefined,
  }
}

export default Plugin.define({
  id: "opencode-claude-style",
  setup(context) {
    const options = readOptions(context.options)
    installTheme({ activate: options.activateTheme })

    const claims: Array<() => void> = []
    if (options.banner || options.prompt) {
      // The home screen has no slot for its logo or prompt, so this takes over the
      // footer (which the banner makes redundant) and works from there.
      claims.push(
        context.ui.slot({
          replace: "home.footer",
          render: () => <HomeChrome context={context} options={options} />,
        }),
      )
    }
    if (options.prompt || options.usage) {
      claims.push(
        context.ui.slot({
          prepend: "prompt.footer",
          render: (input) => <PromptChrome context={context} options={options} input={input} />,
        }),
      )
    }
    if (options.spinner || options.transcript) {
      claims.push(
        context.ui.slot({
          prepend: "session.composer.top",
          render: (input) => <Status context={context} options={options} sessionID={input.sessionID} />,
        }),
      )
    }
    if (options.transcript) {
      claims.push(context.ui.slot({ append: "app", render: () => <ExpandKey context={context} /> }))
    }
    return () => {
      for (const release of claims) release()
    }
  },
})
