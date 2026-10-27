/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import type { RGBA, Renderable } from "@opentui/core"
import { createEffect, createSignal, getOwner, onCleanup, onMount, Show } from "solid-js"
import { type Detached, detach } from "./detach"
import { claudeSummary, formatClock, formatDuration, turnOf, turnVerb, type TurnMessage } from "./format"
import { adoptMarkdown, heldBack } from "./pacing"
import { verbositySet } from "./theme"
import { blankBar, debug, drawn, find, idOf, isMarkdown, onBeforeRender, placeBefore, placeIn, textOf } from "./tree"

type Context = Plugin.Context

export const EXPAND_COMMAND = "claude.transcript.expand"
const THINKING_COMMAND = "session.toggle.thinking"
const VERBOSITY_COMMAND = "session.verbosity.cycle"

/** OpenCode's transcript verbosity ("low", "medium", "high"), from its cycle command's title. */
function verbosity(context: Context) {
  const title = context.keymap.commands().find((command) => command.id === VERBOSITY_COMMAND)?.title
  return /^Verbosity: (\w+)/i.exec(title ?? "")?.[1]?.toLowerCase()
}

/** Whether OpenCode is hiding thinking: its toggle offers to expand it. */
function thinkingHidden(context: Context) {
  return context.keymap.commands().find((command) => command.id === THINKING_COMMAND)?.title === "Expand thinking"
}

/**
 * Cycle OpenCode's verbosity until it's `target`. OpenCode saves the setting
 * before the command's title changes, so wait for each step to land.
 */
async function setVerbosity(context: Context, target: string) {
  for (let step = 0; step < 3; step++) {
    const now = verbosity(context)
    if (!now || now === target) return
    context.keymap.dispatch(VERBOSITY_COMMAND)
    for (let wait = 0; wait < 20 && verbosity(context) === now; wait++) await new Promise((r) => setTimeout(r, 50))
  }
}

/**
 * Claude Code's folding, from OpenCode's own: at its "low" verbosity OpenCode
 * folds each run of tool calls and thinking into one line, which the transcript
 * words the way Claude Code does. The first time a session opens with no
 * verbosity set in cli.json, this sets it to low.
 *
 * ctrl+o switches to "high" and back, like Claude Code's ctrl+o, in sessions
 * (OpenCode's own ctrl+o, its recent-sessions menu, still works on the home
 * screen). Expanding also turns on OpenCode's thinking display if it was hidden,
 * and collapsing puts it back. Rebind it in cli.json's keybinds under
 * "claude.transcript.expand".
 */
