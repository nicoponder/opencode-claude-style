/** @jsxImportSource @opentui/solid */
import type { Renderable, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { TextAttributes, type RGBA } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { type Accessor, createRoot, createSignal, getOwner, onCleanup, onMount, Show } from "solid-js"
import path from "node:path"
import {
  commandHint,
  commandKind,
  formatClock,
  formatDuration,
  summarizeTools,
  type ToolKind,
  turnOf,
  turnVerb,
} from "./format"
import { blankBar, drawn, firstText, interceptSetter, onBeforeRender, textOf } from "./tree"

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
  | { type: "user" | "text" | "reasoning" | "footer" | "loaded" | "empty" | "unsettled" | "other" }
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
 * A reply's markdown, held back to its last finished line while it streams.
 * `source` gives the raw text being streamed; it's unset once the reply is done.
 */
type Gate = { full: string; shown: string; source?: () => string; apply: () => void }

/** How long each "⎿ $ command" hint under a running group stays up, at least. */
const MIN_HINT_MS = 700
/** Claude Code's in-progress ⏺ is on for this long, then off for as long. */
const BLINK_MS = 600

/**
 * Restyle OpenCode's session transcript like Claude Code's, and pace it the way
 * Claude Code does:
 *
 * - User messages lose their colored bar and padding and get a `❯`.
 * - Replies get a `⏺` bullet. While a reply streams, only its finished lines
 *   show, so prose arrives a paragraph at a time rather than word by word.
 * - Runs of reads, searches, and shell commands fold into one line such as
 *   "⏺ Read 2 files, ran 1 shell command (ctrl+o to expand)". A run stays "in
 *   progress" (present tense, blinking ⏺, "⎿ $ command" underneath) until the
 *   reply moves on, so it doesn't flip back and forth between calls, and each
 *   command stays up long enough to read. Edits, subagents, todos, questions,
 *   and failed calls stay as OpenCode draws them.
 * - Thinking is hidden until ctrl+o, as in Claude Code, where the spinner line
 *   says when the model is thinking.
 * - OpenCode's "▣ Build · model · 12s" line after each reply becomes
 *   "✻ Worked for 12s · done 4:00 PM", or "⎿ Interrupted".
 *
 * OpenCode gives plugins no hook into the transcript, so this reads what it drew
 * and adjusts it just before each frame is drawn. Anything it doesn't recognize
 * is left as OpenCode drew it.
 */
export function useTranscript(api: TuiPluginApi, sessionID: () => string, anchor: () => Renderable | undefined) {
  const theme = () => api.theme.current
  const [blink, setBlink] = createSignal(true)
  const decorations = new Map<string, Decoration>()
  const ours = new WeakSet<Renderable>()
  const restyled = new WeakSet<Renderable>()
  const gates = new WeakMap<Renderable, Gate>()
  const gated = new Set<Gate>()
  const hints = new Map<string, { text?: string; at: number }>()
  const seen = new WeakMap<Renderable, { row: Row; at: number }>()
  let hidden = new Set<Renderable>()
  let scroll: Renderable | undefined
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
    if (node.visible) node.visible = false
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

  /**
   * Hold back the line a reply is still writing, as Claude Code does: while
   * `source` is set, the markdown only gets the text up to its last newline.
   * OpenCode sets the markdown's text on every token, so its setter is wrapped.
   */
  function gate(markdown: Renderable) {
    let g = gates.get(markdown)
    if (g) return g
    const current = (markdown as { content?: unknown }).content
    const created: Gate = { full: typeof current === "string" ? current : "", shown: "", apply: () => {} }
    const ok = interceptSetter<string>(markdown, "content", (value, set) => {
      created.full = value
      created.apply = () => {
        const raw = created.source?.()
        const next = raw === undefined ? created.full : raw.slice(0, raw.lastIndexOf("\n") + 1).trim()
        if (next !== created.shown) set((created.shown = next))
      }
      created.apply()
    })
    if (!ok) return
    // Go through the wrapper once, so `apply` has the original setter to call.
    ;(markdown as { content?: unknown }).content = created.full
    gates.set(markdown, created)
    return created
  }

  /**
   * OpenCode fills a new row's text in a moment after it adds the row, so for a
   * pass it can't be recognized, and would be drawn as OpenCode styles it. A row
   * we've recognized before keeps what it was until its text is back; a new one
   * stays hidden (briefly) until there's text to go on.
   */
  function settle(node: Renderable, row: Row): Row {
    const before = seen.get(node)
    const now = Date.now()
    if ((row.type === "other" || row.type === "empty") && hasBlankText(node)) {
      if (before && before.row.type !== "other" && before.row.type !== "unsettled") return before.row
      const at = before?.at ?? now
      if (now - at < 250) {
        seen.set(node, { row: { type: "unsettled" }, at })
        return { type: "unsettled" }
      }
    }
    seen.set(node, { row, at: before?.at ?? now })
    return row
  }

  const sync = () => {
    const host = anchor()
    if (!host || host.isDestroyed) return
    if (!scroll || scroll.isDestroyed) scroll = findTranscript(host)
    if (!scroll) return

    setBlink(Math.floor(Date.now() / BLINK_MS) % 2 === 0)
    for (const d of decorations.values()) d.used = false
    const next = new Set<Renderable>()
    const t = theme()
    const messages = api.state.session.messages(sessionID())
    const byID = new Map(messages.map((m) => [m.id, m]))
    const status = api.state.session.status(sessionID())
    const busy = !!status && status.type !== "idle"
    const latestUser = [...messages].reverse().find((m) => m.role === "user")
    const streaming = busy ? streamingText(api, messages) : undefined
    const footers = new Map<string, Renderable[]>()
    const rows = scroll
      .getChildren()
      .filter((node) => !ours.has(node))
      .map((node) => ({ node, row: settle(node, classify(node, kids, t.error)) }))
    const lastText = [...rows].reverse().find((r) => r.row.type === "text")?.node
    const stillGated = new Set<Gate>()

    let user: (typeof messages)[number] | undefined
    let group = 0
    let run: { node: Renderable; row: Row }[] = []

    // `atEnd`: nothing has come after the run yet. While the latest turn is still
    // going, such a run is still in progress even between calls, as in Claude Code.
    const flush = (atEnd: boolean) => {
      const tools = run.flatMap((r) => (r.row.type === "tool" ? [r.row] : []))
      if (tools.length && !expanded()) {
        for (const r of run) hide(r.node, next)
        const key = `${user?.id ?? "start"}:${group++}`
        const active = tools.some((tool) => tool.active) || (atEnd && busy && user?.id === latestUser?.id)
        const kinds = tools.map((tool) => (tool.kind === "bash" ? commandKind(tool.detail ?? "") : tool.kind))
        const text = summarizeTools(kinds, active)
        // While it runs, Claude Code heads the run with what the latest call says
        // it's doing, and shows its command, file, or pattern underneath.
        const latest = active && user ? latestCall(api, messages, user.id) : undefined
        const summary = {
          text: latest?.description ?? text,
          active,
          detail: active ? holdHint(key, latest?.hint) : undefined,
        }
        placeBefore(
          decoration(`summary:${key}`, summary, (data) => <ToolSummary api={api} data={data()} blink={blink()} />),
          run[0].node,
        )
      }
      run = []
    }

    /** Keep each hint up for MIN_HINT_MS before the next replaces it. */
    const holdHint = (key: string, text: string | undefined) => {
      const held = hints.get(key)
      if (!held || (held.text !== text && Date.now() - held.at >= MIN_HINT_MS)) {
        hints.set(key, { text, at: Date.now() })
        return text
      }
      return held.text
    }

    for (const { node, row } of rows) {
      // A spacer, or a row OpenCode hasn't finished filling in (kept out of sight).
      if (row.type === "empty") continue
      if (row.type === "unsettled") {
        hide(node, next)
        continue
      }
      if (row.type === "tool" || row.type === "loaded") {
        run.push({ node, row })
        continue
      }
      // Thinking shows only when expanded, and doesn't split a run of tool calls.
      if (row.type === "reasoning") {
        if (!expanded()) hide(node, next)
        continue
      }
      if (row.type === "footer") {
        if (user) footers.set(user.id, [...(footers.get(user.id) ?? []), node])
        continue
      }
      if (row.type === "text") {
        const markdown = kids(node)[0]
        const g = markdown && gate(markdown)
        if (g) {
          g.source = streaming && node === lastText ? streaming : undefined
          if (g.source) stillGated.add(g)
          g.apply()
          // Nothing finished yet: show nothing, and don't end the run above.
          if (g.source && !g.shown) {
            hide(node, next)
            continue
          }
        }
      }
      flush(false)
      if (row.type === "user") {
        user = byID.get(node.id)
        group = 0
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
      }
    }
    flush(true)

    // A reply that just finished gets its last line back.
    for (const g of gated) {
      if (stillGated.has(g)) continue
      g.source = undefined
      g.apply()
    }
    gated.clear()
    for (const g of stillGated) gated.add(g)

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
            ? {
                kind: "done" as const,
                verb: turnVerb(owner.id),
                took: formatDuration(turn.end - turn.start),
                at: formatClock(turn.end),
              }
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
    for (const node of hidden) if (!next.has(node) && !node.isDestroyed && !node.visible) node.visible = true
    hidden = next
    for (const [key, d] of decorations) {
      if (d.used) continue
      d.node.parent?.remove(d.node)
      if (!d.node.isDestroyed) d.node.destroyRecursively()
      d.dispose()
      decorations.delete(key)
    }
    for (const key of hints.keys()) if (!decorations.has(`summary:${key}`)) hints.delete(key)
  }

  onMount(() => {
    // Restyle just before every frame is drawn, so new rows never show unstyled,
    // even for a frame. The timer keeps the blink going when nothing else redraws.
    const stop = onBeforeRender(api.renderer.root, sync)
    const timer = setInterval(sync, 100)
    onCleanup(() => {
      stop()
      clearInterval(timer)
      for (const g of gated) {
        g.source = undefined
        g.apply()
      }
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
        <text position="absolute" left={0} top={0} fg={theme().borderSubtle} selectable={false}>
          ❯
        </text>
      )),
      body,
    )
  }
}

/** Whether any text in a row is still blank. */
function hasBlankText(node: Renderable, depth = 0): boolean {
  if (textOf(node) === "") return true
  return depth < 5 && drawn(node).some((child) => hasBlankText(child, depth + 1))
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
  if (!first) return { type: "empty" }
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
      if (line?.startsWith("$ ")) return { type: "tool", kind: "bash", active: false, detail: line.slice(2) }
      const command = spinning(top)
      if (command !== undefined) return { type: "tool", kind: "bash", active: true, detail: command }
    }
  }
  return { type: "other" }
}

