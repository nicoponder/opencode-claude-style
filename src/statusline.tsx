/** @jsxImportSource @opentui/solid */
import { type ChildProcess, spawn } from "node:child_process"
import type { Plugin } from "@opencode/plugin/tui"
import { TextAttributes } from "@opentui/core"
import { createEffect, createSignal, For, onCleanup, onMount } from "solid-js"
import { type AnsiSegment, contextUsage, type ModelInfo, parseAnsi } from "./format"
import { debug } from "./tree"

type Context = Plugin.Context

export type StatusLineConfig = { command: string; padding: number }

/** Run at most this often, as Claude Code throttles its status line. */
const THROTTLE = 300
/** And at least this often, for status lines that show the time or a branch. */
const REFRESH = 10_000
const TIMEOUT = 5_000
const MAX_LINES = 5

/** What the command gets on stdin, modeled on Claude Code's status-line input. */
function input(context: Context, sessionID: string | undefined) {
  const session = sessionID ? context.data.session.get(sessionID) : undefined
  const location = session?.location ?? context.location ?? context.data.location.default()
  const selected = context.ui.model.current()
  const models = (context.data.location.model.list(location) ?? []) as ReadonlyArray<ModelInfo>
  const model = selected && models.find((m) => m.providerID === selected.providerID && m.id === selected.modelID)
  const usage = sessionID ? contextUsage(context.data.session.message.list(sessionID), models, session?.revert?.messageID) : undefined
  return {
    session_id: sessionID ?? null,
    session_name: session?.title ?? null,
    cwd: location.directory,
    workspace: { current_dir: location.directory },
    version: context.app.version,
    model: selected
      ? { id: `${selected.providerID}/${selected.modelID}`, display_name: model?.name ?? selected.modelID, variant: selected.variant ?? null }
      : null,
    cost: { total_cost_usd: sessionID ? context.data.session.cost(sessionID) : 0 },
    context: usage ? { tokens: usage.tokens, used_percentage: usage.percent ?? null } : null,
    busy: !!sessionID && context.data.session.status(sessionID) === "running",
  }
}

/**
 * Claude Code's custom status line: a command of yours, run with the session's
 * details as JSON on stdin, whose output (ANSI colors and all) shows as a line or
 * two by the prompt. It runs when the session changes, at most every 300ms, and
 * every 10 seconds besides.
 */
export function StatusLine(props: { context: Context; config: StatusLineConfig; sessionID?: string }) {
  const context = props.context
  const theme = () => context.theme
  const [lines, setLines] = createSignal<AnsiSegment[][]>([])
  let child: ChildProcess | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = 0

  const run = () => {
    child?.kill()
    let stdin: string
    try {
      stdin = JSON.stringify(input(context, props.sessionID))
    } catch (error) {
      return debug("status line input failed", error)
    }
    const proc = spawn(props.config.command, {
      shell: true,
      cwd: JSON.parse(stdin).cwd,
      stdio: ["pipe", "pipe", "ignore"],
    })
    child = proc
    let out = ""
    const kill = setTimeout(() => proc.kill(), TIMEOUT)
    proc.stdout?.on("data", (chunk: Buffer) => {
      if (out.length < 65_536) out += chunk.toString("utf8")
    })
    proc.on("error", (error) => debug("status line failed", error))
    proc.on("close", () => {
      clearTimeout(kill)
      if (child !== proc) return
      child = undefined
      setLines(
        out
          .split("\n")
          .map((line) => line.replace(/\r$/, ""))
          .filter((line) => line.trim())
          .slice(0, MAX_LINES)
          .map(parseAnsi),
      )
    })
    proc.stdin?.on("error", () => {})
    proc.stdin?.end(stdin)
  }

  const schedule = () => {
    if (timer) return
    timer = setTimeout(
      () => {
        timer = undefined
        last = Date.now()
        run()
      },
      Math.max(0, last + THROTTLE - Date.now()),
    )
  }

  // Run again whenever anything the input reads changes.
  createEffect(() => {
    const id = props.sessionID
    context.ui.model.current()
    if (id) {
      context.data.session.status(id)
      const latest = context.data.session.message.list(id).at(-1)
      JSON.stringify(latest)
    }
    schedule()
  })

  onMount(() => {
    const interval = setInterval(schedule, REFRESH)
    onCleanup(() => {
      clearInterval(interval)
      if (timer) clearTimeout(timer)
      child?.kill()
      child = undefined
    })
  })

  const attributes = (s: AnsiSegment) =>
    (s.bold ? TextAttributes.BOLD : 0) |
    (s.dim ? TextAttributes.DIM : 0) |
    (s.italic ? TextAttributes.ITALIC : 0) |
    (s.underline ? TextAttributes.UNDERLINE : 0)

  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={props.config.padding}>
      <For each={lines()}>
        {(segments) => (
          <text wrapMode="none" selectable={false}>
            <For each={segments}>
              {(s) => (
                <span style={{ fg: s.fg ?? theme().text.muted, bg: s.bg, attributes: attributes(s) }}>{s.text}</span>
              )}
            </For>
          </text>
        )}
      </For>
    </box>
  )
}
