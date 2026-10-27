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

/** A subscription's rolling usage windows, as percentages used, and when each resets (epoch ms). */
export type Limits = { fiveHour?: number; sevenDay?: number; fiveHourResets?: number; sevenDayResets?: number }

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

/**
 * A model's suggested next prompt, tidied for the placeholder: its first line,
 * without wrapping quotes. Nothing if it's empty, NONE, or too long to be a prompt.
 */
export function cleanSuggestion(text: string, max = 150) {
  const line = text.trim().split("\n")[0].trim().replace(/^(["'`“])(.*)(["'`”])$/, "$2").trim()
  if (!line || /^none\.?$/i.test(line) || line.length > max) return
  return line
}

/** The kinds OpenCode counts in a folded run of tool calls: "4 commands, 1 thought". */
const summaryKinds = "command|edit|thought|read|tool|instruction"
const nativeSummary = new RegExp(`^\\d+ (?:${summaryKinds})s?(?:, \\d+ (?:${summaryKinds})s?)*$`)

const summaryWords: Record<string, { done: string; active: string; one: string; many: string }> = {
  command: { done: "ran", active: "running", one: "shell command", many: "shell commands" },
  read: { done: "read", active: "reading", one: "file", many: "files" },
  edit: { done: "edited", active: "editing", one: "file", many: "files" },
  tool: { done: "used", active: "using", one: "tool", many: "tools" },
  instruction: { done: "loaded", active: "loading", one: "instruction file", many: "instruction files" },
}

/**
 * OpenCode's summary of a folded run ("4 commands, 1 read, 1 thought"), worded as
 * Claude Code words it: "Ran 4 shell commands, read 1 file", or "Running 4 shell
 * commands, reading 1 file…" while the run is going. Thinking isn't counted, as
 * Claude Code doesn't show it. Undefined for anything that isn't such a summary.
 */
export function claudeSummary(label: string, active: boolean) {
  if (!nativeSummary.test(label)) return
  const items = label.split(", ").flatMap((item) => {
    const [count, word] = item.split(" ")
    const kind = word.replace(/s$/, "")
    return kind === "thought" ? [] : [{ n: Number(count), words: summaryWords[kind] }]
  })
  if (!items.length) return active ? "Thinking…" : "Thought"
  const text = items.map(({ n, words }) => `${active ? words.active : words.done} ${n} ${n === 1 ? words.one : words.many}`).join(", ")
  const line = text.charAt(0).toUpperCase() + text.slice(1)
  return active ? line + "…" : line
}

/** Context use (percent of the window) at which the footer warns, as Claude Code does near auto-compact. */
export const CONTEXT_WARNING = 80

/** "15% context left · /compact" once the context is CONTEXT_WARNING% full. */
export function contextWarning(percent: number | undefined) {
  if (percent === undefined || percent < CONTEXT_WARNING) return
  return `${Math.max(0, 100 - Math.round(percent))}% context left · /compact`
}

/** A usage bar, "████░░░░", `width` cells long, for a percentage used. */
export function usageBar(percent: number, width = 20) {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return "█".repeat(filled) + "░".repeat(width - filled)
}

/** When a limit resets: "4:00 PM" today, "Tue 4:00 PM" this week, "Nov 3" after that. */
export function formatReset(at: number, now = Date.now(), locale?: string) {
  const date = new Date(at)
  const time = date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
  if (date.toDateString() === new Date(now).toDateString()) return time
  if (at - now < 6 * 86_400_000) return `${date.toLocaleDateString(locale, { weekday: "short" })} ${time}`
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" })
}

/** A run of status-line text in one style. Colors are hex; unset means the default. */
export type AnsiSegment = { text: string; fg?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean }

const ansi16 = [
  "#000000", "#CD0000", "#00CD00", "#CDCD00", "#0000EE", "#CD00CD", "#00CDCD", "#E5E5E5",
  "#7F7F7F", "#FF0000", "#00FF00", "#FFFF00", "#5C5CFF", "#FF00FF", "#00FFFF", "#FFFFFF",
]

const hex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0").toUpperCase()).join("")

/** One of the 256 xterm colors, as hex. */
function ansi256(n: number) {
  if (n < 16) return ansi16[n]
  if (n >= 232) return hex(8 + (n - 232) * 10, 8 + (n - 232) * 10, 8 + (n - 232) * 10)
  const level = (v: number) => (v === 0 ? 0 : 55 + v * 40)
  const i = n - 16
  return hex(level(Math.floor(i / 36)), level(Math.floor(i / 6) % 6), level(i % 6))
}

/**
 * A status-line command's output line as styled segments, from its ANSI SGR
 * codes (the 16, 256, and true-color forms, bold, dim, italic, underline).
 * Other escape sequences, such as cursor moves and hyperlinks, are dropped.
 */
export function parseAnsi(line: string): AnsiSegment[] {
  const segments: AnsiSegment[] = []
  let style: Omit<AnsiSegment, "text"> = {}
  const clean = line.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
  const pattern = /\x1b\[([0-9;:]*)([A-Za-z])/g
  let at = 0
  const push = (text: string) => {
    const visible = text.replace(/\x1b./g, "")
    if (visible) segments.push({ text: visible, ...style })
  }
  for (const match of clean.matchAll(pattern)) {
    push(clean.slice(at, match.index))
    at = match.index + match[0].length
    if (match[2] !== "m") continue
    const codes = match[1] === "" ? [0] : match[1].split(/[;:]/).map(Number)
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]
      if (c === 0) style = {}
      else if (c === 1) style = { ...style, bold: true }
      else if (c === 2) style = { ...style, dim: true }
      else if (c === 3) style = { ...style, italic: true }
      else if (c === 4) style = { ...style, underline: true }
      else if (c === 22) style = { ...style, bold: undefined, dim: undefined }
      else if (c === 23) style = { ...style, italic: undefined }
      else if (c === 24) style = { ...style, underline: undefined }
      else if (c >= 30 && c <= 37) style = { ...style, fg: ansi16[c - 30] }
      else if (c >= 90 && c <= 97) style = { ...style, fg: ansi16[c - 82] }
      else if (c >= 40 && c <= 47) style = { ...style, bg: ansi16[c - 40] }
      else if (c >= 100 && c <= 107) style = { ...style, bg: ansi16[c - 92] }
      else if (c === 39) style = { ...style, fg: undefined }
      else if (c === 49) style = { ...style, bg: undefined }
      else if (c === 38 || c === 48) {
        const key = c === 38 ? "fg" : "bg"
        if (codes[i + 1] === 5 && codes[i + 2] !== undefined) {
          style = { ...style, [key]: ansi256(codes[i + 2]) }
          i += 2
        } else if (codes[i + 1] === 2 && codes[i + 4] !== undefined) {
          style = { ...style, [key]: hex(codes[i + 2], codes[i + 3], codes[i + 4]) }
          i += 4
        }
      }
    }
  }
  push(clean.slice(at))
  return segments
}
