/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import type { SlotMap } from "@opencode/plugin/tui/context"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import {
  contextUsage,
  contextWarning,
  formatCount,
  formatReset,
  lastTurn,
  type Limits,
  type ModelInfo,
  usageBar,
  usageLine,
} from "./format"
import { type Credential, fetchLimits, hasLimits } from "./limits"
import { turnMessages } from "./data"
import { claude } from "./palette"

type Context = Plugin.Context

const REFRESH = 5 * 60_000
const AFTER_TURN = 30_000

/** Limits by provider, shared by every prompt so switching sessions doesn't refetch. */
const cache = new Map<string, { limits?: Limits; at: number }>()
const pending = new Set<string>()
const [version, setVersion] = createSignal(0)

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

export const LIMITS_COMMAND = "claude.usage.limits"

const credentials = (context: Context) => async () =>
  ((await context.client.credential.list().catch(() => [])) ?? []) as ReadonlyArray<Credential>

/**
 * Fetch a provider's limits into the shared cache, unless a fetch is already
 * going or the cached ones are newer than `maxAge` milliseconds.
 */
function requestLimits(context: Context, providerID: string, maxAge: number) {
  if (!hasLimits(providerID) || pending.has(providerID)) return
  const entry = cache.get(providerID)
  if (entry && Date.now() - entry.at < maxAge) return
  pending.add(providerID)
  fetchLimits(providerID, credentials(context)).then((limits) => {
    pending.delete(providerID)
    cache.set(providerID, { limits, at: Date.now() })
    setVersion((v) => v + 1)
  })
}

/** A session's usage: its tokens, how full the context is (of how big a window), and the provider. */
function sessionUsage(context: Context, sessionID: string | undefined) {
  const session = sessionID ? context.data.session.get(sessionID) : undefined
  if (!sessionID || !session) return
  const models = (context.data.location.model.list(session.location) ?? []) as ReadonlyArray<ModelInfo>
  const usage = contextUsage(context.data.session.message.list(sessionID), models, session.revert?.messageID)
  return usage && { ...usage, location: session.location }
}

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
  const usage = createMemo(() => sessionUsage(context, props.input.sessionID))
  const hints = createMemo(() =>
    [
      { key: key("agent.cycle"), label: "agents" },
      { key: key("command.palette.show"), label: "commands" },
    ].filter((hint): hint is { key: string; label: string } => !!hint.key),
  )

  /**
   * What fits: the context warning comes first, then the usage line drops parts
   * (see usageLine) to leave room for the hints, and the hints go when they don't
   * fit either. OpenCode leaves the left of the row up to 28 columns, or half the
   * row, for the mode line.
   */
  const layout = createMemo(() => {
    version()
    const width = Math.max(0, dims().width - 8)
    const warning = contextWarning(usage()?.percent)
    const extra = (counts() ? counts().length + 3 : 0) + (warning ? warning.length + 2 : 0)
    const room = width - Math.min(28, Math.floor(width / 2)) - extra
    const hintText = hints()
      .map((hint) => `${hint.key} ${hint.label}`)
      .join("  ")
    const u = usage()
    const id = props.input.sessionID
    if (!u || !id) return { usage: "", hints: dims().width >= 44 && hintText.length <= room, warning }
    const cost = context.data.session.cost(id)
    const input = {
      tokens: u.tokens,
      percent: u.percent,
      cost: cost > 0 ? usd.format(cost) : undefined,
      limits: cache.get(u.providerID)?.limits,
    }
    const withHints = usageLine(input, room - hintText.length - 2)
    if (hintText && withHints) return { usage: withHints, hints: true, warning }
    return { usage: usageLine(input, room), hints: false, warning }
  })

  const refresh = () => {
    const providerID = usage()?.providerID
    const id = props.input.sessionID
    if (!id || !providerID) return
    // Every 5 minutes, or 30 seconds after a turn that ended since the last fetch.
    const at = cache.get(providerID)?.at ?? 0
    const ended = lastTurn(turnMessages(context, id))?.end ?? 0
    requestLimits(context, providerID, ended > at ? AFTER_TURN : REFRESH)
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
        <Show when={layout().warning}>
          {(warning: () => string) => (
            <text fg={theme().text.feedback.warning.base} wrapMode="none" flexShrink={0}>
              {warning()}
            </text>
          )}
        </Show>
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

/**
 * /limits: this session's usage and, for a ChatGPT Plus/Pro or Claude Pro/Max
 * login, the 5-hour and 7-day limits with when they reset, like Claude Code's
 * /usage. (OpenCode's own /usage shows OpenCode workspace limits, so it keeps
 * that name.)
 */
export function LimitsCommand(props: { context: Context }) {
  const context = props.context
  // Global, as OpenCode's own /btw is: slash completion only offers those.
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: LIMITS_COMMAND,
        title: "Show session usage and subscription limits",
        group: "Session",
        palette: true,
        slash: { name: "limits" },
        run() {
          const route = context.ui.router.current()
          const sessionID = route.type === "session" ? route.sessionID : undefined
          const providerID = sessionUsage(context, sessionID)?.providerID
          if (providerID) requestLimits(context, providerID, AFTER_TURN)
          context.ui.dialog.show(() => <LimitsDialog context={context} sessionID={sessionID} />)
          context.ui.dialog.set({ size: "medium" })
        },
      },
    ],
    bindings: [LIMITS_COMMAND],
  }))
  return null
}

