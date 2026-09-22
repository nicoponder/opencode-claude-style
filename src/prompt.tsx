/** @jsxImportSource @opentui/solid */
import type { Renderable, TuiPluginApi, TuiPromptRef } from "@opencode-ai/plugin/tui"
import type { RGBA, TextBufferRenderable } from "@opentui/core"
import { type JSX, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { formatClock, formatDuration, formatTokens, lastTurn, modeLabel, turnProgress, type TurnPart } from "./format"
import { claude, pick, spinnerFrames, spinnerVerbs, tips } from "./palette"
import { useTranscript } from "./transcript"
import { useUsageLine } from "./usage"
import { blankBar, find } from "./tree"

/** Left and right padding OpenCode puts around both the home screen and the session column. */
export const GUTTER = 2

/** `prompt.max_width` from tui.json, if the user set one. */
export function configuredMaxWidth(api: TuiPluginApi) {
  return (api.tuiConfig as { prompt?: { max_width?: number | "auto" } }).prompt?.max_width
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

/** What the prompt's hidden agent row says: the current agent, its color, and the input mode. */
type Mode = { agent: string; color: RGBA; shell: boolean }

/**
 * Claude Code's footer under the input: "⏵⏵ build mode on (tab to cycle)" or
 * "⏸ plan mode on (tab to cycle)", in the agent's color. It sits in the row where
 * OpenCode puts the prompt hint, so it drops the cycle hint, then the words, as
 * the terminal narrows and OpenCode's keybind hints need the space.
 */
function ModeLine(props: { api: TuiPluginApi; mode?: Mode; right: JSX.Element }) {
  const theme = () => props.api.theme.current
  const dims = useTerminalDimensions()
  const cycle = createMemo(() => {
    const bindings = props.api.keymap
      .getCommandBindings({ visibility: "registered", commands: ["agent.cycle"] })
      .get("agent.cycle")
    return props.api.keys.formatBindings(bindings) || "tab"
  })
  const text = () => {
    const mode = props.mode
    if (!mode) return
    const label = mode.shell ? { glyph: "!", name: "shell" } : modeLabel(mode.agent)
    const width = dims().width
    if (width < 50) return { main: label.glyph }
    const main = `${label.glyph} ${label.name} mode on`
    if (width < 70 || mode.shell) return { main }
    return { main, hint: ` (${cycle()} to cycle)` }
  }
  return (
    <box flexDirection="row" gap={1} marginLeft={2}>
      <Show when={text()}>
        {(t) => (
          <text wrapMode="none" selectable={false}>
            <span style={{ fg: props.mode!.color }}>{t().main}</span>
            <span style={{ fg: theme().textMuted }}>{t().hint ?? ""}</span>
          </text>
        )}
      </Show>
      {props.right}
    </box>
  )
}

/**
 * OpenCode's prompt, restyled like Claude Code's input:
 *
 * - Two horizontal rules frame it. OpenCode's prompt has a filled background
 *   instead, which this theme makes transparent, so without them nothing shows
 *   where the prompt is. The bottom rule overlays the blank row OpenCode leaves
 *   under the input (where a filled theme draws the panel's lower edge).
 * - The agent and model row inside the prompt is hidden. The agent moves to the
 *   mode line underneath, and the model isn't shown, as in Claude Code.
 * - OpenCode's colored bar left of the input is blanked, and Claude Code's `❯`
 *   (or `!` in shell mode) is drawn over its first row.
 *
 * Plugins can't configure the inside of the prompt, so these parts are found in
 * the rendered tree. If OpenCode's layout ever changes so they can't be found, the
 * prompt is left as OpenCode draws it and the mode line stays empty.
 */
function Restyled(props: {
  api: TuiPluginApi
  /** Run the rules out through OpenCode's gutter to the edges of the terminal. */
  bleed: boolean
  /** Lift OpenCode's max width on the home prompt's container. */
  uncap?: boolean
  /** Move the home prompt from the middle of the screen to the bottom. */
  anchor?: boolean
  visible?: boolean
  right: JSX.Element
  /**
   * Renders the prompt, given a function that makes the mode line to pass as its
   * hint. OpenCode swaps the hint out for "esc interrupt" while a turn runs and
   * destroys it, so it has to get a new one each time it shows it again.
   */
  children: (hint: () => JSX.Element) => JSX.Element
}) {
  const theme = () => props.api.theme.current
  const ruled = () => props.visible !== false && theme().backgroundElement.a === 0
  const edge = () => (props.bleed ? -GUTTER : 0)

  let box: Renderable | undefined
  let row: Renderable | undefined
  const [mode, setMode] = createSignal<Mode | undefined>(undefined, { equals: sameMode })
  const [marker, setMarker] = createSignal(false)

  // Restyle the prompt as soon as it's laid out, then keep reading the hidden agent
  // row: OpenCode still updates it when the agent changes, it just isn't drawn.
  const sync = () => {
    if (!box) return
    if (props.anchor) anchorToBottom(box)
    if (!row || row.isDestroyed) {
      row = agentRow(box)
      if (!row) return
      row.visible = false
      const input = row.parent
      if (input) {
        // Drop the blank line above the input so the rules hug it, and pull the
        // text in so it sits two columns after the `❯`, as in Claude Code.
        input.paddingTop = 0
        input.paddingLeft = 1
        if (input.parent) setMarker(blankBar(input.parent))
      }
    }
    const label = row.getChildren()[0]?.getChildren()[0] as Partial<Pick<TextBufferRenderable, "plainText" | "fg">> | undefined
    const agent = label?.plainText
    // In shell mode OpenCode swaps the agent's name for "Shell".
    setMode(agent && label.fg ? { agent, color: label.fg, shell: agent === "Shell" } : undefined)
  }
  onMount(() => {
    const timer = setTimeout(() => {
      if (props.uncap && box) uncap(box)
      sync()
    }, 0)
    const poll = setInterval(sync, 150)
    onCleanup(() => {
      clearTimeout(timer)
      clearInterval(poll)
    })
  })

  return (
    <box flexDirection="column" width="100%" ref={(r: Renderable) => (box = r)}>
      <Show when={ruled()}>
        <box height={1} marginLeft={edge()} marginRight={edge()} border={["top"]} borderColor={theme().border} />
      </Show>
      {props.children(() => <ModeLine api={props.api} mode={mode()} right={props.right} />)}
      <Show when={marker() && props.visible !== false && mode()}>
        {(m) => (
          <box position="absolute" top={ruled() ? 1 : 0} left={0} zIndex={1}>
            <text fg={m().shell ? m().color : theme().text} wrapMode="none" selectable={false}>
              {m().shell ? "!" : "❯"}
            </text>
          </box>
        )}
      </Show>
      <Show when={ruled()}>
        <box
          position="absolute"
          bottom={1}
          left={edge()}
          right={edge()}
          height={1}
          zIndex={1}
          border={["top"]}
          borderColor={theme().border}
        />
      </Show>
    </box>
  )
}

/**
 * OpenCode centers the home screen between two growing spacers, with its tips
 * under the prompt. Claude Code's prompt sits at the bottom of the terminal, so
 * stop the lower spacer growing and move whatever sits between the prompt and it
 * above the prompt. Safe to repeat: the tips can appear after the prompt does.
 */
function anchorToBottom(el: Renderable) {
  for (let node = el, depth = 0; node.parent && depth < 3; node = node.parent, depth++) {
    const parent = node.parent
    const siblings = parent.getChildren()
    const after = siblings.slice(siblings.indexOf(node) + 1)
    const spacer = after.find((s) => s.getLayoutNode().getFlexGrow() > 0)
    if (!spacer) continue
    for (const s of after.slice(0, after.indexOf(spacer))) if (s.visible) parent.insertBefore(s, node)
    spacer.flexGrow = 0
    return
  }
}

function sameMode(a: Mode | undefined, b: Mode | undefined) {
  if (!a || !b) return a === b
  return a.agent === b.agent && a.shell === b.shell && a.color.equals(b.color)
}

/**
 * The row under OpenCode's prompt input that shows "Build · Model Provider": the
 * sibling after the textarea. The textarea is the only descendant with extmarks.
 */
function agentRow(root: Renderable): Renderable | undefined {
  const textarea = find(root, (node) => "extmarks" in node && "plainText" in node)
  const siblings = textarea?.parent?.getChildren() ?? []
  const row = siblings[siblings.indexOf(textarea!) + 1]
  return row && row.getChildrenCount() > 0 ? row : undefined
}

export function HomePrompt(props: { api: TuiPluginApi; ref?: (ref: TuiPromptRef | undefined) => void }) {
  const Prompt = props.api.ui.Prompt
  const Slot = props.api.ui.Slot
  // OpenCode caps the home prompt at prompt.max_width, 75 columns by default. Claude
  // Code's prompt spans the terminal, so lift the cap unless the user set one.
  const fullWidth = configuredMaxWidth(props.api) === undefined
  return (
    <Restyled api={props.api} bleed={fullWidth} uncap={fullWidth} anchor right={<Slot name="home_prompt_right" />}>
      {(hint) => <Prompt ref={(r) => props.ref?.(r)} placeholders={placeholders} hint={hint()} />}
    </Restyled>
  )
}

/** Lift the nearest ancestor's maxWidth: the box OpenCode wraps the home prompt in. */
function uncap(el: Renderable) {
  for (let node = el.parent, depth = 0; node && depth < 4; node = node.parent, depth++) {
    // Yoga reports an unset maxWidth with unit 0 (Undefined).
    if (node.getLayoutNode().getMaxWidth().unit === 0) continue
    // opentui ignores null here, so "100%" is how to clear it.
    node.maxWidth = "100%"
    return
  }
}

export function SessionPrompt(props: {
  api: TuiPluginApi
  spinner: boolean
  restyle: boolean
  transcript: boolean
  usage: boolean
  session_id: string
  visible?: boolean
  disabled?: boolean
  on_submit?: () => void
  ref?: (ref: TuiPromptRef | undefined) => void
}) {
  const Prompt = props.api.ui.Prompt
  const Slot = props.api.ui.Slot
  const right = () => <Slot name="session_prompt_right" session_id={props.session_id} />
  let box: Renderable | undefined
  if (props.transcript) useTranscript(props.api, () => props.session_id, () => box)
  if (props.usage) useUsageLine(props.api, () => props.session_id, () => box)
  const prompt = (extra: { hint?: () => JSX.Element; right?: JSX.Element }) => (
    <Prompt
      sessionID={props.session_id}
      visible={props.visible}
      disabled={props.disabled}
      onSubmit={() => props.on_submit?.()}
      ref={(r) => props.ref?.(r)}
      placeholders={props.restyle ? placeholders : undefined}
      hint={extra.hint?.()}
      right={extra.right}
    />
  )
  return (
    <box flexDirection="column" width="100%" ref={(r: Renderable) => (box = r)}>
      <Show when={props.spinner && props.visible !== false}>
        <Status api={props.api} sessionID={props.session_id} inline={props.transcript} />
      </Show>
      <Show when={props.restyle} fallback={prompt({ right: right() })}>
        <Restyled api={props.api} visible={props.visible} bleed={true} right={right()}>
          {(hint) => prompt({ hint })}
        </Restyled>
      </Show>
    </box>
  )
}

/**
 * The lines above the prompt: Claude Code's spinner while the session is busy.
 * Once the turn has finished, "✻ Thought for 12s · done 4:00 PM", unless the
 * transcript already shows that after the reply (`inline`).
 */
function Status(props: { api: TuiPluginApi; sessionID: string; inline: boolean }) {
  const theme = () => props.api.theme.current
  const busy = createMemo(() => {
    const status = props.api.state.session.status(props.sessionID)
    return !!status && status.type !== "idle"
  })
  const thought = createMemo(() => {
    if (busy() || props.inline) return
    const turn = lastTurn(props.api.state.session.messages(props.sessionID))
    if (!turn?.end || turn.failed) return
    return `${formatDuration(turn.end - turn.start)} · done ${formatClock(turn.end)}`
  })
  return (
    <Switch>
      <Match when={busy()}>
        <Spinner api={props.api} sessionID={props.sessionID} />
      </Match>
      <Match when={thought()}>
        <box flexDirection="row" paddingBottom={1} flexShrink={0}>
          <text fg={theme().textMuted} wrapMode="none">
            ✻ Thought for {thought()}
          </text>
        </box>
      </Match>
    </Switch>
  )
}

/**
 * Claude Code's status line while the session is busy:
 * "✻ Pondering… (12s · ↓ 1.2k tokens · thinking)", timed from your message, with
 * a tip underneath. The glyph cycles and the verb shimmers.
 */
function Spinner(props: { api: TuiPluginApi; sessionID: string }) {
  const theme = () => props.api.theme.current
  const [tick, setTick] = createSignal(0)
  const mounted = Date.now()
  const verb = randomVerb()
  const tip = tips[Math.floor(Math.random() * tips.length)]
  const timer = setInterval(() => setTick((t) => t + 1), 120)
  onCleanup(() => clearInterval(timer))

  const progress = createMemo(() =>
    turnProgress(props.api.state.session.messages(props.sessionID), (id) => props.api.state.part(id) as ReadonlyArray<TurnPart>),
  )
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
  const shimmer = () => pick(claude.shimmer, props.api.theme.mode())
  const label = () => `${verb}…`
  // A three-character highlight that sweeps across the verb, then pauses briefly.
  const sweep = () => (tick() % (label().length + 8)) - 2

  return (
    <box flexDirection="column" paddingBottom={1} flexShrink={0}>
      <text wrapMode="none" selectable={false}>
        <span style={{ fg: claude.body }}>{glyph()} </span>
        <For each={Array.from(label())}>
          {(char, i) => <span style={{ fg: Math.abs(i() - sweep()) <= 1 ? shimmer() : claude.body }}>{char}</span>}
        </For>
        <span style={{ fg: theme().textMuted }}> ({details()})</span>
      </text>
      <text fg={theme().textMuted} wrapMode="none" selectable={false}>
        {"  ⎿  Tip: "}
        {tip}
      </text>
    </box>
  )
}

function randomVerb() {
  return spinnerVerbs[Math.floor(Math.random() * spinnerVerbs.length)]
}