export function ExpandKey(props: { context: Context }) {
  const context = props.context
  let restoreThinking = false
  let defaulted = false
  const toggleThinking = () => context.keymap.dispatch(THINKING_COMMAND)
  // Read outside the layer: the command list it comes from includes the layer.
  const [level, setLevel] = createSignal<string | undefined>()
  createEffect(() => setLevel(verbosity(context)))
  createEffect(() => {
    if (defaulted || context.ui.router.current().type !== "session" || !level()) return
    defaulted = true
    if (!verbositySet()) void setVerbosity(context, "low")
  })
  context.keymap.layer(() => ({
    priority: 10,
    enabled: () => context.ui.router.current().type === "session",
    commands: [
      {
        id: EXPAND_COMMAND,
        title: level() === "high" ? "Collapse tool calls and thinking" : "Expand tool calls and thinking",
        group: "Session",
        bind: "ctrl+o",
        palette: true,
        run() {
          const expand = verbosity(context) !== "high"
          void setVerbosity(context, expand ? "high" : "low")
          if (expand && thinkingHidden(context)) {
            restoreThinking = true
            toggleThinking()
          } else if (!expand && restoreThinking) {
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
type Message = TurnMessage & { agent?: string }

/** What a row of OpenCode's transcript turned out to be. */
type Row = { type: "user"; messageID: string } | { type: "text" | "footer" | "empty" | "unsettled" | "other" }

type Decoration = Detached<unknown> & { used: boolean }

/** "build" → "Build", as OpenCode titles agents in its footer. */
function titlecase(text: string) {
  return text.replace(/(^|[\s_-])(\w)/g, (_, sep: string, c: string) => sep + c.toUpperCase())
}

/**
 * Restyle OpenCode's session transcript like Claude Code's:
 *
 * - User messages lose their colored bar and padding and get a `❯`.
 * - Replies get a `⏺` bullet. A reply that hasn't finished a line yet stays
 *   hidden (see pacing.tsx).
 * - OpenCode's folded runs of tool calls ("+ 4 commands, 1 thought") are worded
 *   as Claude Code words them: "+ Ran 4 shell commands".
 * - OpenCode's "Build · model · 12s" line after each reply becomes
 *   "✻ Worked for 12s · done 4:00 PM", or "⎿ Interrupted".
 *
 * OpenCode gives plugins no hook into the transcript, so this reads what it drew
 * and adjusts it just before each frame is drawn. Anything it doesn't recognize
 * is left as OpenCode drew it.
 */
export function useTranscript(context: Context, sessionID: () => string, anchor: () => Renderable | undefined) {
  const theme = () => context.theme
  const decorations = new Map<string, Decoration>()
  const ours = new WeakSet<Renderable>()
  const restyled = new WeakSet<Renderable>()
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
    // A reply's text: a padded box holding the markdown.
    if (idOf(kids(body[0])[0]).startsWith("markdown")) return { type: "text" }
    const label = leadingText(node)
    for (const agent of agents) {
      if (label === agent || label.startsWith(`${agent} · `)) return { type: "footer" }
    }
    return { type: "other" }
  }

  const sync = () => {
    const host = anchor()
    if (!host || host.isDestroyed) return
    if (!scroll || scroll.isDestroyed) scroll = findTranscript(host)
    if (!scroll) return

    for (const d of decorations.values()) d.used = false
    const next = new Set<Renderable>()
    const id = sessionID()
    const messages = context.data.session.message.list(id) as ReadonlyArray<Message>
    const byID = new Map(messages.map((m) => [m.id, m]))
    const agents = new Set(messages.flatMap((m) => (m.type === "assistant" && m.agent ? [titlecase(m.agent)] : [])))
    const busy = context.data.session.status(id) === "running"
    const latestUser = messages.findLast((m) => m.type === "user")
    const footers = new Map<string, Renderable[]>()
    let user: Message | undefined
    let folds = 0
    adoptMarkdown(scroll)

    for (const node of scroll.getChildren()) {
      const row = settle(node, classify(node, byID, agents))
      if (row.type === "unsettled") hide(node, next)
      else if (row.type === "user") {
        user = byID.get(row.messageID)
        restyleUser(node)
      } else if (row.type === "footer") {
        if (user) footers.set(user.id, [...(footers.get(user.id) ?? []), node])
      } else if (row.type === "other") {
        reword(node, `${user?.id ?? "start"}:${folds++}`, next)
      } else if (row.type === "text") {
        const markdown = find(node, isMarkdown)
        // Nothing finished yet: show nothing, not an empty bullet.
        if (markdown && heldBack(markdown)) {
          hide(node, next)
          continue
        }
        const body = kids(node)[0]
        if (body) {
          placeIn(
            decoration(`bullet:${idOf(node)}`, null, () => (
              <text position="absolute" left={1} top={0} fg={theme().text.base} selectable={false}>
                ⏺
              </text>
            )),
            body,
          )
        }
      }
    }

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

    // Put back anything hidden last pass that isn't hidden this pass, then drop
    // decorations whose rows are gone.
    for (const node of hidden) if (!next.has(node) && !node.isDestroyed && !node.visible) node.visible = true
    hidden = next
    for (const [key, d] of decorations) {
      if (d.used) continue
      d.dispose()
      decorations.delete(key)
    }
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
    // even for a frame. The timer catches rows that settle while nothing redraws.
    const stop = onBeforeRender(context.renderer.root, safeSync)
    const timer = setInterval(safeSync, 100)
    onCleanup(() => {
      stop()
      clearInterval(timer)
      for (const node of hidden) if (!node.isDestroyed) node.visible = true
      for (const d of decorations.values()) d.dispose()
      decorations.clear()
    })
  })

  /**
   * Word OpenCode's summary of a folded run as Claude Code does. The summary is
   * found by what it says, hidden, and ours put beside it in the same row, so
   * clicking it still opens the run. Its icon (+ or −) shows once the run is
   * done; while it's going OpenCode shows a spinner instead.
   */
  function reword(node: Renderable, key: string, next: Set<Renderable>) {
    const label = find(node, (n) => !ours.has(n) && claudeSummary(textOf(n) ?? "", false) !== undefined)
    const parent = label?.parent
    if (!label || !parent) return
    const siblings = kids(parent)
    const icon = textOf(siblings[siblings.indexOf(label) - 1])?.trim()
    const text = claudeSummary(textOf(label)!, icon !== "+" && icon !== "−")!
    hide(label, next)
    placeBefore(
      decoration(`fold:${key}`, { text, fg: (label as { fg?: RGBA }).fg }, (data) => (
        <text flexGrow={1} wrapMode="none" fg={data().fg} selectable={false}>
          {data().text}
        </text>
      )),
      label,
    )
  }

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
