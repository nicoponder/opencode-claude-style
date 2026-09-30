/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import type { RGBA, Renderable } from "@opentui/core"
import { createSignal, getOwner, onCleanup, onMount, Show } from "solid-js"
import path from "node:path"
import { type Detached, detach } from "./detach"
import {
  commandHint,
  commandKind,
  formatClock,
  formatDuration,
  summarizeTools,
  type ToolKind,
  turnOf,
  turnVerb,
  type TurnMessage,
} from "./format"
import { blankBar, debug, drawn, find, idOf, interceptSetter, onBeforeRender, placeBefore, placeIn, textOf } from "./tree"

type Context = Plugin.Context

/**
 * Whether tool calls and thinking are expanded, like Claude Code's ctrl+o. Shared
 * by every session view, as Claude Code's is.
 */
const [expanded, setExpanded] = createSignal(false)
export { expanded }

export const EXPAND_COMMAND = "claude.transcript.expand"
const THINKING_COMMAND = "session.toggle.thinking"

/** Whether OpenCode is hiding thinking: its toggle offers to expand it. */
function thinkingHidden(context: Context) {
  return context.keymap.commands().find((command) => command.id === THINKING_COMMAND)?.title === "Expand thinking"
}

/**
 * ctrl+o expands or collapses tool calls and thinking, in sessions (OpenCode's
 * own ctrl+o, its recent-sessions menu, still works on the home screen). Expanding
 * also turns on OpenCode's thinking display if it was hidden, and collapsing puts
 * it back. Rebind it in cli.json's keybinds under "claude.transcript.expand".
 */
export function ExpandKey(props: { context: Context }) {
  const context = props.context
  let restoreThinking = false
  const toggleThinking = () => context.keymap.dispatch(THINKING_COMMAND)
  context.keymap.layer(() => ({
    priority: 10,
    enabled: () => context.ui.router.current().type === "session",
    commands: [
      {
        id: EXPAND_COMMAND,
        title: expanded() ? "Collapse tool calls and thinking" : "Expand tool calls and thinking",
        group: "Session",
        bind: "ctrl+o",
        palette: true,
        run() {
          const next = !expanded()
          setExpanded(next)
          if (next && thinkingHidden(context)) {
            restoreThinking = true
            toggleThinking()
          } else if (!next && restoreThinking) {
            restoreThinking = false
            if (!thinkingHidden(context)) toggleThinking()
          }
        },
      },
    ],
    bindings: [EXPAND_COMMAND],
  }))
  // Don't leave OpenCode's thinking expanded because of us.
  onCleanup(() => {
    if (restoreThinking && !thinkingHidden(context)) toggleThinking()
    restoreThinking = false
  })
  return null
}

/** The parts of an OpenCode session message the transcript reads. */
type Part = {
  type: string
  id?: string
  name?: string
  text?: string
  state?: { status?: string; input?: unknown }
  time?: { created?: number; completed?: number }
}
type Message = Omit<TurnMessage, "content"> & { agent?: string; content?: ReadonlyArray<Part> }

/** What a row of OpenCode's transcript turned out to be. */
type Row =
  | { type: "user"; messageID: string }
  | { type: "text"; messageID?: string; partID?: string }
  | { type: "reasoning" | "footer" | "empty" | "unsettled" | "other" }
  | { type: "tool"; kinds: ToolKind[]; active: boolean }

type Decoration = Detached<unknown> & { used: boolean }

/**
 * A reply's markdown, held back to its last finished line while it streams.
 * `source` gives the raw text being streamed; it's unset once the reply is done.
 */
type Gate = { full: string; shown: string; source?: () => string; apply: () => void }

/** How long each "⎿ $ command" hint under a running group stays up, at least. */
const MIN_HINT_MS = 700
/** Claude Code's in-progress ⏺ is on for this long, then off for as long. */
const BLINK_MS = 600

