import { describe, expect, test } from "bun:test"
import { contextUsage, formatCount, usageLine } from "../src/format"
import { type Credential, oauthFor, parseChatGPTUsage, parseClaudeUsage } from "../src/limits"

describe("formatCount", () => {
  test("shortens thousands and millions", () => {
    expect(formatCount(999)).toBe("999")
    expect(formatCount(1000)).toBe("1k")
    expect(formatCount(14_900)).toBe("14.9k")
    expect(formatCount(999_949)).toBe("999.9k")
    expect(formatCount(999_950)).toBe("1M")
    expect(formatCount(1_250_000)).toBe("1.3M")
  })
})

describe("contextUsage", () => {
  const tokens = (output: number) => ({ input: 10_000, output, reasoning: 400, cache: { read: 4000, write: 500 } })
  const models = [{ id: "claude-x", providerID: "anthropic", limit: { context: 200_000 } }]
  const reply = (id: string, output: number, model = { providerID: "anthropic", id: "claude-x" }) => ({
    id,
    type: "assistant",
    model,
    tokens: tokens(output),
  })

  test("uses the latest reply with token counts", () => {
    const usage = contextUsage([reply("a1", 100), { id: "u1", type: "user" }, reply("a2", 600)], models)
    expect(usage).toEqual({ tokens: 15_500, percent: 8, providerID: "anthropic" })
  })

  test("leaves out the percentage for an unknown model", () => {
    const usage = contextUsage([reply("a1", 100, { providerID: "x", id: "y" })], models)
    expect(usage?.percent).toBeUndefined()
  })

  test("starts over after a compaction and stops at a reverted message", () => {
    const messages = [reply("a1", 100), { id: "c1", type: "compaction", status: "completed" }, { id: "u1", type: "user" }]
    expect(contextUsage(messages, models)).toBeUndefined()
    expect(contextUsage([reply("a1", 100), { id: "u1", type: "user" }, reply("a2", 600)], models, "u1")?.tokens).toBe(15_000)
  })

  test("is undefined before any reply", () => {
    expect(contextUsage([{ id: "u1", type: "user" }], models)).toBeUndefined()
  })
})

describe("oauthFor", () => {
  const login = (integrationID: string, value: Credential["value"], active = true): Credential => ({
    integrationID,
    active,
    value,
  })

  test("picks the provider's active subscription login", () => {
    const credentials = [
      login("openai", { type: "oauth", access: "old", expires: 1 }, false),
      login("openai", { type: "oauth", access: "tok", expires: 5, metadata: { accountID: "acct" } }),
      login("anthropic", { type: "oauth", access: "other" }),
    ]
    expect(oauthFor("openai", credentials)).toEqual({ type: "oauth", access: "tok", expires: 5, accountId: "acct" })
  })

  test("ignores API keys", () => {
    expect(oauthFor("anthropic", [login("anthropic", { type: "key" })])).toBeUndefined()
  })
})

describe("usageLine", () => {
  test("joins what's known with bars", () => {
    expect(usageLine({ tokens: 14_900, percent: 25, limits: { fiveHour: 48.4, sevenDay: 6 } })).toBe(
      "14.9k | ctx 25% | 5h: 48% | 7d: 6%",
    )
    expect(usageLine({ tokens: 14_900, percent: 25 })).toBe("14.9k | ctx 25%")
    expect(usageLine({ tokens: 532, cost: "$0.12", limits: { sevenDay: 6 } })).toBe("532 | $0.12 | 7d: 6%")
  })

  test("drops the least useful parts to fit", () => {
    const input = { tokens: 14_900, percent: 25, cost: "$0.12", limits: { fiveHour: 48, sevenDay: 6 } }
    expect(usageLine(input, 100)).toBe("14.9k | ctx 25% | $0.12 | 5h: 48% | 7d: 6%")
    expect(usageLine(input, 34)).toBe("ctx 25% | $0.12 | 5h: 48% | 7d: 6%")
    expect(usageLine(input, 30)).toBe("ctx 25% | 5h: 48% | 7d: 6%")
    expect(usageLine(input, 17)).toBe("5h: 48% | 7d: 6%")
    expect(usageLine(input, 7)).toBe("5h: 48%")
    expect(usageLine(input, 3)).toBe("")
  })
})

describe("parseChatGPTUsage", () => {
  test("tells the windows apart by length", () => {
    const body = {
      rate_limit: {
        primary_window: { used_percent: 48, limit_window_seconds: 18_000 },
        secondary_window: { used_percent: 6, limit_window_seconds: 604_800 },
      },
    }
    expect(parseChatGPTUsage(body)).toEqual({ fiveHour: 48, sevenDay: 6 })
  })

  test("ignores windows it doesn't recognize", () => {
    expect(parseChatGPTUsage({ rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 60 } } })).toEqual({})
    expect(parseChatGPTUsage(null)).toEqual({})
  })
})

describe("parseClaudeUsage", () => {
  test("reads the five-hour and seven-day utilization", () => {
    expect(parseClaudeUsage({ five_hour: { utilization: 48 }, seven_day: { utilization: 6 } })).toEqual({
      fiveHour: 48,
      sevenDay: 6,
    })
    expect(parseClaudeUsage({ five_hour: null, seven_day: { utilization: 6 } })).toEqual({ sevenDay: 6 })
    expect(parseClaudeUsage({})).toEqual({})
  })
})
