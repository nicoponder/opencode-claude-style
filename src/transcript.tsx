/** @jsxImportSource @opentui/solid */
import type { Renderable, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { TextAttributes, type RGBA } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { type Accessor, createRoot, createSignal, getOwner, onCleanup, onMount, Show } from "solid-js"
import { formatClock, formatDuration, summarizeTools, type ToolKind, turnOf } from "./format"
import { blankBar, drawn, firstText, textOf } from "./tree"

/**
 * Whether tool calls and thinking are expanded, like Claude Code's ctrl+o. Shared
 * by every session view, as Claude Code's is.
 */
const [expanded, setExpanded] = createSignal(false)

export const EXPAND_COMMAND = "claude.transcript.expand"

/**
 * Bind ctrl+o to expand or collapse tool calls and thinking. Expanding also turns
 * on OpenCode's own thinking display if it was collapsed, and collapsing puts it
 * back the way it was.
 */
export function registerExpandKey(api: TuiPluginApi) {
  let restoreThinking: string | undefined
  const unregister = api.keymap.registerLayer({
    commands: [
      {
        name: EXPAND_COMMAND,
        title: "Expand or collapse tool calls",
        category: "Session",
        run() {
          const next = !expanded()
          setExpanded(next)
          if (next && api.kv.get("thinking_mode", "hide") === "hide") {
            restoreThinking = "hide"
            api.kv.set("thinking_mode", "show")
          } else if (!next && restoreThinking) {
            api.kv.set("thinking_mode", restoreThinking)
            restoreThinking = undefined
          }
        },
      },
    ],
    bindings: [{ key: "ctrl+o", cmd: EXPAND_COMMAND }],
  })
  return () => {
    unregister()
    // Don't leave OpenCode's thinking expanded because of us.
    if (restoreThinking) api.kv.set("thinking_mode", restoreThinking)
  }
}

/** What a row of OpenCode's transcript turned out to be. */
type Row =
  | { type: "user" | "text" | "reasoning" | "footer" | "loaded" | "other" }
  | { type: "tool"; kind: ToolKind; active: boolean; detail?: string }


/** OpenCode's glyph for each inline tool row it draws. */
const icons: Record<string, ToolKind | undefined> = { $: "bash", "✱": "search", "%": "fetch", "◈": "websearch" }

/** The placeholder OpenCode shows before a tool's input has streamed in. */
const pending: Record<string, ToolKind> = {
  "Writing command…": "bash",
  "Reading file…": "read",
  "Finding files…": "search",
  "Searching content…": "search",
  "Fetching from the web…": "fetch",
  "Searching web…": "websearch",
  "Loading skill…": "skill",
}

type Decoration = { node: Renderable; set: (data: unknown) => void; dispose: () => void; used: boolean }

/**
 * Restyle OpenCode's session transcript like Claude Code's:
 *
 * - User messages lose their colored bar and padding and get a `❯`.
 * - Replies get a `⏺` bullet.
 * - Runs of reads, searches, and shell commands fold into one line such as
 *   "⏺ Read 2 files, ran 1 shell command (ctrl+o to expand)". Edits, subagents,
 *   todos, questions, and failed calls stay as OpenCode draws them.
 * - Thinking shows as "∴ Thought for 2s".
 * - OpenCode's "▣ Build · model · 12s" line after each reply becomes
 *   "✻ Thought for 12s · done 4:00 PM", or "⎿ Interrupted".
 *
 * OpenCode gives plugins no hook into the transcript, so this reads what it drew
 * and adjusts it, a few times a second. Anything it doesn't recognize is left as
 * OpenCode drew it.
 */
export function useTranscript(api: TuiPluginApi, sessionID: () => string, anchor: () => Renderable | undefined) {
  const theme = () => api.theme.current
  const [blink, setBlink] = createSignal(true)
  const decorations = new Map<string, Decoration>()
  const ours = new WeakSet<Renderable>()
  const restyled = new WeakSet<Renderable>()
  let hidden = new Set<Renderable>()
  let scroll: Renderable | undefined
  let frame = 0
  // Our nodes are made outside OpenCode's render pass, so they borrow this owner
  // to find the renderer.
  const owner = getOwner()
  /** A row's children as OpenCode drew them, without any of ours. */
  const kids = (node: Renderable) => drawn(node).filter((child) => !ours.has(child))

  /** Create (once) and return a node of ours, re-rendered from `data` each pass. */
  function decoration<T>(key: string, data: T, make: (data: Accessor<T>) => JSX.Element) {
    let d = decorations.get(key)
    if (d?.node.isDestroyed) {
      d.dispose()
      decorations.delete(key)
      d = undefined
    }
    if (!d) {
      d = createRoot((dispose) => {
        const [get, set] = createSignal(data, { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) })
        const node = make(get) as unknown as Renderable
        return { node, set: (v: unknown) => set(() => v as T), dispose, used: true }
      }, owner)
      ours.add(d.node)
      decorations.set(key, d)
    }
    d.set(data)
    d.used = true
    return d.node
  }

  function hide(node: Renderable, next: Set<Renderable>) {
    node.visible = false
    next.add(node)
  }

  function placeBefore(node: Renderable, anchor: Renderable) {
    const parent = anchor.parent
    if (!parent) return
    const children = parent.getChildren()
    if (node.parent === parent && children.indexOf(node) === children.indexOf(anchor) - 1) return
    node.parent?.remove(node)
    parent.insertBefore(node, anchor)
  }

  function placeIn(node: Renderable, parent: Renderable, index?: number) {
    if (node.parent === parent) {
      if (index === undefined || parent.getChildren()[index] === node) return
      parent.remove(node)
    } else node.parent?.remove(node)
    parent.add(node, index)
  }

  const sync = () => {
    const host = anchor()
    if (!host || host.isDestroyed) return
    if (!scroll || scroll.isDestroyed) scroll = findTranscript(host)
    if (!scroll) return

    frame++
    // Claude Code's in-progress dot is mostly on, with a brief blink off.
    setBlink(frame % 8 < 6)
    for (const d of decorations.values()) d.used = false
    const next = new Set<Renderable>()
    const t = theme()
    const messages = api.state.session.messages(sessionID())
    const byID = new Map(messages.map((m) => [m.id, m]))
    const status = api.state.session.status(sessionID())
    const busy = !!status && status.type !== "idle"
    const latestUser = [...messages].reverse().find((m) => m.role === "user")
    const footers = new Map<string, Renderable[]>()

    let user: (typeof messages)[number] | undefined
    let reasoning: { start: number; end?: number }[] = []
    let thought = 0
    let run: { node: Renderable; row: Row }[] = []

    const flush = () => {
      const tools = run.flatMap((r) => (r.row.type === "tool" ? [r.row] : []))
      if (tools.length && !expanded()) {
        for (const r of run) hide(r.node, next)
        const active = tools.some((tool) => tool.active)
        const summary = {
          text: summarizeTools(tools),
          active,
          detail: active ? [...tools].reverse().find((tool) => tool.active)?.detail : undefined,
        }
        placeBefore(
          decoration(`summary:${run[0].node.id}`, summary, (data) => (
            <ToolSummary api={api} data={data()} blink={blink()} />
          )),
          run[0].node,
        )
      }
      run = []
    }

    for (const node of scroll.getChildren()) {
      if (ours.has(node)) continue
      const row = classify(node, kids, t.error)
      if (row.type === "tool" || row.type === "loaded") {
        run.push({ node, row })
        continue
      }
      flush()
      if (row.type === "user") {
        user = byID.get(node.id)
        reasoning = user ? reasoningOf(api, messages, user.id) : []
        thought = 0
        restyleUser(node)
      } else if (row.type === "text") {
        placeIn(
          decoration(`bullet:${node.id}`, null, () => (
            <text position="absolute" left={1} top={0} fg={theme().text} selectable={false}>
              ⏺
            </text>
          )),
          node,
        )
      } else if (row.type === "reasoning") {
        const part = reasoning[thought++]
        const label = kids(node)[0]
        if (!part || !label || expanded()) continue
        hide(label, next)
        const text = part.end ? `∴ Thought for ${formatDuration(Math.max(1000, part.end - part.start))}` : "∴ Thinking…"
        placeIn(
          decoration(`thought:${node.id}`, text, (data) => (
            <text
              fg={theme().textMuted}
              attributes={TextAttributes.ITALIC}
              marginLeft={-2}
              wrapMode="none"
              selectable={false}
            >
              {data()}
            </text>
          )),
          node,
          0,
        )
      } else if (row.type === "footer" && user) {
        footers.set(user.id, [...(footers.get(user.id) ?? []), node])
      }
    }
    flush()

    // OpenCode can end a turn with more than one "▣" line; only the last one gets
    // the turn's summary, as Claude Code prints one per turn.
    for (const [userID, nodes] of footers) {
      const owner = byID.get(userID)!
      const last = nodes[nodes.length - 1]
      for (const node of nodes.slice(0, -1)) hide(node, next)
      const turn = turnOf(messages, owner)
      const running = busy && owner.id === latestUser?.id
      const line = running
        ? undefined
        : turn.interrupted
          ? { kind: "interrupted" as const }
          : turn.end && !turn.failed
            ? { kind: "done" as const, took: formatDuration(turn.end - turn.start), at: formatClock(turn.end) }
            : undefined
      if (!line) {
        hide(last, next)
        continue
      }
      const original = kids(last)[0]
      if (original) hide(original, next)
      placeIn(
        decoration(`turn:${last.id}`, line, (data) => <TurnLine api={api} line={data()} />),
        last,
      )
    }

    // Put back anything hidden last pass that isn't hidden this pass, such as tool
    // rows after ctrl+o, then drop decorations whose rows are gone.
    for (const node of hidden) if (!next.has(node) && !node.isDestroyed) node.visible = true
    hidden = next
    for (const [key, d] of decorations) {
      if (d.used) continue
      d.node.parent?.remove(d.node)
      if (!d.node.isDestroyed) d.node.destroyRecursively()
      d.dispose()
      decorations.delete(key)
    }
  }

  onMount(() => {
    const timer = setInterval(sync, 100)
    onCleanup(() => {
      clearInterval(timer)
      for (const node of hidden) if (!node.isDestroyed) node.visible = true
      for (const d of decorations.values()) {
        d.node.parent?.remove(d.node)
        if (!d.node.isDestroyed) d.node.destroyRecursively()
        d.dispose()
      }
      decorations.clear()
    })
  })

  /**
   * Claude Code shows your earlier prompts as `❯ text` on a gray band. OpenCode
   * draws them in a padded box with the agent's colored bar down the left.
   */
  function restyleUser(node: Renderable) {
    const body = kids(node)[0]
    if (!body) return
    if (!restyled.has(node)) {
      restyled.add(node)
      blankBar(node)
      body.paddingTop = 0
      body.paddingBottom = 0
    }
    placeIn(
      decoration(`prompt:${node.id}`, null, () => (
        <text position="absolute" left={0} top={0} fg={theme().text} selectable={false}>
          ❯
        </text>
      )),
      body,
    )
  }
}

