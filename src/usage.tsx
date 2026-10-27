/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import type { SlotMap } from "@opencode/plugin/tui/context"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { contextUsage, lastTurn, type Limits, type ModelInfo, usageLine } from "./format"
import { type Credential, fetchLimits, hasLimits } from "./limits"
import { turnMessages } from "./data"

type Context = Plugin.Context

const REFRESH = 5 * 60_000
const AFTER_TURN = 30_000

/** Limits by provider, shared by every prompt so switching sessions doesn't refetch. */
const cache = new Map<string, { limits?: Limits; at: number }>()
const pending = new Set<string>()
const [version, setVersion] = createSignal(0)

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/**
 * The right of the prompt's footer, in place of OpenCode's built-in footer plugin
 * (`opencode.prompt.footer`, which has to be turned off in cli.json): running
 * subagents and shells, "15.9k | ctx 8% | 5h: 48% | 7d: 6%", and the
 * `shift+tab agents` and `ctrl+p commands` hints. The 5h and 7d parts show only
 * for a ChatGPT or Claude subscription (see limits.ts). The limits are fetched
 * when the session is opened, 30 seconds or more after each turn, and every 5
 * minutes.
 */
export function UsageFooter(props: { context: Context; input: SlotMap["prompt.footer"] }) {
  const context = props.context
  const theme = () => context.theme
  const dims = useTerminalDimensions()
  const [hovered, setHovered] = createSignal(false)
  const key = (command: string) => context.keymap.shortcuts(command)[0]

  const counts = createMemo(() => {
    const id = props.input.sessionID
    if (!id) return ""
    const subagents = context.data.session
      .family(id)
      .filter((child) => child !== id && context.data.session.status(child) === "running").length
    const shells = context.data.shell.list(context.location).filter((shell) => shell.metadata.sessionID === id).length
    return [subagents ? plural(subagents, "subagent") : "", shells ? plural(shells, "shell") : ""].filter(Boolean).join(" · ")
  })
  const usage = createMemo(() => {
    const id = props.input.sessionID
    const session = id ? context.data.session.get(id) : undefined
    if (!id || !session) return
    const models = (context.data.location.model.list(session.location) ?? []) as ReadonlyArray<ModelInfo>
    return contextUsage(context.data.session.message.list(id), models, session.revert?.messageID)
  })
  const hints = createMemo(() =>
    [
      { key: key("agent.cycle"), label: "agents" },
      { key: key("command.palette.show"), label: "commands" },
    ].filter((hint): hint is { key: string; label: string } => !!hint.key),
  )

  /**
   * What fits: the usage line drops parts (see usageLine) to leave room for the
   * hints, and the hints go when they don't fit either. OpenCode leaves the left
   * of the row up to 28 columns, or half the row, for the mode line.
   */
  const layout = createMemo(() => {
    version()
    const width = Math.max(0, dims().width - 8)
    const extra = counts() ? counts().length + 3 : 0
    const room = width - Math.min(28, Math.floor(width / 2)) - extra
    const hintText = hints()
      .map((hint) => `${hint.key} ${hint.label}`)
      .join("  ")
    const u = usage()
    const id = props.input.sessionID
    if (!u || !id) return { usage: "", hints: dims().width >= 44 && hintText.length <= room }
    const cost = context.data.session.cost(id)
    const input = {
      tokens: u.tokens,
      percent: u.percent,
      cost: cost > 0 ? usd.format(cost) : undefined,
      limits: cache.get(u.providerID)?.limits,
    }
    const withHints = usageLine(input, room - hintText.length - 2)
    if (hintText && withHints) return { usage: withHints, hints: true }
    return { usage: usageLine(input, room), hints: false }
  })

  const credentials = async () =>
    ((await context.client.credential.list().catch(() => [])) ?? []) as ReadonlyArray<Credential>

  const refresh = () => {
    const providerID = usage()?.providerID
    const id = props.input.sessionID
    if (!id || !providerID || !hasLimits(providerID) || pending.has(providerID)) return
    const entry = cache.get(providerID)
    const ended = lastTurn(turnMessages(context, id))?.end ?? 0
    const age = Date.now() - (entry?.at ?? 0)
    if (entry && age < REFRESH && !(ended > entry.at && age > AFTER_TURN)) return
    pending.add(providerID)
    fetchLimits(providerID, credentials).then((limits) => {
      pending.delete(providerID)
      cache.set(providerID, { limits, at: Date.now() })
      setVersion((v) => v + 1)
    })
  }

  onMount(() => {
    refresh()
    const timer = setInterval(refresh, 1000)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <Show
      when={props.input.mode === "normal"}
      fallback={
        <text fg={theme().text.base} wrapMode="none" flexShrink={0}>
          {"esc "}
          <span style={{ fg: theme().text.muted }}>{dims().width < 44 ? "shell" : "exit shell mode"}</span>
        </text>
      }
    >
      <box flexDirection="row" gap={2} flexShrink={0}>
        <Show when={counts() || (props.input.showDetails && layout().usage)}>
          <box flexDirection="row" flexShrink={0}>
            <Show when={counts()}>
              <box
                flexShrink={0}
                onMouseOver={() => setHovered(true)}
                onMouseOut={() => setHovered(false)}
                onMouseUp={() => context.keymap.dispatch("session.child.first")}
              >
                <text fg={hovered() ? theme().text.base : theme().text.muted} wrapMode="none">
                  {key("session.child.first") ? `${key("session.child.first")} ` : ""}
                  {counts()}
                </text>
              </box>
            </Show>
            <Show when={props.input.showDetails && layout().usage}>
              <text fg={theme().text.muted} wrapMode="none" flexShrink={0}>
                {counts() ? " · " : ""}
                {layout().usage}
              </text>
            </Show>
          </box>
        </Show>
        <Show when={props.input.showDetails && layout().hints}>
          <For each={hints()}>
            {(hint) => (
              <text fg={theme().text.base} wrapMode="none" flexShrink={0}>
                {hint.key} <span style={{ fg: theme().text.muted }}>{hint.label}</span>
              </text>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}