/** OpenCode's tools that fold into a summary line, and what each counts as. */
const foldable: Record<string, (input: Record<string, unknown>) => ToolKind> = {
  bash: (input) => commandKind(typeof input.command === "string" ? input.command : ""),
  shell: (input) => commandKind(typeof input.command === "string" ? input.command : ""),
  read: () => "read",
  list: () => "list",
  glob: () => "search",
  grep: () => "search",
  webfetch: () => "fetch",
  websearch: () => "websearch",
  skill: () => "skill",
}

/** The words OpenCode's "Explored: 2 reads, 1 search" label counts in, as summary kinds. */
const explored: Record<string, ToolKind> = { read: "read", search: "search", fetch: "fetch", list: "list" }

/** "build" → "Build", as OpenCode titles agents in its footer. */
function titlecase(text: string) {
  return text.replace(/(^|[\s_-])(\w)/g, (_, sep: string, c: string) => sep + c.toUpperCase())
}

/**
 * Restyle OpenCode's session transcript like Claude Code's, and pace it the way
 * Claude Code does:
 *
 * - User messages lose their colored bar and padding and get a `❯`.
 * - Replies get a `⏺` bullet. While a reply streams, only its finished lines
 *   show, so prose arrives a paragraph at a time rather than word by word.
 * - Runs of reads, searches, and shell commands fold into one line such as
 *   "Read 2 files, ran 1 shell command". A run stays "in progress" (present
 *   tense, blinking ⏺, "⎿ $ command" underneath) until the reply moves on, so it
 *   doesn't flip back and forth between calls, and each command stays up long
 *   enough to read. Edits, subagents, todos, questions, and failed calls stay as
 *   OpenCode draws them.
 * - Thinking is hidden until ctrl+o, as in Claude Code, where the spinner line
 *   says when the model is thinking.
 * - OpenCode's "Build · model · 12s" line after each reply becomes
 *   "✻ Worked for 12s · done 4:00 PM", or "⎿ Interrupted".
 *
 * OpenCode gives plugins no hook into the transcript, so this reads what it drew
 * and adjusts it just before each frame is drawn. Anything it doesn't recognize
 * is left as OpenCode drew it.
 */