/**
 * The text a reply is streaming right now, if it's writing text (rather than
 * thinking or calling a tool): read fresh each time, since it grows between passes.
 */
function streamingText(api: TuiPluginApi, messages: ReadonlyArray<{ id: string; role: string }>) {
  const reply = [...messages].reverse().find((m) => m.role === "assistant")
  if (!reply) return
  const latest = () =>
    [...api.state.part(reply.id)].reverse().find((p) => p.type === "text" || p.type === "reasoning" || p.type === "tool")
  const part = latest()
  if (part?.type !== "text" || part.time?.end !== undefined) return
  return () => {
    const now = latest()
    return now?.type === "text" ? now.text : ""
  }
}

/**
 * The latest tool call in a turn, from OpenCode's state: what it says it's doing
 * (a shell command's description) and the hint to show under the run, as Claude
 * Code picks it: the file, the pattern, or the command.
 */
function latestCall(api: TuiPluginApi, messages: ReadonlyArray<{ id: string; role: string }>, userID: string) {
  const replies = messages.filter((m) => m.role === "assistant" && (m as { parentID?: string }).parentID === userID)
  const part = replies
    .flatMap((m) => api.state.part(m.id))
    .reverse()
    .find((p) => p.type === "tool")
  if (part?.type !== "tool") return
  const input = (part.state.input ?? {}) as Record<string, unknown>
  const str = (key: string) => (typeof input[key] === "string" && input[key] ? (input[key] as string) : undefined)
  const file = str("filePath")
  const relative = file && path.relative(api.state.path.directory, file)
  const hint =
    part.tool === "bash" && str("command")
      ? commandHint(str("command")!)
      : relative && !relative.startsWith("..")
        ? relative
        : (file ?? (str("pattern") ? `"${str("pattern")}"` : (str("url") ?? str("query") ?? str("name"))))
  return { description: part.tool === "bash" ? str("description") : undefined, hint }
}

