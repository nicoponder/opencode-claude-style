import os from "node:os"
import path from "node:path"

/** The prompt's selected model, as OpenCode reports it. */
export type ModelRef = { providerID: string; modelID: string }
export type ModelInfo = { id: string; providerID: string; name?: string; limit?: { context?: number } }
export type ProviderInfo = { id: string; name?: string }

/** "Model · Provider" for the prompt's selected model, with IDs where names are unknown. */
export function describeModel(
  selected: ModelRef | undefined,
  models: ReadonlyArray<ModelInfo>,
  providers: ReadonlyArray<ProviderInfo>,
): string | undefined {
  if (!selected) return
  const model = models.find((m) => m.providerID === selected.providerID && m.id === selected.modelID)
  const provider = providers.find((p) => p.id === selected.providerID)
  return `${model?.name ?? selected.modelID} · ${provider?.name ?? selected.providerID}`
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

/** A piece of an assistant message's content, as far as the helpers here need it. */
export type TurnPart = {
  type: string
  text?: string
  time?: { created?: number; completed?: number }
  state?: { input?: unknown }
}

/**
 * The fields of an OpenCode session message that the turn helpers need. A turn is
 * a user message and everything after it up to the next one; OpenCode closes it
 * with an `idle` message saying how it went.
 */
export type TurnMessage = {
  id: string
  type: string
  time: { created: number; completed?: number }
  error?: unknown
  tokens?: { output: number; reasoning: number }
  content?: ReadonlyArray<TurnPart>
  outcome?: "succeeded" | "failed" | "interrupted"
}

/** The messages of the turn that the user message at `index` started. */
function messagesOfTurn(messages: ReadonlyArray<TurnMessage>, index: number) {
  const next = messages.findIndex((m, i) => i > index && m.type === "user")
  return messages.slice(index + 1, next === -1 ? undefined : next)
}

/**
 * The latest turn in a session: from the last user message until OpenCode marked
 * it idle. `end` is missing while the turn is still running, and `failed` is set
 * when it errored or was interrupted.
 */
export function lastTurn(messages: ReadonlyArray<TurnMessage>) {
  const user = messages.findLast((m) => m.type === "user")
  if (!user) return
  return turnOf(messages, user)
}

/** The turn that `user` started, as `lastTurn` describes it, plus whether it was interrupted. */
export function turnOf(messages: ReadonlyArray<TurnMessage>, user: TurnMessage) {
  const rest = messagesOfTurn(messages, messages.indexOf(user))
  const idle = rest.find((m) => m.type === "idle")
  const replies = rest.filter((m) => m.type === "assistant")
  const completed = replies.flatMap((m) => (m.time.completed ? [m.time.completed] : []))
  return {
    start: user.time.created,
    end: idle ? Math.max(idle.time.created, ...completed) : undefined,
    failed: idle ? idle.outcome !== "succeeded" : replies.some((m) => m.error),
    interrupted: idle?.outcome === "interrupted",
  }
}

/**
 * How far the latest turn has got, for the spinner line: when it started, roughly
 * how many tokens the model has written, and whether it's thinking right now.
 * OpenCode only counts tokens when each step finishes, so a step in progress is
 * estimated from what has streamed in, at about four characters a token.
 */
export function turnProgress(messages: ReadonlyArray<TurnMessage>) {
  const index = messages.findLastIndex((m) => m.type === "user")
  if (index === -1) return
  const replies = messagesOfTurn(messages, index).filter((m) => m.type === "assistant")
  let tokens = 0
  for (const reply of replies) {
    const counted = (reply.tokens?.output ?? 0) + (reply.tokens?.reasoning ?? 0)
    tokens += counted > 0 ? counted : estimateTokens(reply.content ?? [])
  }
  const latest = replies.at(-1)?.content?.at(-1)
  const thinking = latest?.type === "reasoning" && latest.time?.completed === undefined
  return { start: messages[index].time.created, tokens, thinking }
}

function estimateTokens(parts: ReadonlyArray<TurnPart>) {
  let chars = 0
  for (const part of parts) {
    if (part.type === "text" || part.type === "reasoning") chars += part.text?.length ?? 0
    else if (part.type === "tool" && part.state?.input) {
      const input = part.state.input
      chars += typeof input === "string" ? input.length : JSON.stringify(input).length
    }
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
export type ToolKind = "bash" | "read" | "list" | "search" | "fetch" | "websearch" | "skill"

const toolWords: Record<ToolKind, { done: string; active: string; one: string; many: string }> = {
  read: { done: "read", active: "reading", one: "file", many: "files" },
  list: { done: "listed", active: "listing", one: "directory", many: "directories" },
  search: { done: "searched for", active: "searching for", one: "pattern", many: "patterns" },
  bash: { done: "ran", active: "running", one: "shell command", many: "shell commands" },
  fetch: { done: "fetched", active: "fetching", one: "URL", many: "URLs" },
  websearch: { done: "ran", active: "running", one: "web search", many: "web searches" },
  skill: { done: "loaded", active: "loading", one: "skill", many: "skills" },
}

/**
 * Claude Code's one-line summary of a run of tool calls: "Read 2 files, ran 1 shell
 * command", or "Reading 2 files, running 1 shell command…" while the run is still
 * going. Kinds are listed in the order they first appear.
 */
export function summarizeTools(kinds: ReadonlyArray<ToolKind>, active: boolean) {
  const counts = new Map<ToolKind, number>()
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  const text = [...counts]
    .map(([kind, n]) => {
      const w = toolWords[kind]
      return `${active ? w.active : w.done} ${n} ${n === 1 ? w.one : w.many}`
    })
    .join(", ")
  const line = text.charAt(0).toUpperCase() + text.slice(1)
  return active && line ? line + "…" : line
}

// Claude Code's shell commands that only look at things, so they count as reads,
// searches, or listings in a summary rather than as shell commands.
const searchCommands = new Set(["find", "grep", "rg", "ag", "ack", "locate", "which", "whereis"])
const readCommands = new Set(["cat", "head", "tail", "less", "more", "wc", "stat", "file", "strings", "jq", "awk", "cut", "sort", "uniq", "tr"])
const listCommands = new Set(["ls", "tree", "du"])
const neutralCommands = new Set(["echo", "printf", "true", "false", ":"])

/**
 * What a shell command counts as in a summary, as Claude Code decides it: every
 * part of a pipeline or `&&` chain must list, read, or search (ignoring `echo` and
 * the like), or it's just a shell command.
 */
export function commandKind(command: string): ToolKind {
  const words = command
    .split(/\|\||&&|[|;\n]/)
    .map((part) => part.trim().split(/\s+/)[0] ?? "")
    .filter((word) => word && !neutralCommands.has(word))
  if (!words.length) return "bash"
  if (words.every((word) => listCommands.has(word))) return "list"
  if (!words.every((word) => listCommands.has(word) || readCommands.has(word) || searchCommands.has(word))) return "bash"
  return words.some((word) => searchCommands.has(word)) ? "search" : "read"
}

/** "$ npm test" for the hint under a running group: one line of whitespace, capped. */
export function commandHint(command: string, max = 300) {
  const hint = "$ " + command.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n")
  return hint.length > max ? hint.slice(0, max - 1) + "…" : hint
}

/** Claude Code's past-tense verbs for "✻ Worked for 12s", one per turn. */
const turnVerbs = ["Baked", "Brewed", "Churned", "Cogitated", "Cooked", "Crunched", "Sautéed", "Worked"]

/** A verb for a turn, picked from its ID so it stays the same every time it's drawn. */
export function turnVerb(id: string) {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return turnVerbs[hash % turnVerbs.length]
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
  id: string
  type: string
  status?: string
  model?: { providerID: string; id: string }
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
}

/**
 * How full the context is, worked out the way OpenCode's own "15.9K (1%)" is: the
 * latest reply's tokens since the last compaction (and before `boundary`, a
 * reverted message, if any), as a share of its model's context window.
 */
export function contextUsage(messages: ReadonlyArray<UsageMessage>, models: ReadonlyArray<ModelInfo>, boundary?: string) {
  const at = boundary ? messages.findIndex((m) => m.id === boundary) : -1
  if (boundary && at === -1) return
  const end = at === -1 ? messages.length : at
  const compacted = messages.findLastIndex((m, i) => m.type === "compaction" && m.status === "completed" && i < end)
  const reply = messages.findLast((m, i) => m.type === "assistant" && m.tokens !== undefined && i > compacted && i < end)
  const t = reply?.tokens
  if (!reply?.model || !t) return
  const tokens = t.input + t.output + t.reasoning + t.cache.read + t.cache.write
  if (tokens <= 0) return
  const { providerID, id } = reply.model
  const limit = models.find((m) => m.providerID === providerID && m.id === id)?.limit?.context
  return { tokens, percent: limit ? Math.round((tokens / limit) * 100) : undefined, providerID }
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
