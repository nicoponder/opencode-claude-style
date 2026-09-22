import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Limits } from "./format"

// 5-hour and 7-day usage for subscriptions that have them. OpenCode doesn't track
// these, so they're asked of the provider with the login OpenCode already stored,
// the way each provider's own CLI shows them (Codex's /status, Claude Code's
// /usage). The login is only ever sent to the provider it belongs to, and is never
// refreshed here: if it has expired, nothing is shown until OpenCode refreshes it.

type OAuth = { type: "oauth"; access: string; expires?: number; accountId?: string }

type Source = {
  url: string
  headers: (auth: OAuth) => Record<string, string>
  parse: (body: unknown) => Limits
}

const sources: Record<string, Source> = {
  // ChatGPT Plus/Pro, signed in through OpenCode's built-in ChatGPT login.
  openai: {
    url: "https://chatgpt.com/backend-api/wham/usage",
    headers: (auth) => ({
      authorization: `Bearer ${auth.access}`,
      ...(auth.accountId && { "chatgpt-account-id": auth.accountId }),
    }),
    parse: parseChatGPTUsage,
  },
  // Claude Pro/Max, signed in with a Claude login plugin.
  anthropic: {
    url: "https://api.anthropic.com/api/oauth/usage",
    headers: (auth) => ({ authorization: `Bearer ${auth.access}`, "anthropic-beta": "oauth-2025-04-20" }),
    parse: parseClaudeUsage,
  },
}

type Window = { used_percent?: unknown; limit_window_seconds?: unknown }

/** ChatGPT reports a primary and secondary window; tell them apart by length. */
export function parseChatGPTUsage(body: unknown): Limits {
  const limit = (body as { rate_limit?: { primary_window?: Window; secondary_window?: Window } } | null)?.rate_limit
  const limits: Limits = {}
  for (const window of [limit?.primary_window, limit?.secondary_window]) {
    const used = window?.used_percent
    const seconds = window?.limit_window_seconds
    if (typeof used !== "number" || typeof seconds !== "number") continue
    if (seconds === 5 * 3600) limits.fiveHour = used
    else if (seconds === 7 * 86400) limits.sevenDay = used
  }
  return limits
}

export function parseClaudeUsage(body: unknown): Limits {
  const usage = body as { five_hour?: { utilization?: unknown }; seven_day?: { utilization?: unknown } } | null
  const five = usage?.five_hour?.utilization
  const seven = usage?.seven_day?.utilization
  return {
    ...(typeof five === "number" && { fiveHour: five }),
    ...(typeof seven === "number" && { sevenDay: seven }),
  }
}

/** OpenCode's credentials file: $XDG_DATA_HOME/opencode/auth.json. */
function authFile() {
  const data = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
  return path.join(data, "opencode", "auth.json")
}

/** Whether a provider could have 5-hour and 7-day limits we know how to read. */
export function hasLimits(providerID: string | undefined) {
  return !!providerID && providerID in sources
}

/**
 * The provider's current 5-hour and 7-day usage, or undefined if it has none, it
 * isn't signed in with a subscription, the login has expired, or the request fails.
 */
export async function fetchLimits(providerID: string): Promise<Limits | undefined> {
  const source = sources[providerID]
  if (!source) return
  try {
    const auth = (JSON.parse(await readFile(authFile(), "utf8")) as Record<string, OAuth | { type: string }>)[providerID]
    if (auth?.type !== "oauth") return
    const oauth = auth as OAuth
    if (!oauth.access || (oauth.expires && oauth.expires < Date.now())) return
    const response = await fetch(source.url, { headers: source.headers(oauth), signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return
    const limits = source.parse(await response.json())
    return limits.fiveHour === undefined && limits.sevenDay === undefined ? undefined : limits
  } catch {
    return
  }
}