export function useTranscript(context: Context, sessionID: () => string, anchor: () => Renderable | undefined) {
  const theme = () => context.theme
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
  function decoration<T>(key: string, data: T, make: (data: () => T) => unknown) {
    let d = decorations.get(key)
    if (d?.node.isDestroyed) {
      d.dispose()
      decorations.delete(key)
      d = undefined
    }
    if (!d) {
      d = { ...(detach(owner, data, make) as Detached<unknown>), used: true }
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

  /** Recognize a row of OpenCode's transcript, from its ID and what it drew. */
  function classify(node: Renderable, byID: Map<string, Message>, agents: Set<string>): Row {
    const id = idOf(node)
    const ref = /^session-part:([^:]+):(.+)$/.exec(id)
    const message = byID.get(ref ? ref[1] : id)
    if (!ref && message?.type === "user") return { type: "user", messageID: message.id }
    const body = kids(node)
    if (!body.length) return { type: "empty" }
    const first = body[0]
    // A reply's text: a padded box holding the markdown.
    if (idOf(kids(first)[0]).startsWith("markdown")) {
      if (ref) return { type: "text", messageID: ref[1], partID: ref[2] }
      const ordinal = message?.content?.filter((p) => p.type === "text").findIndex((p) => p.text?.trim())
      return {
        type: "text",
        messageID: message?.id,
        partID: ordinal !== undefined && ordinal >= 0 ? `text:${ordinal}` : undefined,
      }
    }
    const label = leadingText(node)
    if (/^(?:[+\-−] )?(?:Thought|Thinking)\b/.test(label)) return { type: "reasoning" }
    const group = /^(?:[→✱] )?(Explored|Exploring): (.+)$/.exec(label)
    if (group) {
      const kinds = group[2].split(", ").flatMap((item) => {
        const match = /^(\d+) (\w+?)(?:e?s)?$/.exec(item)
        const kind = match && explored[match[2]]
        return kind ? Array<ToolKind>(Number(match[1])).fill(kind) : []
      })
      return kinds.length ? { type: "tool", kinds, active: group[1] === "Exploring" } : { type: "other" }
    }
    for (const agent of agents) {
      if (label === agent || label.startsWith(`${agent} · `)) return { type: "footer" }
    }
    // A tool call: its part, from the row's ID, or the message's first part when
    // OpenCode labels the row with the message instead.
    const part = ref
      ? resolvePart(message, ref[2])
      : message?.type === "assistant"
        ? message.content?.find((p) => p.type !== "reasoning" && (p.type !== "text" || p.text?.trim()))
        : undefined
    if (part?.type === "tool" && part.name) {
      const kind = foldable[part.name.toLowerCase()]
      const status = part.state?.status
      if (!kind || status === "error") return { type: "other" }
      const input = part.state?.input && typeof part.state.input === "object" ? (part.state.input as Record<string, unknown>) : {}
      return { type: "tool", kinds: [kind(input)], active: status === "streaming" || status === "running" }
    }
    return { type: "other" }
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
    const id = sessionID()
    const messages = context.data.session.message.list(id) as ReadonlyArray<Message>
    const byID = new Map(messages.map((m) => [m.id, m]))
    const agents = new Set(messages.flatMap((m) => (m.type === "assistant" && m.agent ? [titlecase(m.agent)] : [])))
    const busy = context.data.session.status(id) === "running"
    const latestUser = messages.findLast((m) => m.type === "user")
    const streaming = busy ? streamingText(messages) : undefined
    const directory = context.data.session.get(id)?.location.directory
    const footers = new Map<string, Renderable[]>()
    const rows = scroll
      .getChildren()
      .filter((node) => !ours.has(node))
      .map((node) => ({ node, row: settle(node, classify(node, byID, agents)) }))
    const stillGated = new Set<Gate>()

    let user: Message | undefined
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
        const text = summarizeTools(
          tools.flatMap((tool) => tool.kinds),
          active,
        )
        // While it runs, Claude Code heads the run with what the latest call says
        // it's doing, and shows its command, file, or pattern underneath.
        const latest = active && user ? latestCall(messages, user.id, directory) : undefined
        const summary = {
          text: latest?.description ?? text,
          active,
          detail: active ? holdHint(key, latest?.hint) : undefined,
        }
        placeBefore(
          decoration(`summary:${key}`, summary, (data) => <ToolSummary context={context} data={data()} blink={blink()} />),
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
      if (row.type === "empty") continue
      if (row.type === "unsettled") {
        hide(node, next)
        continue
      }
      if (row.type === "tool") {
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
        const markdown = find(node, (n) => idOf(n).startsWith("markdown"))
        const g = markdown && gate(markdown)
        if (g) {
          const source = streaming && row.messageID === streaming.messageID && row.partID === streaming.partID
          g.source = source ? streaming.text : undefined
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
        user = byID.get(row.messageID)
        group = 0
        restyleUser(node)
      } else if (row.type === "text") {
        const body = kids(node)[0]
        if (body) {
          placeIn(
            decoration(`bullet:${node.id}:${row.partID ?? ""}`, null, () => (
              <text position="absolute" left={1} top={0} fg={theme().text.base} selectable={false}>
                ⏺
              </text>
            )),
            body,
          )
        }
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

    // OpenCode can end a turn with more than one footer; only the last one gets
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
        // A failed turn keeps OpenCode's footer, with its error.
        if (running) hide(last, next)
        continue
      }
      // OpenCode's footer line is the one that starts with the agent's name; an
      // error or retry notice above it stays.
      for (const child of kids(last)) {
        const text = leadingText(child)
        if ([...agents].some((agent) => text === agent || text.startsWith(`${agent} · `))) hide(child, next)
      }
      placeIn(
        decoration(`turn:${userID}`, line, (data) => <TurnLine context={context} line={data()} />),
        last,
      )
    }

    // Put back anything hidden last pass that isn't hidden this pass, such as tool
    // rows after ctrl+o, then drop decorations whose rows are gone.
    for (const node of hidden) if (!next.has(node) && !node.isDestroyed && !node.visible) node.visible = true
    hidden = next
    for (const [key, d] of decorations) {
      if (d.used) continue
      d.dispose()
      decorations.delete(key)
    }
    for (const key of hints.keys()) if (!decorations.has(`summary:${key}`)) hints.delete(key)
  }

  const safeSync = () => {
    try {
      sync()
    } catch (error) {
      debug("transcript sync failed", error)
    }
  }

  onMount(() => {
    // Restyle just before every frame is drawn, so new rows never show unstyled,
    // even for a frame. The timer keeps the blink going when nothing else redraws.
    const stop = onBeforeRender(context.renderer.root, safeSync)
    const timer = setInterval(safeSync, 100)
    onCleanup(() => {
      stop()
      clearInterval(timer)
      for (const g of gated) {
        g.source = undefined
        g.apply()
      }
      for (const node of hidden) if (!node.isDestroyed) node.visible = true
      for (const d of decorations.values()) d.dispose()
      decorations.clear()
    })
  })

  /**
   * Claude Code shows your earlier prompts as `❯ text` on a gray band. OpenCode
   * draws them in a padded box with the agent's colored bar down the left.
   */
  function restyleUser(node: Renderable) {
    const box = kids(node)[0]
    const body = box && kids(box).at(-1)
    if (!box || !body) return
    if (!restyled.has(node)) {
      restyled.add(node)
      blankBar(box)
      body.paddingTop = 0
      body.paddingBottom = 0
    }
    placeIn(
      decoration(`prompt:${node.id}`, null, () => (
        <text position="absolute" left={0} top={0} fg={theme().text.muted} selectable={false}>
          ❯
        </text>
      )),
      body,
    )
  }
}

/** Joined text of the first few text nodes in a row, so "+" and "Thought · 3s" read as "+ Thought · 3s". */
function leadingText(node: Renderable) {
  const texts: string[] = []
  const walk = (n: Renderable, depth: number) => {
    if (texts.length >= 3 || idOf(n).startsWith("spinner")) return
    const text = textOf(n)
    if (text !== undefined) {
      if (text.trim()) texts.push(text.trim())
      return
    }
    if (depth < 6) for (const child of drawn(n)) walk(child, depth + 1)
  }
  walk(node, 0)
  return texts.join(" ")
}

/** Whether any text in a row is still blank. */
function hasBlankText(node: Renderable, depth = 0): boolean {
  if (textOf(node) === "") return true
  return depth < 5 && drawn(node).some((child) => hasBlankText(child, depth + 1))
}

/** A part of an assistant message, by OpenCode's part ID: a tool call's ID, or "text:N" / "reasoning:N". */
function resolvePart(message: Message | undefined, partID: string) {
  const content = message?.content ?? []
  const tool = content.find((part) => part.type === "tool" && part.id === partID)
  if (tool) return tool
  const match = /^(text|reasoning):(\d+)$/.exec(partID)
  return match ? content.filter((part) => part.type === match[1])[Number(match[2])] : undefined
}

/**
 * The transcript is the scroll box above the prompt. The box our slot renders
 * into also holds the prompt and its autocomplete list (another scroll box), so
 * look from the level above it: the transcript is in a sibling there.
 */
function findTranscript(from: Renderable) {
  const composer = from.parent
  if (!composer) return
  for (let node = composer, depth = 0; node.parent && depth < 4; node = node.parent, depth++) {
    for (const sibling of node.parent.getChildren()) {
      if (sibling === node) continue
      const scroll = find(sibling, (n) => "verticalScrollBar" in n && "content" in n)
      if (scroll) return scroll
    }
  }
}

/**
 * The text a reply is streaming right now, if it's writing text (rather than
 * thinking or calling a tool): read fresh each time, since it grows between passes.
 */
function streamingText(messages: ReadonlyArray<Message>) {
  const reply = messages.findLast((m) => m.type === "assistant")
  if (!reply || reply.time.completed !== undefined) return
  const content = reply.content ?? []
  const latest = content.at(-1)
  if (latest?.type !== "text") return
  const ordinal = content.filter((p) => p.type === "text").length - 1
  return { messageID: reply.id, partID: `text:${ordinal}`, text: () => latest.text ?? "" }
}

/**
 * The latest tool call in a turn: what it says it's doing (a shell command's
 * description) and the hint to show under the run, as Claude Code picks it: the
 * file, the pattern, or the command.
 */
function latestCall(messages: ReadonlyArray<Message>, userID: string, directory: string | undefined) {
  const start = messages.findIndex((m) => m.id === userID)
  const end = messages.findIndex((m, i) => i > start && m.type === "user")
  const part = messages
    .slice(start + 1, end === -1 ? undefined : end)
    .flatMap((m) => (m.type === "assistant" ? (m.content ?? []) : []))
    .findLast((p) => p.type === "tool")
  if (!part?.name) return
  const input = (part.state?.input && typeof part.state.input === "object" ? part.state.input : {}) as Record<string, unknown>
  const str = (key: string) => (typeof input[key] === "string" && input[key] ? (input[key] as string) : undefined)
  const file = str("filePath") ?? str("path")
  const relative = file && directory ? path.relative(directory, file) : undefined
  const shell = part.name === "bash" || part.name === "shell"
  const hint =
    shell && str("command")
      ? commandHint(str("command")!)
      : relative && !relative.startsWith("..")
        ? relative
        : (file ?? (str("pattern") ? `"${str("pattern")}"` : (str("url") ?? str("query") ?? str("name"))))
  return { description: shell ? str("description") : undefined, hint }
}

/**
 * A run of tool calls. While it runs: a blinking dot, what it's doing, and the
 * latest command, file, or pattern under a ⎿. Once done, Claude Code leaves just
 * the dimmed summary, lined up with the replies' text.
 */
function ToolSummary(props: { context: Context; data: { text: string; active: boolean; detail?: string }; blink: boolean }) {
  const theme = () => props.context.theme
  return (
    <box flexDirection="column" marginTop={1} paddingLeft={1} flexShrink={0}>
      <Show
        when={props.data.active}
        fallback={
          <text fg={theme().text.muted} selectable={false}>
            {"  "}
            {props.data.text}
          </text>
        }
      >
        <text selectable={false}>
          <span style={{ fg: theme().text.muted }}>{props.blink ? "⏺ " : "  "}</span>
          <span style={{ fg: theme().text.base }}>{props.data.text}</span>
        </text>
        <Show when={props.data.detail}>
          {(detail: () => string) => (
            <box flexDirection="row">
              <text fg={theme().text.muted} width={5} flexShrink={0} selectable={false}>
                {"  ⎿  "}
              </text>
              <text fg={theme().text.muted} flexGrow={1} selectable={false}>
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
  context: Context
  line: { kind: "done"; verb: string; took: string; at: string } | { kind: "interrupted" }
}) {
  const theme = () => props.context.theme
  const done = () => (props.line.kind === "done" ? props.line : undefined)
  const errorColor = (): RGBA => theme().text.feedback.error.base
  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={1}>
      <Show
        when={done()}
        fallback={
          <text wrapMode="none" selectable={false}>
            <span style={{ fg: theme().text.muted }}>{"  ⎿  "}</span>
            <span style={{ fg: errorColor() }}>Interrupted</span>
            <span style={{ fg: theme().text.muted }}> · What should OpenCode do instead?</span>
          </text>
        }
      >
        {(line: () => { verb: string; took: string; at: string }) => (
          <text fg={theme().text.muted} wrapMode="none" selectable={false}>
            ✻ {line().verb} for {line().took} · done {line().at}
          </text>
        )}
      </Show>
    </box>
  )
}

