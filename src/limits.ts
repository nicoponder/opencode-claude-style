import type { Limits } from "./format"

// 5-hour and 7-day usage for subscriptions that have them. OpenCode doesn't track
// these, so they're asked of the provider with the login OpenCode already stored,
// the way each provider's own CLI shows them (Codex's /status, Claude Code's
// /usage). The login is only ever sent to the provider it belongs to, and is never
// refreshed here: if it has expired, nothing is shown until OpenCode refreshes it.

type OAuth = { type: "oauth"; access: string; expires?: number; accountId?: string }

/** A stored login, as OpenCode's credential API lists it. */
export type Credential = {
  integrationID: string
  active: boolean
  value: { type: string; access?: string; expires?: number; metadata?: { [key: string]: unknown } }
}

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

type Window = { used_percent?: unknown; limit_window_seconds?: unknown; reset_at?: unknown; reset_after_seconds?: unknown }

/** A reset time as epoch ms, from epoch seconds or an ISO date. */
function resetTime(value: unknown) {
  if (typeof value === "number" && value > 0) return value < 1e12 ? value * 1000 : value
  if (typeof value === "string") {
    const at = Date.parse(value)
    if (!Number.isNaN(at)) return at
  }
}

/** ChatGPT reports a primary and secondary window; tell them apart by length. */
export function parseChatGPTUsage(body: unknown, now = Date.now()): Limits {
  const limit = (body as { rate_limit?: { primary_window?: Window; secondary_window?: Window } } | null)?.rate_limit
  const limits: Limits = {}
  for (const window of [limit?.primary_window, limit?.secondary_window]) {
    const used = window?.used_percent
    const seconds = window?.limit_window_seconds
    if (typeof used !== "number" || typeof seconds !== "number") continue
    const after = window?.reset_after_seconds
    const resets = resetTime(window?.reset_at) ?? (typeof after === "number" ? now + after * 1000 : undefined)
    if (seconds === 5 * 3600) Object.assign(limits, { fiveHour: used }, resets && { fiveHourResets: resets })
    else if (seconds === 7 * 86400) Object.assign(limits, { sevenDay: used }, resets && { sevenDayResets: resets })
  }
  return limits
}

type ClaudeWindow = { utilization?: unknown; resets_at?: unknown }

export function parseClaudeUsage(body: unknown): Limits {
  const usage = body as { five_hour?: ClaudeWindow; seven_day?: ClaudeWindow } | null
  const five = usage?.five_hour?.utilization
  const seven = usage?.seven_day?.utilization
  const fiveResets = resetTime(usage?.five_hour?.resets_at)
  const sevenResets = resetTime(usage?.seven_day?.resets_at)
  return {
    ...(typeof five === "number" && { fiveHour: five }),
    ...(typeof seven === "number" && { sevenDay: seven }),
    ...(fiveResets && { fiveHourResets: fiveResets }),
    ...(sevenResets && { sevenDayResets: sevenResets }),
  }
}

/** Whether a provider could have 5-hour and 7-day limits we know how to read. */
export function hasLimits(providerID: string | undefined) {
  return !!providerID && providerID in sources
}

/** The provider's active subscription login, if it's signed in with one (not an API key). */
export function oauthFor(providerID: string, credentials: ReadonlyArray<Credential>): OAuth | undefined {
  const entry = credentials.find((c) => c.integrationID === providerID && c.active && c.value.type === "oauth")
  const value = entry?.value
  if (!value?.access) return
  const account = value.metadata?.accountID
  return {
    type: "oauth",
    access: value.access,
    expires: value.expires,
    ...(typeof account === "string" && { accountId: account }),
  }
}

/**
 * The provider's current 5-hour and 7-day usage, or undefined if it has none, it
 * isn't signed in with a subscription, the login has expired, or the request fails.
 */
export async function fetchLimits(
  providerID: string,
  credentials: () => Promise<ReadonlyArray<Credential>>,
): Promise<Limits | undefined> {
  const source = sources[providerID]
  if (!source) return
  try {
    const oauth = oauthFor(providerID, await credentials())
    if (!oauth || (oauth.expires && oauth.expires < Date.now())) return
    const response = await fetch(source.url, { headers: source.headers(oauth), signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return
    const limits = source.parse(await response.json())
    return limits.fiveHour === undefined && limits.sevenDay === undefined ? undefined : limits
  } catch {
    return
  }
}
