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
