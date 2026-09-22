/** @jsxImportSource @opentui/solid */
import type { Renderable, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { contextUsage, lastTurn, type Limits, usageLine } from "./format"
import { fetchLimits, hasLimits } from "./limits"
import { drawn, find, textOf } from "./tree"

/** OpenCode's own usage text under the prompt: "15.9K (8%)", maybe "· $0.12". */
const OPENCODE_USAGE = /^\d[\d.,]*[KMB]?( \(\d+%\))?( · \S+)?$/

const REFRESH = 5 * 60_000
const AFTER_TURN = 30_000

/** Limits by provider, shared by every session view so switching doesn't refetch. */
const cache = new Map<string, { limits?: Limits; at: number }>()
const pending = new Set<string>()
const [version, setVersion] = createSignal(0)

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

/**
 * Replace OpenCode's "15.9K (8%)" left of `ctrl+p commands` with
 * "15.9k | ctx 8% | 5h: 48% | 7d: 6%". The 5h and 7d parts show only for a
 * ChatGPT or Claude subscription (see limits.ts). The limits are fetched when the
 * session is opened, 30 seconds or more after each turn, and every 5 minutes.
 */
export function useUsageLine(api: TuiPluginApi, sessionID: () => string, anchor: () => Renderable | undefined) {
  const theme = () => api.theme.current
  const usage = createMemo(() => contextUsage(api.state.session.messages(sessionID()), api.state.provider))
  // Columns left in the row for the line, measured each pass.
  const [room, setRoom] = createSignal(Infinity)
  const line = createMemo(() => {
    version()
    const u = usage()
    if (!u) return ""
    const cost = api.state.session.get(sessionID())?.cost ?? 0
    return usageLine({
      tokens: u.tokens,
      percent: u.percent,
      cost: cost > 0 ? usd.format(cost) : undefined,
      limits: u.providerID ? cache.get(u.providerID)?.limits : undefined,
    }, room())
  })
  const node = (
    <text fg={theme().textMuted} wrapMode="none" selectable={false}>
      {line()}
    </text>
  ) as unknown as Renderable
  let replaced: Renderable | undefined

  const refresh = () => {
    const providerID = usage()?.providerID
    if (!providerID || !hasLimits(providerID) || pending.has(providerID)) return
    const entry = cache.get(providerID)
    const ended = lastTurn(api.state.session.messages(sessionID()))?.end ?? 0
    const age = Date.now() - (entry?.at ?? 0)
    if (entry && age < REFRESH && !(ended > entry.at && age > AFTER_TURN)) return
    pending.add(providerID)
    fetchLimits(providerID).then((limits) => {
      pending.delete(providerID)
      cache.set(providerID, { limits, at: Date.now() })
      setVersion((v) => v + 1)
    })
  }

  const sync = () => {
    refresh()
    const host = anchor()
    if (!host || host.isDestroyed) return
    const theirs = find(host, (n) => {
      const text = textOf(n)
      if (!text || !OPENCODE_USAGE.test(text) || !n.parent) return false
      // Only the one next to OpenCode's keybind hints.
      return drawn(n.parent).some((s) => /(commands|agents)$/.test(textOf(s) ?? ""))
    })
    if (replaced && replaced !== theirs && !replaced.isDestroyed) replaced.visible = true
    replaced = theirs
    if (!theirs || !usage()) {
      node.parent?.remove(node)
      if (theirs) theirs.visible = true
      return
    }
    theirs.visible = false
    const parent = theirs.parent!
    setRoom(roomFor(parent.parent, [node, theirs]))
    const children = parent.getChildren()
    if (node.parent !== parent || children.indexOf(node) !== children.indexOf(theirs) - 1) {
      node.parent?.remove(node)
      parent.insertBefore(node, theirs)
    }
  }

  onMount(() => {
    const timer = setInterval(sync, 250)
    onCleanup(() => {
      clearInterval(timer)
      node.parent?.remove(node)
      if (!node.isDestroyed) node.destroyRecursively()
      if (replaced && !replaced.isDestroyed) replaced.visible = true
    })
  })
}

/**
 * How many columns the usage line can have without squeezing the rest of the row:
 * the row's width, less the text of everything else in it (the mode line, the
 * keybind hints) and a column between each, plus a little slack.
 */
function roomFor(row: Renderable | null, skip: Renderable[]) {
  if (!row || row.width <= 0) return Infinity
  let used = 0
  const walk = (node: Renderable, depth: number) => {
    if (!node.visible || skip.includes(node)) return
    const text = textOf(node)
    if (text !== undefined) {
      if (text) used += Array.from(text).length + 1
      return
    }
    if (depth < 5) for (const child of drawn(node)) walk(child, depth + 1)
  }
  walk(row, 0)
  return Math.max(0, row.width - used - 4)
}