/**
 * The transcript is the scroll box beside the prompt: the session column holds
 * the scroll box, then the box the prompt slot renders into.
 */
function findTranscript(from: Renderable) {
  for (let node = from, depth = 0; node.parent && depth < 4; node = node.parent, depth++) {
    const scroll = node.parent.getChildren().find((child) => child !== node && child.id.startsWith("scrollbox"))
    if (scroll) return scroll
  }
}

/**
 * Recognize a row of OpenCode's transcript from what it drew. Tool rows are the
 * inline ones (icon, then a description), the placeholder shown while a tool's
 * input streams in, or the panel a shell command's output goes in.
 */
function classify(node: Renderable, kids: (node: Renderable) => Renderable[], error: RGBA): Row {
  if (node.id.startsWith("msg_")) return { type: "user" }
  const first = kids(node)[0]
  if (!first) return { type: "other" }
  if (first.id.startsWith("markdown")) return { type: "text" }
  const text = textOf(first)
  if (text !== undefined) {
    if (text.startsWith("▣")) return { type: "footer" }
    if (text.startsWith("↳ Loaded")) return { type: "loaded" }
    const kind = pending[text.replace(/^~ /, "")]
    if (text.startsWith("~ ") && kind) return { type: "tool", kind, active: true }
  }
  const label = firstText(first)
  if (label !== undefined && /^([+-] )?Thought\b|^Thinking\b/.test(label)) return { type: "reasoning" }

  // OpenCode's spinner, then what's running: a file being read, or (inside the
  // shell panel below) a command.
  const spinning = (row: Renderable | undefined) => {
    const cells = row ? kids(row) : []
    return cells.length === 2 && cells[0].id.startsWith("spinner") ? textOf(cells[1]) : undefined
  }
  const reading = spinning(first)
  if (reading?.startsWith("Read ")) return { type: "tool", kind: "read", active: true, detail: reading.trim() }

  // An inline row: a row box holding a two-column icon, then the description.
  const cells = kids(first)
  const icon = textOf(cells[0])?.trim()
  const body = textOf(cells[1])
  if (icon && body !== undefined && cells.length === 2) {
    const fg = (cells[0] as { fg?: RGBA }).fg
    const attributes = (cells[0] as { attributes?: number }).attributes ?? 0
    if (fg?.equals(error) || attributes & TextAttributes.STRIKETHROUGH) return { type: "other" }
    const kind = icon === "→" ? (body.startsWith("Read ") ? "read" : "skill") : icons[icon]
    if (kind) return { type: "tool", kind, active: false, detail: body.trim() }
  }

  // A shell command's output panel: "$ command" (or the spinner and the command
  // while it runs), then the output.
  if (Array.isArray((node as { border?: unknown }).border)) {
    for (const panel of kids(node)) {
      const top = kids(panel)[0]
      const line = textOf(top)
      if (line?.startsWith("$ ")) return { type: "tool", kind: "bash", active: false, detail: line }
      const command = spinning(top)
      if (command !== undefined) return { type: "tool", kind: "bash", active: true, detail: `$ ${command}` }
    }
  }
  return { type: "other" }
}

