/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import type { Renderable } from "@opentui/core"
import { createMemo, createSignal, getOwner, onCleanup, onMount } from "solid-js"
import { contextUsage, lastTurn, type Limits, type ModelInfo, usageLine } from "./format"
import { type Credential, fetchLimits, hasLimits } from "./limits"
import { turnMessages } from "./data"
import { detach } from "./detach"
import { drawn, find, placeBefore, textOf } from "./tree"

/** OpenCode's own usage text in the prompt footer: "15.9K (8%)", maybe "· $0.12", maybe after " · ". */
const OPENCODE_USAGE = /^(?: · )?\d[\d.,]*[KMB]?(?: \(\d+%\))?(?: · \$[\d.,]+)?$/

const REFRESH = 5 * 60_000
const AFTER_TURN = 30_000

/** Limits by provider, shared by every prompt so switching sessions doesn't refetch. */
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
export function useUsageLine(
  context: Plugin.Context,
  sessionID: () => string | undefined,
  footer: () => Renderable | undefined,
  ours: WeakSet<Renderable>,
) {
  const theme = () => context.theme
  const usage = createMemo(() => {
    const id = sessionID()
    const session = id ? context.data.session.get(id) : undefined
    if (!id || !session) return
    const models = (context.data.location.model.list(session.location) ?? []) as ReadonlyArray<ModelInfo>
    return contextUsage(context.data.session.message.list(id), models, session.revert?.messageID)
  })
  // Columns left in the row for the line, measured each pass.
  const [room, setRoom] = createSignal(Infinity)
  const line = createMemo(() => {
    version()
    const u = usage()
    const id = sessionID()
    if (!u || !id) return ""
    const cost = context.data.session.cost(id)
    return usageLine(
      {
        tokens: u.tokens,
        percent: u.percent,
        cost: cost > 0 ? usd.format(cost) : undefined,
        limits: cache.get(u.providerID)?.limits,
      },
      room(),
    )
  })
  const text = detach(getOwner(), null, () => (
    <text fg={theme().text.muted} wrapMode="none" selectable={false}>
      {line()}
    </text>
  ))
  ours.add(text.node)
  let replaced: Renderable | undefined

  const credentials = async () =>
    ((await context.client.credential.list().catch(() => [])) ?? []) as ReadonlyArray<Credential>

  const refresh = () => {
    const providerID = usage()?.providerID
    const id = sessionID()
    if (!id || !providerID || !hasLimits(providerID) || pending.has(providerID)) return
    const entry = cache.get(providerID)
    const ended = lastTurn(turnMessages(context, id))?.end ?? 0
    const age = Date.now() - (entry?.at ?? 0)
    if (entry && age < REFRESH && !(ended > entry.at && age > AFTER_TURN)) return
    pending.add(providerID)
    fetchLimits(providerID, credentials).then((limits) => {
      pending.delete(providerID)
      cache.set(providerID, { limits, at: Date.now() })
      setVersion((v) => v + 1)
    })
  }

  const sync = () => {
    refresh()
    const row = footer()
    if (!row || row.isDestroyed) return
    const theirs = find(row, (n) => !ours.has(n) && OPENCODE_USAGE.test(textOf(n) ?? ""))
    if (replaced && replaced !== theirs && !replaced.isDestroyed) replaced.visible = true
    replaced = theirs
    if (!theirs || !usage()) {
      text.node.parent?.remove(text.node)
      if (theirs) theirs.visible = true
      return
    }
    theirs.visible = false
    setRoom(roomFor(row, [text.node, theirs]))
    placeBefore(text.node, theirs)
  }

  onMount(() => {
    const timer = setInterval(sync, 250)
    onCleanup(() => {
      clearInterval(timer)
      text.dispose()
      if (replaced && !replaced.isDestroyed) replaced.visible = true
    })
  })
}

/**
 * How many columns the usage line can have without squeezing the rest of the row:
 * the row's width, less the text of everything else in it (the mode line, the
 * keybind hints) and a couple of columns between each, plus a little slack.
 */
function roomFor(row: Renderable, skip: Renderable[]) {
  if (row.width <= 0) return Infinity
  let used = 0
  const walk = (node: Renderable, depth: number) => {
    if (!node.visible || skip.includes(node)) return
    const text = textOf(node)
    if (text !== undefined) {
      if (text) used += Array.from(text).length + 2
      return
    }
    if (depth < 6) for (const child of drawn(node)) walk(child, depth + 1)
  }
  walk(row, 0)
  return Math.max(0, row.width - used - 4)
}
