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
}

/**
 * The latest turn in a session: from the last user message until its final reply
 * completed. `end` is missing while the turn is still running, and `failed` is set
 * when a reply errored or was interrupted.
 */
export function lastTurn(messages: ReadonlyArray<TurnMessage>) {
  const user = [...messages].reverse().find((m) => m.role === "user")
  if (!user) return
  const replies = messages.filter((m) => m.role === "assistant" && m.parentID === user.id)
  const done = replies.length > 0 && replies.every((m) => m.time.completed)
  return {
    start: user.time.created,
    end: done ? Math.max(...replies.map((m) => m.time.completed!)) : undefined,
    failed: replies.some((m) => m.error),
  }
}

/**
 * Claude Code's footer label for an OpenCode agent: lowercase, with ⏸ for plan
 * mode and ⏵⏵ (Claude Code's accept-edits glyph) for agents that act.
 */
export function modeLabel(agent: string) {
  const name = agent.toLowerCase()
  return { glyph: name === "plan" ? "⏸" : "⏵⏵", name }
}
