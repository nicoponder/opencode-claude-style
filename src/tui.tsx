/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { HomePrompt, SessionPrompt } from "./prompt"
import { registerExpandKey } from "./transcript"
import { Welcome } from "./welcome"

export const THEME = "claude-code"

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
  /** Name for "Welcome back <name>!". Defaults to config.username, then the OS user. */
  name?: string
  /**
   * Switch to the bundled `claude-code` theme the first time the plugin loads,
   * unless tui.json already pins a theme. Default: true.
   */
  activateTheme?: boolean
}

function readOptions(raw: unknown): Required<Omit<Options, "name">> & Pick<Options, "name"> {
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

const tui: TuiPlugin = async (api, rawOptions, meta) => {
  const options = readOptions(rawOptions)

  if (options.activateTheme && meta.state === "first" && !api.tuiConfig.theme && api.theme.has(THEME)) {
    api.theme.set(THEME)
  }

  if (options.transcript) api.lifecycle.onDispose(registerExpandKey(api))

  api.slots.register({
    order: 50,
    slots: {
      ...(options.banner && {
        home_logo() {
          return <Welcome api={api} name={options.name} />
        },
        // The banner already shows the directory and version, and Claude Code has
        // no footer, so replace OpenCode's home footer with nothing.
        home_footer() {
          return <box />
        },
      }),
      ...(options.prompt && {
        home_prompt(_ctx, props) {
          return <HomePrompt api={api} ref={props.ref} />
        },
      }),
      ...((options.prompt || options.spinner || options.transcript || options.usage) && {
        session_prompt(_ctx, props) {
          return (
            <SessionPrompt
              api={api}
              spinner={options.spinner}
              restyle={options.prompt}
              transcript={options.transcript}
              usage={options.usage}
              session_id={props.session_id}
              visible={props.visible}
              disabled={props.disabled}
              on_submit={props.on_submit}
              ref={props.ref}
            />
          )
        },
      }),
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-claude-style",
  tui,
}

export default plugin