/**
 * A run of tool calls. While it runs: a blinking dot, what it's doing, and the
 * latest command, file, or pattern under a ⎿. Once done, Claude Code leaves just
 * the dimmed summary, lined up with the replies' text.
 */
function ToolSummary(props: {
  api: TuiPluginApi
  data: { text: string; active: boolean; detail?: string }
  blink: boolean
}) {
  const theme = () => props.api.theme.current
  return (
    <box flexDirection="column" marginTop={1} paddingLeft={1} flexShrink={0}>
      <Show
        when={props.data.active}
        fallback={
          <text fg={theme().textMuted} selectable={false}>
            {"  "}
            {props.data.text}
          </text>
        }
      >
        <text selectable={false}>
          <span style={{ fg: theme().textMuted }}>{props.blink ? "⏺ " : "  "}</span>
          <span style={{ fg: theme().text }}>{props.data.text}</span>
        </text>
        <Show when={props.data.detail}>
          {(detail) => (
            <box flexDirection="row">
              <text fg={theme().textMuted} width={5} flexShrink={0} selectable={false}>
                {"  ⎿  "}
              </text>
              <text fg={theme().textMuted} flexGrow={1} selectable={false}>
                {detail()}
              </text>
            </box>
          )}
        </Show>
      </Show>
    </box>
  )
}

function TurnLine(props: {
  api: TuiPluginApi
  line: { kind: "done"; verb: string; took: string; at: string } | { kind: "interrupted" }
}) {
  const theme = () => props.api.theme.current
  const line = () => props.line
  return (
    <box flexDirection="column" flexShrink={0}>
      <Show
        when={line().kind === "done" && (line() as { verb: string; took: string; at: string })}
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
            ✻ {done().verb} for {done().took} · done {done().at}
          </text>
        )}
      </Show>
    </box>
  )
}
