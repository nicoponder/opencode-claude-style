import { readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

export type ModelRef = { providerID: string; modelID: string }
export type ProviderInfo = { id: string; name?: string; models?: Record<string, { name?: string }> }

/**
 * Best-effort "Model · Provider" line, mirroring the order OpenCode itself uses to
 * pick a model: config.model, then the most recently used model, then the first
 * provider's default model.
 */
export function describeModel(input: {
  providers: ReadonlyArray<ProviderInfo>
  configured?: string
  recent: ReadonlyArray<ModelRef>
  defaults: Record<string, string>
}): string | undefined {
  const candidates: ModelRef[] = []
  if (input.configured?.includes("/")) {
    const [providerID, ...rest] = input.configured.split("/")
    candidates.push({ providerID, modelID: rest.join("/") })
  }
  candidates.push(...input.recent)
  const first = input.providers[0]
  if (first) {
    const fallback = input.defaults[first.id] ?? Object.keys(first.models ?? {})[0]
    if (fallback) candidates.push({ providerID: first.id, modelID: fallback })
  }

  for (const item of candidates) {
    const provider = input.providers.find((p) => p.id === item.providerID)
    const model = provider?.models?.[item.modelID]
    if (provider && model) return `${model.name ?? item.modelID} · ${provider.name ?? provider.id}`
  }
}

export function readRecentModels(stateDir: string | undefined): ModelRef[] {
  if (!stateDir) return []
  try {
    const data = JSON.parse(readFileSync(path.join(stateDir, "model.json"), "utf8")) as { recent?: ModelRef[] }
    return Array.isArray(data.recent) ? data.recent : []
  } catch {
    return []
  }
}

export function safeUsername() {
  try {
    return os.userInfo().username
  } catch {
    return "there"
  }
}

export function abbreviateHome(dir: string) {
  const home = os.homedir()
  if (home && (dir === home || dir.startsWith(home + path.sep))) return "~" + dir.slice(home.length)
  return dir
}

export function truncateEnd(text: string, max: number) {
  if (max <= 0) return ""
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)) + "…"
}

export function truncateStart(text: string, max: number) {
  if (max <= 0) return ""
  if (text.length <= max) return text
  return "…" + text.slice(text.length - max + 1)
}

