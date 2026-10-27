/** @jsxImportSource @opentui/solid */
// In a .tsx file on purpose: OpenCode maps solid-js to its own copy only for JSX
// modules, and only its copy tracks reads of the session's messages.
import type { Plugin } from "@opencode/plugin/tui"
import type { Renderable } from "@opentui/core"
import { createEffect, createMemo, createRoot, untrack } from "solid-js"
import { childrenOf, debug, interceptPrototypeSetter, isMarkdown } from "./tree"

type Part = { type: string; text?: string }
type Message = { type: string; time: { completed?: number }; content?: ReadonlyArray<Part> }

/** Markdowns holding back a streaming reply, with the full text OpenCode gave each. */
const held = new Map<Renderable, string>()
let live: (() => string | undefined) | undefined
let unpatch: (() => void) | undefined
let setContent: ((node: Renderable, value: string) => void) | undefined
let stop: (() => void) | undefined

/** Whether `value` is (the start of) the reply text streaming now. */
function isStreaming(value: string, text: string) {
  const start = value.trim()
  return start.length > 0 && text.trimStart().startsWith(start)
}

/**
 * Pace replies the way Claude Code does: while a reply streams, it shows only up
 * to its last finished line, so prose arrives a line at a time rather than word
 * by word.
 *
 * Rather than find each reply in OpenCode's transcript, this wraps the markdown
 * component's `content` setter once, on its prototype (see adoptMarkdown), and
 * holds back whatever OpenCode sets that is the reply streaming in the open
 * session, read from its messages. Any other markdown passes straight through.
 * Returns a function that stops pacing and gives every reply its full text.
 */
export function startPacing(context: Plugin.Context) {
  stop?.()
  const dispose = createRoot((dispose) => {
    const text = createMemo(() => {
      const route = context.ui.router.current()
      if (route.type !== "session") return
      return streamingText(context.data.session.message.list(route.sessionID) as ReadonlyArray<Message>)
    })
    live = text
    // A reply that's done (or has moved on to a tool call) gets its last line back.
    createEffect(() => {
      const now = text()
      for (const [node, full] of held) {
        if (now !== undefined && isStreaming(full, now)) continue
        held.delete(node)
        if (!node.isDestroyed) setContent?.(node, full)
      }
    })
    return dispose
  })
  stop = () => {
    dispose()
    unpatch?.()
    for (const [node, full] of held) if (!node.isDestroyed) setContent?.(node, full)
    held.clear()
    live = unpatch = setContent = stop = undefined
  }
  return stop
}

/**
 * Wrap the markdown component's `content` setter, from the first markdown found
 * under `root` (the plugin's copy of OpenTUI may not be OpenCode's, so the class
 * is taken from one of OpenCode's nodes). Once done, this does nothing.
 */
export function adoptMarkdown(root: Renderable) {
  if (unpatch || !live) return
  const markdowns: Renderable[] = []
  const walk = (node: Renderable, depth: number) => {
    if (isMarkdown(node)) markdowns.push(node)
    else if (depth < 8) for (const child of childrenOf(node)) walk(child, depth + 1)
  }
  walk(root, 0)
  if (!markdowns.length) return
  const patched = interceptPrototypeSetter<unknown>(markdowns[0], "content", (node, value, set) => {
    const now = live && untrack(live)
    if (typeof value !== "string" || now === undefined || !isStreaming(value, now)) {
      held.delete(node)
      return set(value)
    }
    held.set(node, value)
    const end = value.lastIndexOf("\n")
    set(end === -1 ? "" : value.slice(0, end).trimEnd())
  })
  if (!patched) return debug("pacing: markdown has no content setter")
  unpatch = patched.restore
  setContent = (node, value) => patched.set(node, value)
  // Put whatever's already showing through the wrapper, in case a reply is streaming.
  for (const node of markdowns) {
    const current = (node as { content?: unknown }).content
    if (typeof current === "string") (node as { content?: unknown }).content = current
  }
}

/** Whether a markdown is holding back all of its reply so far: nothing finished yet. */
export function heldBack(node: Renderable) {
  return held.has(node) && (node as { content?: unknown }).content === ""
}

/** The text a reply is streaming right now, if it's writing text (rather than thinking or calling a tool). */
function streamingText(messages: ReadonlyArray<Message>) {
  const reply = messages.findLast((m) => m.type === "assistant")
  if (!reply || reply.time.completed !== undefined) return
  const latest = reply.content?.at(-1)
  return latest?.type === "text" ? (latest.text ?? "") : undefined
}