function LimitsDialog(props: { context: Context; sessionID?: string }) {
  const context = props.context
  const theme = () => context.theme
  const usage = createMemo(() => sessionUsage(context, props.sessionID))
  const limits = createMemo(() => {
    version()
    const id = usage()?.providerID
    return id ? cache.get(id)?.limits : undefined
  })
  const loading = () => {
    version()
    const id = usage()?.providerID
    return !!id && (pending.has(id) || !cache.has(id))
  }
  const provider = () => {
    const u = usage()
    if (!u) return ""
    return context.data.location.provider.list(u.location)?.find((p) => p.id === u.providerID)?.name ?? u.providerID
  }
  const cost = () => (props.sessionID ? context.data.session.cost(props.sessionID) : 0)
  const windows = () => {
    const l = limits()
    if (!l) return []
    return [
      { label: "5-hour", used: l.fiveHour, resets: l.fiveHourResets },
      { label: "7-day ", used: l.sevenDay, resets: l.sevenDayResets },
    ].filter((w): w is { label: string; used: number; resets: number | undefined } => w.used !== undefined)
  }
  const muted = () => theme().text.muted
  // One text with explicit line breaks: OpenCode's dialog container collapses
  // blank rows between separate elements.
  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <text wrapMode="word">
        <span style={{ fg: theme().text.base, attributes: TextAttributes.BOLD }}>Usage</span>
        {"\n\n"}
        <Show when={usage()} fallback={<span style={{ fg: muted() }}>Open a session to see its usage.</span>}>
          {(u: () => NonNullable<ReturnType<typeof usage>>) => (
            <>
              <span style={{ fg: muted() }}>{"This session\n"}</span>
              <span style={{ fg: theme().text.base }}>
                {`  ${formatCount(u().tokens)} tokens`}
                {u().percent !== undefined ? ` · ${u().percent}% of the context window` : ""}
                {cost() > 0 ? ` · ${usd.format(cost())}` : ""}
              </span>
              {"\n\n"}
              <Show
                when={hasLimits(u().providerID)}
                fallback={
                  <span style={{ fg: muted() }}>
                    {`${provider()} has no 5-hour or 7-day limits to show. They're read for ChatGPT Plus/Pro and Claude Pro/Max logins.`}
                  </span>
                }
              >
                <span style={{ fg: muted() }}>{`${provider()} subscription`}</span>
                <Show
                  when={windows().length}
                  fallback={
                    <span style={{ fg: muted() }}>
                      {loading() ? "\n  Loading…" : "\n  Not signed in with a subscription, or its limits couldn't be read."}
                    </span>
                  }
                >
                  <For each={windows()}>
                    {(w) => (
                      <>
                        <span style={{ fg: theme().text.base }}>{`\n  ${w.label}  `}</span>
                        <span style={{ fg: w.used >= 80 ? theme().text.feedback.warning.base : claude.body }}>
                          {usageBar(w.used)}
                        </span>
                        <span style={{ fg: theme().text.base }}>{`  ${Math.round(w.used)}% used`}</span>
                        <span style={{ fg: muted() }}>{w.resets ? ` · resets ${formatReset(w.resets)}` : ""}</span>
                      </>
                    )}
                  </For>
                </Show>
              </Show>
            </>
          )}
        </Show>
        <span style={{ fg: muted() }}>{"\n\nesc to close"}</span>
      </text>
    </box>
  )
}