/** Timing of each reasoning part OpenCode draws for a turn, in order. */
function reasoningOf(api: TuiPluginApi, messages: ReadonlyArray<{ id: string; role: string }>, userID: string) {
  return messages
    .filter((m) => m.role === "assistant" && (m as { parentID?: string }).parentID === userID)
    .flatMap((m) => api.state.part(m.id))
    .flatMap((part) => {
      if (part.type !== "reasoning") return []
      if (!part.text.replace("[REDACTED]", "").trim() && !part.metadata) return []
      return [{ start: part.time.start, end: part.time.end }]
    })
}

function ToolSummary(props: {
  api: TuiPluginApi
  data: { text: string; active: boolean; detail?: string }
  blink: boolean
}) {
  const theme = () => props.api.theme.current
  return (
    <box flexDirection="column" marginTop={1} paddingLeft={1} flexShrink={0}>
      <text wrapMode="none" selectable={false}>
        <span style={{ fg: props.data.active ? theme().text : theme().success }}>
          {props.data.active && !props.blink ? " " : "⏺"}
        </span>
        <span style={{ fg: theme().text }}> {props.data.text}</span>
        <span style={{ fg: theme().textMuted }}> (ctrl+o to expand)</span>
      </text>
      <Show when={props.data.detail}>
        <text fg={theme().textMuted} wrapMode="none" selectable={false}>
          {"  ⎿  "}
          {props.data.detail}
        </text>
      </Show>
    </box>
  )
}

function TurnLine(props: {
  api: TuiPluginApi
  line: { kind: "done"; took: string; at: string } | { kind: "interrupted" }
}) {
  const theme = () => props.api.theme.current
  const line = () => props.line
  return (
    <box flexDirection="column" flexShrink={0}>
      <Show
        when={line().kind === "done" && (line() as { took: string; at: string })}
        fallback={
          <text wrapMode="none" selectable={false}>
            <span style={{ fg: theme().textMuted }}>{"⎿  "}</span>
            <span style={{ fg: theme().error }}>Interrupted</span>
            <span style={{ fg: theme().textMuted }}> · What should OpenCode do instead?</span>
          </text>
        }
      >
        {(done) => (
          // Out through OpenCode's indent so the ✻ lines up with the ⏺ bullets.
          <text fg={theme().textMuted} marginTop={1} marginLeft={-2} wrapMode="none" selectable={false}>
            ✻ Thought for {done().took} · done {done().at}
          </text>
        )}
      </Show>
    </box>
  )
}
