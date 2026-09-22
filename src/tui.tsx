/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { HomePrompt, SessionPrompt } from "./prompt"
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
   * Show a "✻ Pondering… (12s)" line above the prompt while a session is busy, then
   * "✻ Thought for 12s" once the turn is done. Default: true.
   */
  spinner?: boolean
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
    activateTheme: opts.activateTheme !== false,
    name: typeof opts.name === "string" && opts.name.trim() ? opts.name.trim() : undefined,
  }
}

const tui: TuiPlugin = async (api, rawOptions, meta) => {
  const options = readOptions(rawOptions)

  if (options.activateTheme && meta.state === "first" && !api.tuiConfig.theme && api.theme.has(THEME)) {
    api.theme.set(THEME)
  }

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
      ...((options.prompt || options.spinner) && {
        session_prompt(_ctx, props) {
          return (
            <SessionPrompt
              api={api}
              spinner={options.spinner}
              restyle={options.prompt}
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
