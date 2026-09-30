/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import type { SlotMap } from "@opencode/plugin/tui/context"
import type { RGBA, Renderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, getOwner, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import {
  formatClock,
  formatDuration,
  formatTokens,
  lastTurn,
  modeLabel,
  truncateEnd,
  turnProgress,
  turnVerb,
} from "./format"
import { turnMessages } from "./data"
import { claude, pick, spinnerFrames, spinnerVerbs, tips } from "./palette"
import type { ResolvedOptions } from "./tui"
import { type Detached, detach } from "./detach"
import { blankBar, drawn, find, idOf, interceptSetter, isTextarea, placeBefore, placeIn, textOf, debug } from "./tree"
import { useTranscript } from "./transcript"
import { useUsageLine } from "./usage"

type Context = Plugin.Context
type FooterInput = SlotMap["prompt.footer"]

/** The padding OpenCode puts on each side of the home screen and the session column. */
export function gutter(width: number) {
  return width < 44 ? 1 : 2
}

/** Placeholder examples phrased like Claude Code's `Try "…"` suggestions. */
export const placeholders = {
  normal: [
    "fix lint errors",
    "how does <filepath> work?",
    "refactor <filepath>",
    "write a test for <filepath>",
    "edit <filepath> to...",
  ],
  shell: ["git status", "ls -la", "npm test"],
}

/** What the prompt's hidden agent row says: the current agent and its color. */
type Agent = { name: string; color: RGBA }

/**
 * The parts of OpenCode's prompt this restyles, found from the footer row our
 * mode line sits in. The prompt is a box holding, in order: the input box with
 * the colored bar down its left, a blank row under it, and the footer row.
 */
function promptParts(footer: Renderable, ours: WeakSet<Renderable>) {
  const anchor = footer.parent
  if (!anchor) return
  const rows = drawn(anchor).filter((node) => !ours.has(node))
  const index = rows.indexOf(footer)
  const bar = rows[index - 2]
  const blank = rows[index - 1]
  if (!bar || !blank) return
  const textarea = find(bar, isTextarea)
  const input = textarea?.parent
  if (!textarea || !input) return
  // The agent and model row: the sibling after the text input.
  const siblings = drawn(input)
  const meta = siblings[siblings.indexOf(textarea) + 1]
  return { anchor, bar, blank, input, textarea, meta }
}

function sameAgent(a: Agent | undefined, b: Agent | undefined) {
  if (!a || !b) return a === b
  return a.name === b.name && a.color.equals(b.color)
}

/**
 * Everything under and around OpenCode's prompt, from one component OpenCode
 * mounts at the start of the prompt's footer row (on the home screen and in
 * sessions alike):
 *
 * - Claude Code's mode line, "⏵⏵ build mode on (shift+tab to cycle)", in the
 *   agent's color, where OpenCode shows the directory.
 * - The prompt restyled like Claude Code's input: two full-width rules around it,
 *   `❯` in place of the colored bar, no agent and model row (the agent moves to
 *   the mode line; the model isn't shown, as in Claude Code), and Claude Code's
 *   placeholder suggestions.
 * - The usage line, "14.9k | ctx 25% | 5h: 48% | 7d: 6%", in place of OpenCode's.
 *
 * Plugins can't configure the inside of the prompt, so its parts are found in the
 * rendered tree. If OpenCode's layout changes so they can't be found, the prompt
 * is left as OpenCode draws it and the mode line stays empty.
 */
export function PromptChrome(props: { context: Context; options: ResolvedOptions; input: FooterInput }) {
  const context = props.context
  const theme = () => context.theme
  const dims = useTerminalDimensions()
  const owner = getOwner()
  const ours = new WeakSet<Renderable>()
  let row: Renderable | undefined
  const [agent, setAgent] = createSignal<Agent | undefined>(undefined, { equals: sameAgent })
  const busy = () => !!props.input.sessionID && context.data.session.status(props.input.sessionID) === "running"
  const restyle = props.options.prompt
  const showMode = () => restyle && !busy()

  if (props.options.usage) useUsageLine(context, () => props.input.sessionID, () => row?.parent ?? undefined, ours)

  const ruled = () => theme().decrease(theme().background.raised.base).a === 0
  const edge = () => -gutter(dims().width)
  const rule = () => (
    <box height={1} marginLeft={edge()} marginRight={edge()} flexShrink={0} border={["top"]} borderColor={theme().border.base} />
  )
  const nodes: Detached<null>[] = []
  const make = (render: () => unknown) => {
    const d = detach(owner, null, render)
    ours.add(d.node)
    nodes.push(d)
    return d.node
  }
  let top: Renderable | undefined
  let bottom: Renderable | undefined
  let marker: Renderable | undefined
  let hidden: Renderable[] = []
  const patched = new WeakSet<Renderable>()

  const syncUnsafe = () => {
    if (!row || row.isDestroyed || !row.parent) return
    const footer = row.parent
    // OpenCode's directory label, which the mode line takes the place of.
    const location = find(footer, (node) => idOf(node) === "prompt.footer.location")
    if (location) location.visible = !showMode()
    if (!restyle) return
    const parts = promptParts(footer, ours)
    if (!parts) return
    const label = parts.meta && find(parts.meta, (node) => textOf(node) !== undefined && textOf(node) !== "")
    const name = textOf(label)
    const color = (label as { fg?: RGBA } | undefined)?.fg
    // In a narrow terminal OpenCode drops the agent from the row; keep the last one.
    const here = context.location ?? context.data.location.default()
    const known = (context.data.location.agent.list(here) ?? []).some(
      (a) => a.id.toLowerCase() === name?.toLowerCase() || a.name.toLowerCase() === name?.toLowerCase(),
    )
    if (name && color && known) setAgent({ name, color })

    if (!patched.has(parts.bar)) {
      patched.add(parts.bar)
      blankBar(parts.bar)
      placeholder(parts.textarea)
    }
    // Drop the blank line above the input so the rules hug it, and pull the text
    // in so it sits two columns after the `❯`, as in Claude Code.
    if (parts.input.paddingTop !== 0) parts.input.paddingTop = 0
    if (parts.input.paddingLeft !== 1) parts.input.paddingLeft = 1
    for (const node of [parts.meta, parts.blank]) {
      if (node && node.visible) node.visible = false
    }
    hidden = [parts.meta, parts.blank].filter((node): node is Renderable => !!node)

    top ??= make(rule)
    bottom ??= make(rule)
    marker ??= make(() => (
      <box position="absolute" top={ruled() ? 1 : 0} left={0} zIndex={1}>
        <text fg={props.input.mode === "shell" ? theme().text.action.primary.selected : theme().text.base} wrapMode="none" selectable={false}>
          {props.input.mode === "shell" ? "!" : "❯"}
        </text>
      </box>
    ))
    top.visible = ruled()
    bottom.visible = ruled()
    placeBefore(top, parts.bar)
    placeBefore(bottom, footer)
    placeIn(marker, parts.anchor)
  }

  /**
   * Claude Code's suggestions in place of OpenCode's: `Try "fix lint errors"`.
   * OpenCode rotates its placeholder every so often; each time it does, the next
   * suggestion here shows instead.
   */
  function placeholder(textarea: Renderable) {
    let seen: unknown
    let turn = -1
    interceptSetter<unknown>(textarea, "placeholder", (value, set) => {
      if (typeof value !== "string" || !value) return set(value)
      if (value !== seen) turn++
      seen = value
      const shell = value.startsWith("Run a command")
      const list = shell ? placeholders.shell : placeholders.normal
      const example = list[turn % list.length]
      const text = shell ? `Run a command… "${example}"` : `Try "${example}"`
      set(truncateEnd(text, Math.max(1, dims().width - 2 * gutter(dims().width) - 4)))
    })
    // Go through the wrapper once, for the placeholder already showing.
    const input = textarea as unknown as { placeholder: unknown }
    if (typeof input.placeholder === "string") input.placeholder = input.placeholder
  }

  const sync = () => {
    try {
      syncUnsafe()
    } catch (error) {
      debug("sync failed", error)
    }
  }

  onMount(() => {
    const timer = setTimeout(sync, 0)
    const poll = setInterval(sync, 150)
    onCleanup(() => {
      clearTimeout(timer)
      clearInterval(poll)
      for (const node of hidden) if (!node.isDestroyed) node.visible = true
      for (const node of nodes) node.dispose()
    })
  })

  return (
    <box ref={(r: Renderable) => (row = r)} flexDirection="row" flexShrink={0} marginLeft={showMode() ? 2 : 0}>
      <Show when={showMode()}>
        <ModeLine context={context} agent={agent()} shell={props.input.mode === "shell"} />
      </Show>
    </box>
  )
}

/**
 * Claude Code's footer under the input: "⏵⏵ build mode on (shift+tab to cycle)"
 * or "⏸ plan mode on (shift+tab to cycle)", in the agent's color. It drops the
 * cycle hint, then the words, as the terminal narrows.
 */
function ModeLine(props: { context: Context; agent?: Agent; shell: boolean }) {
  const theme = () => props.context.theme
  const dims = useTerminalDimensions()
  const cycle = () => props.context.keymap.shortcuts("agent.cycle")[0] ?? "tab"
  const text = (): { main: string; hint?: string } | undefined => {
    if (!props.agent && !props.shell) return
    const label = props.shell ? { glyph: "!", name: "shell" } : modeLabel(props.agent!.name)
    const width = dims().width
    if (width < 50) return { main: label.glyph }
    const main = `${label.glyph} ${label.name} mode on`
    if (width < 70 || props.shell) return { main }
    return { main, hint: ` (${cycle()} to cycle)` }
  }
  const color = () => {
    if (props.shell) return theme().text.action.primary.selected
    const name = props.agent?.name.toLowerCase()
    const location = props.context.location ?? props.context.data.location.default()
    const info = props.context.data.location.agent.list(location)?.find((a) => a.id === name || a.name.toLowerCase() === name)
    // Claude Code's colors for the two built-in modes, unless you've picked one.
    // Every theme has these base hues, though the types only list the semantic ones.
    const hue = theme().hue as unknown as Record<string, Record<number, RGBA> | undefined>
    if (!info?.color && name === "build") return hue.purple?.[200] ?? props.agent?.color
    if (!info?.color && name === "plan") return hue.cyan?.[200] ?? props.agent?.color
    return props.agent?.color
  }
  return (
    <Show when={text()}>
      {(t: () => { main: string; hint?: string }) => (
        <text wrapMode="none" selectable={false}>
          <span style={{ fg: color() }}>{t().main}</span>
          <span style={{ fg: theme().text.muted }}>{t().hint ?? ""}</span>
        </text>
      )}
    </Show>
  )
}

/**
 * The lines above the prompt: Claude Code's spinner while the session is busy.
 * Once the turn has finished, "✻ Worked for 12s · done 4:00 PM", unless the
 * transcript already shows that after the reply.
 */
export function Status(props: { context: Context; options: ResolvedOptions; sessionID: string }) {
  const context = props.context
  const theme = () => context.theme
  let box: Renderable | undefined
  if (props.options.transcript) useTranscript(context, () => props.sessionID, () => box)
  const busy = () => context.data.session.status(props.sessionID) === "running"
  const thought = createMemo(() => {
    if (busy() || props.options.transcript) return
    const messages = turnMessages(context, props.sessionID)
    const turn = lastTurn(messages)
    const user = messages.findLast((m) => m.type === "user")
    if (!turn?.end || turn.failed || !user) return
    return `${turnVerb(user.id)} for ${formatDuration(turn.end - turn.start)} · done ${formatClock(turn.end)}`
  })
  return (
    <box ref={(r: Renderable) => (box = r)} flexDirection="column" flexShrink={0}>
      <Show when={props.options.spinner}>
        <Switch>
          <Match when={busy()}>
            <Spinner context={context} sessionID={props.sessionID} />
          </Match>
          <Match when={thought()}>
            <box flexDirection="row" paddingBottom={1} flexShrink={0}>
              <text fg={theme().text.muted} wrapMode="none">
                ✻ {thought()}
              </text>
            </box>
          </Match>
        </Switch>
      </Show>
    </box>
  )
}

/**
 * Claude Code's status line while the session is busy:
 * "✻ Pondering… (12s · ↓ 1.2k tokens · thinking)", timed from your message, with
 * a tip underneath. The glyph cycles and the verb shimmers.
 */
function Spinner(props: { context: Context; sessionID: string }) {
  const theme = () => props.context.theme
  const [tick, setTick] = createSignal(0)
  const mounted = Date.now()
  const verb = spinnerVerbs[Math.floor(Math.random() * spinnerVerbs.length)]
  const tip = tips[Math.floor(Math.random() * tips.length)]
  const timer = setInterval(() => setTick((t) => t + 1), 120)
  onCleanup(() => clearInterval(timer))

  const progress = createMemo(() => turnProgress(turnMessages(props.context, props.sessionID)))
  const glyph = () => spinnerFrames[tick() % spinnerFrames.length]
  const details = () => {
    tick()
    const p = progress()
    return [
      formatDuration(Date.now() - (p?.start ?? mounted)),
      p?.tokens ? `↓ ${formatTokens(p.tokens)}` : undefined,
      p?.thinking ? "thinking" : undefined,
    ]
      .filter(Boolean)
      .join(" · ")
  }
  const shimmer = () => pick(claude.shimmer, props.context.themeMode)
  const label = `${verb}…`
  // A three-character highlight that sweeps across the verb, then pauses briefly.
  const sweep = () => (tick() % (label.length + 8)) - 2

  return (
    <box flexDirection="column" paddingBottom={1} flexShrink={0}>
      <text wrapMode="none" selectable={false}>
        <span style={{ fg: claude.body }}>{glyph()} </span>
        <For each={Array.from(label)}>
          {(char, i) => <span style={{ fg: Math.abs(i() - sweep()) <= 1 ? shimmer() : claude.body }}>{char}</span>}
        </For>
        <span style={{ fg: theme().text.muted }}> ({details()})</span>
      </text>
      <text fg={theme().text.muted} wrapMode="none" selectable={false}>
        {"  ⎿  Tip: "}
        {tip}
      </text>
    </box>
  )
}
