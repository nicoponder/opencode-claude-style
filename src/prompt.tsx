/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi, TuiPromptRef } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { claude, pick, spinnerFrames, spinnerVerbs } from "./palette"

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

/**
 * Dim hint under the prompt, in the spot where Claude Code shows "? for shortcuts".
 * It shares a row with OpenCode's own keybind hints, so it shortens and then hides
 * itself as the terminal narrows.
 */
function Hint(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const dims = useTerminalDimensions()
  const text = () => {
    const width = Math.min(dims().width - 4, 75)
    if (width >= 64) return "/ for commands · ! for shell"
    if (width >= 50) return "! for shell"
    return ""
  }
  return (
    <box marginLeft={1}>
      <text fg={theme().textMuted} wrapMode="none">
        {text()}
      </text>
    </box>
  )
}

export function HomePrompt(props: { api: TuiPluginApi; ref?: (ref: TuiPromptRef | undefined) => void }) {
  const Prompt = props.api.ui.Prompt
  const Slot = props.api.ui.Slot
  return (
    <Prompt
      ref={(r) => props.ref?.(r)}
      placeholders={placeholders}
      hint={<Hint api={props.api} />}
      right={<Slot name="home_prompt_right" />}
    />
  )
}

export function SessionPrompt(props: {
  api: TuiPluginApi
  spinner: boolean
  placeholders: boolean
  session_id: string
  visible?: boolean
  disabled?: boolean
  on_submit?: () => void
  ref?: (ref: TuiPromptRef | undefined) => void
}) {
  const Prompt = props.api.ui.Prompt
  const Slot = props.api.ui.Slot
  return (
    <box flexDirection="column" width="100%">
      <Show when={props.spinner && props.visible !== false}>
        <Spinner api={props.api} sessionID={props.session_id} />
      </Show>
      <Prompt
        sessionID={props.session_id}
        visible={props.visible}
        disabled={props.disabled}
        onSubmit={() => props.on_submit?.()}
        ref={(r) => props.ref?.(r)}
        placeholders={props.placeholders ? placeholders : undefined}
        right={<Slot name="session_prompt_right" session_id={props.session_id} />}
      />
    </box>
  )
}

/**
 * Claude Code's "✻ Pondering… (12s)" status line, shown above the prompt while the
 * session is busy. Purely decorative: the glyph cycles, the verb shimmers.
 */
function Spinner(props: { api: TuiPluginApi; sessionID: string }) {
  const theme = () => props.api.theme.current
  const busy = createMemo(() => {
    const status = props.api.state.session.status(props.sessionID)
    return !!status && status.type !== "idle"
  })

  const [tick, setTick] = createSignal(0)
  const [started, setStarted] = createSignal(Date.now())
  const [verb, setVerb] = createSignal(randomVerb())

  createEffect(
    on(busy, (isBusy) => {
      if (!isBusy) return
      setStarted(Date.now())
      setVerb(randomVerb())
      setTick(0)
      const timer = setInterval(() => setTick((t) => t + 1), 120)
      onCleanup(() => clearInterval(timer))
    }),
  )

  const glyph = () => spinnerFrames[tick() % spinnerFrames.length]
  const elapsed = () => {
    tick()
    return Math.floor((Date.now() - started()) / 1000)
  }
  const shimmer = () => pick(claude.shimmer, props.api.theme.mode())
  const label = () => `${verb()}…`
  // A three-character highlight that sweeps across the verb, then pauses briefly.
  const sweep = () => (tick() % (label().length + 8)) - 2

  return (
    <Show when={busy()}>
      <box flexDirection="row" paddingLeft={1} paddingBottom={1} flexShrink={0}>
        <text wrapMode="none" selectable={false}>
          <span style={{ fg: claude.body }}>{glyph()} </span>
          <For each={Array.from(label())}>
            {(char, i) => (
              <span style={{ fg: Math.abs(i() - sweep()) <= 1 ? shimmer() : claude.body }}>{char}</span>
            )}
          </For>
          <span style={{ fg: theme().textMuted }}> ({elapsed()}s)</span>
        </text>
      </box>
    </Show>
  )
}

function randomVerb() {
  return spinnerVerbs[Math.floor(Math.random() * spinnerVerbs.length)]
}