export function relativeTime(ms: number | undefined, now = Date.now()) {
  if (!ms) return ""
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

/** Durations the way Claude Code prints them: "12s", "1m 5s", "1h 2m 3s". */
export function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** The fields of an OpenCode message that `lastTurn` needs. */
export type TurnMessage = {
  id: string
  role: "user" | "assistant"
  parentID?: string
  time: { created: number; completed?: number }
  error?: { name: string }
  tokens?: { output: number; reasoning: number }
}

/** The fields of an OpenCode message part that `turnProgress` needs. */
export type TurnPart = {
  type: string
  text?: string
  time?: { start?: number; end?: number }
  state?: { input?: unknown }
}

/**
 * The latest turn in a session: from the last user message until its final reply
 * completed. `end` is missing while the turn is still running, and `failed` is set
 * when a reply errored or was interrupted.
 */
export function lastTurn(messages: ReadonlyArray<TurnMessage>) {
  const user = [...messages].reverse().find((m) => m.role === "user")
  if (!user) return
  return turnOf(messages, user)
}

/** The turn that `user` started, as `lastTurn` describes it, plus whether it was interrupted. */
export function turnOf(messages: ReadonlyArray<TurnMessage>, user: TurnMessage) {
  const replies = messages.filter((m) => m.role === "assistant" && m.parentID === user.id)
  const done = replies.length > 0 && replies.every((m) => m.time.completed)
  return {
    start: user.time.created,
    end: done ? Math.max(...replies.map((m) => m.time.completed!)) : undefined,
    failed: replies.some((m) => m.error),
    interrupted: replies.some((m) => m.error?.name === "MessageAbortedError"),
  }
}

/**
 * How far the latest turn has got, for the spinner line: when it started, roughly
 * how many tokens the model has written, and whether it's thinking right now.
 * OpenCode only counts tokens when each step finishes, so a step in progress is
 * estimated from what has streamed in, at about four characters a token.
 */
export function turnProgress(messages: ReadonlyArray<TurnMessage>, partsOf: (messageID: string) => ReadonlyArray<TurnPart>) {
  const user = [...messages].reverse().find((m) => m.role === "user")
  if (!user) return
  const replies = messages.filter((m) => m.role === "assistant" && m.parentID === user.id)
  let tokens = 0
  for (const reply of replies) {
    const counted = (reply.tokens?.output ?? 0) + (reply.tokens?.reasoning ?? 0)
    tokens += counted > 0 ? counted : estimateTokens(partsOf(reply.id))
  }
  const current = replies.at(-1)
  const latest = current ? partsOf(current.id).at(-1) : undefined
  const thinking = latest?.type === "reasoning" && latest.time?.end === undefined
  return { start: user.time.created, tokens, thinking }
}

function estimateTokens(parts: ReadonlyArray<TurnPart>) {
  let chars = 0
  for (const part of parts) {
    if (part.type === "text" || part.type === "reasoning") chars += part.text?.length ?? 0
    else if (part.type === "tool" && part.state?.input) chars += JSON.stringify(part.state.input).length
  }
  return Math.round(chars / 4)
}

/** A wall-clock time the way Claude Code prints when a turn finished: "4:00 PM". */
export function formatClock(ms: number, locale?: string) {
  return new Date(ms).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
}

/** "345 tokens", "1.2k tokens", as in Claude Code's spinner line. */
export function formatTokens(count: number) {
  const n = Math.max(0, Math.round(count))
  if (n < 1000) return `${n} ${n === 1 ? "token" : "tokens"}`
  return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k tokens`
}

/** The kinds of tool call Claude Code folds into one summary line. */
export type ToolKind = "bash" | "read" | "search" | "fetch" | "websearch" | "skill"

const toolWords: Record<ToolKind, { done: string; active: string; one: string; many: string }> = {
  read: { done: "read", active: "reading", one: "file", many: "files" },
  search: { done: "searched for", active: "searching for", one: "pattern", many: "patterns" },
  bash: { done: "ran", active: "running", one: "shell command", many: "shell commands" },
  fetch: { done: "fetched", active: "fetching", one: "URL", many: "URLs" },
  websearch: { done: "ran", active: "running", one: "web search", many: "web searches" },
  skill: { done: "loaded", active: "loading", one: "skill", many: "skills" },
}

/**
 * Claude Code's one-line summary of a run of tool calls: "Read 2 files, ran 1 shell
 * command", or "Read 2 files, running 1 shell command…" while a call is still in
 * progress. Kinds are listed in the order they first appear.
 */
export function summarizeTools(calls: ReadonlyArray<{ kind: ToolKind; active: boolean }>) {
  const counts = new Map<ToolKind, { n: number; active: boolean }>()
  for (const call of calls) {
    const count = counts.get(call.kind) ?? { n: 0, active: false }
    counts.set(call.kind, { n: count.n + 1, active: count.active || call.active })
  }
  const text = [...counts]
    .map(([kind, { n, active }]) => {
      const w = toolWords[kind]
      return `${active ? w.active : w.done} ${n} ${n === 1 ? w.one : w.many}`
    })
    .join(", ")
  const line = text.charAt(0).toUpperCase() + text.slice(1)
  return calls.some((call) => call.active) ? line + "…" : line
}

/**
 * Claude Code's footer label for an OpenCode agent: lowercase, with ⏸ for plan
 * mode and ⏵⏵ (Claude Code's accept-edits glyph) for agents that act.
 */
export function modeLabel(agent: string) {
  const name = agent.toLowerCase()
  return { glyph: name === "plan" ? "⏸" : "⏵⏵", name }
}

/** "999", "14.9k", "1.2M": token counts as the usage line under the prompt prints them. */
export function formatCount(count: number) {
  const n = Math.max(0, Math.round(count))
  const short = (value: number, unit: string) => `${value.toFixed(1).replace(/\.0$/, "")}${unit}`
  if (n < 1000) return String(n)
  if (n < 999_950) return short(n / 1000, "k")
  return short(n / 1_000_000, "M")
}

type UsageMessage = {
  role: string
  providerID?: string
  modelID?: string
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
}
type UsageProvider = { id: string; models: Record<string, { limit?: { context?: number } }> }

/**
 * How full the context is, worked out the way OpenCode's own "15.9K (8%)" is: the
 * latest reply's tokens, as a share of its model's context window.
 */
export function contextUsage(messages: ReadonlyArray<UsageMessage>, providers: ReadonlyArray<UsageProvider>) {
  const reply = [...messages].reverse().find((m) => m.role === "assistant" && (m.tokens?.output ?? 0) > 0)
  const t = reply?.tokens
  if (!reply || !t) return
  const tokens = t.input + t.output + t.reasoning + t.cache.read + t.cache.write
  if (tokens <= 0) return
  const limit = providers.find((p) => p.id === reply.providerID)?.models[reply.modelID ?? ""]?.limit?.context
  return { tokens, percent: limit ? Math.round((tokens / limit) * 100) : undefined, providerID: reply.providerID }
}

/** A subscription's rolling usage windows, as percentages used. */
export type Limits = { fiveHour?: number; sevenDay?: number }

/**
 * "14.9k | ctx 25% | $0.12 | 5h: 48% | 7d: 6%", leaving out whatever isn't known.
 * If that's longer than `max` columns, parts are dropped until it fits: the token
 * count first, then the cost, the context, and the 7-day and 5-hour limits.
 */
export function usageLine(input: { tokens: number; percent?: number; cost?: string; limits?: Limits }, max = Infinity) {
  const pct = (value: number) => `${Math.round(value)}%`
  const parts = [
    { text: formatCount(input.tokens), drop: 0 },
    { text: input.percent !== undefined ? `ctx ${pct(input.percent)}` : undefined, drop: 2 },
    { text: input.cost, drop: 1 },
    { text: input.limits?.fiveHour !== undefined ? `5h: ${pct(input.limits.fiveHour)}` : undefined, drop: 4 },
    { text: input.limits?.sevenDay !== undefined ? `7d: ${pct(input.limits.sevenDay)}` : undefined, drop: 3 },
  ].filter((part): part is { text: string; drop: number } => !!part.text)
  const join = () => parts.map((part) => part.text).join(" | ")
  while (parts.length && join().length > max) {
    parts.splice(parts.indexOf(parts.reduce((a, b) => (b.drop < a.drop ? b : a))), 1)
  }
  return join()
}
