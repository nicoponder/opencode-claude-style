import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  abbreviateHome,
  describeModel,
  formatClock,
  formatDuration,
  formatTokens,
  lastTurn,
  modeLabel,
  readRecentModels,
  relativeTime,
  summarizeTools,
  commandHint,
  commandKind,
  turnVerb,
  truncateEnd,
  truncateStart,
  turnOf,
  turnProgress,
  type ProviderInfo,
  type TurnMessage,
  type TurnPart,
} from "../src/format"

const providers: ProviderInfo[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    models: { "claude-sonnet-5": { name: "Claude Sonnet 5" }, "claude-haiku-4-5": { name: "Claude Haiku 4.5" } },
  },
  { id: "openai", name: "OpenAI", models: { "gpt-x": { name: "GPT X" } } },
]

describe("describeModel", () => {
  test("prefers config.model", () => {
    expect(
      describeModel({
        providers,
        configured: "openai/gpt-x",
        recent: [{ providerID: "anthropic", modelID: "claude-sonnet-5" }],
        defaults: {},
      }),
    ).toBe("GPT X · OpenAI")
  })

  test("falls back to the most recent valid model", () => {
    expect(
      describeModel({
        providers,
        configured: "gone/missing",
        recent: [
          { providerID: "gone", modelID: "missing" },
          { providerID: "anthropic", modelID: "claude-haiku-4-5" },
        ],
        defaults: {},
      }),
    ).toBe("Claude Haiku 4.5 · Anthropic")
  })

  test("then the first provider's default model", () => {
    expect(describeModel({ providers, recent: [], defaults: { anthropic: "claude-haiku-4-5" } })).toBe(
      "Claude Haiku 4.5 · Anthropic",
    )
  })

  test("keeps slashes in model ids", () => {
    const withSlash: ProviderInfo[] = [{ id: "openrouter", name: "OpenRouter", models: { "a/b": { name: "A B" } } }]
    expect(describeModel({ providers: withSlash, configured: "openrouter/a/b", recent: [], defaults: {} })).toBe(
      "A B · OpenRouter",
    )
  })

  test("returns undefined with no providers", () => {
    expect(describeModel({ providers: [], recent: [], defaults: {} })).toBeUndefined()
  })
})

describe("readRecentModels", () => {
  test("reads model.json from the state dir", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "oc-claude-"))
    writeFileSync(path.join(dir, "model.json"), JSON.stringify({ recent: [{ providerID: "a", modelID: "b" }] }))
    expect(readRecentModels(dir)).toEqual([{ providerID: "a", modelID: "b" }])
  })

  test("tolerates missing or malformed files", () => {
    expect(readRecentModels(undefined)).toEqual([])
    const dir = mkdtempSync(path.join(os.tmpdir(), "oc-claude-"))
    expect(readRecentModels(dir)).toEqual([])
    writeFileSync(path.join(dir, "model.json"), "{nope")
    expect(readRecentModels(dir)).toEqual([])
  })
})

describe("text helpers", () => {
  test("truncateEnd", () => {
    expect(truncateEnd("hello", 10)).toBe("hello")
    expect(truncateEnd("hello world", 6)).toBe("hello…")
    expect(truncateEnd("hello", 0)).toBe("")
  })

  test("truncateStart keeps the tail of a path", () => {
    expect(truncateStart("/a/b/c/project", 8)).toBe("…project")
    expect(truncateStart("short", 8)).toBe("short")
  })

  test("abbreviateHome", () => {
    const home = os.homedir()
    expect(abbreviateHome(path.join(home, "code", "app"))).toBe(path.join("~", "code", "app"))
    expect(abbreviateHome(home)).toBe("~")
    expect(abbreviateHome(home + "other")).toBe(home + "other")
    expect(abbreviateHome("/opt/app")).toBe("/opt/app")
  })

  test("relativeTime", () => {
    const now = 1_000_000_000
    expect(relativeTime(undefined, now)).toBe("")
    expect(relativeTime(now - 5_000, now)).toBe("5s ago")
    expect(relativeTime(now - 3 * 60_000, now)).toBe("3m ago")
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe("2h ago")
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe("3d ago")
  })
})

describe("formatDuration", () => {
  test("matches Claude Code's format", () => {
    expect(formatDuration(0)).toBe("0s")
    expect(formatDuration(12_900)).toBe("12s")
    expect(formatDuration(65_000)).toBe("1m 5s")
    expect(formatDuration(120_000)).toBe("2m 0s")
    expect(formatDuration(3_723_000)).toBe("1h 2m 3s")
    expect(formatDuration(-5)).toBe("0s")
  })
})

describe("lastTurn", () => {
  const user = (id: string, created: number): TurnMessage => ({ id, role: "user", time: { created } })
  const reply = (id: string, parentID: string, created: number, completed?: number, error?: string): TurnMessage => ({
    id,
    role: "assistant",
    parentID,
    time: { created, completed },
    ...(error && { error: { name: error } }),
  })

  test("spans the last user message to its final reply", () => {
    const turn = lastTurn([
      user("u1", 0),
      reply("a1", "u1", 1, 5),
      user("u2", 100),
      reply("a2", "u2", 101, 110),
      reply("a3", "u2", 110, 142),
    ])
    expect(turn).toEqual({ start: 100, end: 142, failed: false, interrupted: false })
  })

  test("has no end while a reply is still running or none has started", () => {
    expect(lastTurn([user("u1", 0), reply("a1", "u1", 1, 5), reply("a2", "u1", 5)])?.end).toBeUndefined()
    expect(lastTurn([user("u1", 0), reply("a1", "u1", 1, 5), user("u2", 10)])?.end).toBeUndefined()
  })

  test("flags errored or interrupted turns", () => {
    expect(lastTurn([user("u1", 0), reply("a1", "u1", 1, 5, "MessageAbortedError")])).toMatchObject({
      failed: true,
      interrupted: true,
    })
    expect(lastTurn([user("u1", 0), reply("a1", "u1", 1, 5, "APIError")])).toMatchObject({
      failed: true,
      interrupted: false,
    })
  })

  test("returns undefined for an empty session", () => {
    expect(lastTurn([])).toBeUndefined()
  })
})

describe("turnOf", () => {
  test("describes an earlier turn, not just the latest", () => {
    const u1: TurnMessage = { id: "u1", role: "user", time: { created: 0 } }
    const messages: TurnMessage[] = [
      u1,
      { id: "a1", role: "assistant", parentID: "u1", time: { created: 1, completed: 9 } },
      { id: "u2", role: "user", time: { created: 20 } },
    ]
    expect(turnOf(messages, u1)).toEqual({ start: 0, end: 9, failed: false, interrupted: false })
  })
})

describe("turnProgress", () => {
  const messages: TurnMessage[] = [
    { id: "u1", role: "user", time: { created: 50 } },
    { id: "a1", role: "assistant", parentID: "u1", time: { created: 51, completed: 60 }, tokens: { output: 300, reasoning: 100 } },
    { id: "a2", role: "assistant", parentID: "u1", time: { created: 60 }, tokens: { output: 0, reasoning: 0 } },
  ]

  test("counts finished steps and estimates the one in progress", () => {
    const parts: Record<string, TurnPart[]> = {
      a1: [{ type: "text", text: "ignored, already counted" }],
      a2: [
        { type: "text", text: "x".repeat(40) },
        { type: "tool", state: { input: { command: "ls" } } },
      ],
    }
    const progress = turnProgress(messages, (id) => parts[id] ?? [])
    // 400 counted, plus (40 + 16 characters of tool input) / 4.
    expect(progress).toEqual({ start: 50, tokens: 414, thinking: false })
  })

  test("is thinking while the latest part is unfinished reasoning", () => {
    const parts: Record<string, TurnPart[]> = { a2: [{ type: "reasoning", text: "hmm", time: { start: 61 } }] }
    expect(turnProgress(messages, (id) => parts[id] ?? [])?.thinking).toBe(true)
    parts.a2[0].time!.end = 70
    expect(turnProgress(messages, (id) => parts[id] ?? [])?.thinking).toBe(false)
  })

  test("returns undefined before any message", () => {
    expect(turnProgress([], () => [])).toBeUndefined()
  })
})

describe("formatTokens", () => {
  test("uses k above a thousand, like Claude Code", () => {
    expect(formatTokens(1)).toBe("1 token")
    expect(formatTokens(345)).toBe("345 tokens")
    expect(formatTokens(1000)).toBe("1k tokens")
    expect(formatTokens(1234)).toBe("1.2k tokens")
    expect(formatTokens(12_345)).toBe("12.3k tokens")
  })
})

describe("formatClock", () => {
  test("prints hours and minutes", () => {
    const at = new Date(2026, 0, 1, 16, 0).getTime()
    expect(formatClock(at, "en-US")).toBe("4:00 PM")
  })
})

describe("summarizeTools", () => {
  test("counts each kind in the order it first appears", () => {
    expect(summarizeTools(["read", "bash", "read"], false)).toBe("Read 2 files, ran 1 shell command")
    expect(summarizeTools(["list", "bash"], false)).toBe("Listed 1 directory, ran 1 shell command")
    expect(summarizeTools(["search", "search", "fetch"], false)).toBe("Searched for 2 patterns, fetched 1 URL")
  })

  test("puts the whole run in the present tense while it's going", () => {
    expect(summarizeTools(["read", "bash"], true)).toBe("Reading 1 file, running 1 shell command…")
  })
})

describe("commandKind", () => {
  test("counts looking-only commands as listing, reading, or searching", () => {
    expect(commandKind("ls -la")).toBe("list")
    expect(commandKind("tree src && echo ---")).toBe("list")
    expect(commandKind("cat package.json | jq .name")).toBe("read")
    expect(commandKind("grep -rn GUTTER src | head")).toBe("search")
  })

  test("anything else is a shell command", () => {
    expect(commandKind("npm test")).toBe("bash")
    expect(commandKind("ls && rm -rf build")).toBe("bash")
    expect(commandKind("echo hi")).toBe("bash")
  })
})

describe("commandHint", () => {
  test("collapses whitespace and caps the length", () => {
    expect(commandHint("  git   status  ")).toBe("$ git status")
    expect(commandHint("a\n\n  b")).toBe("$ a\nb")
    expect(commandHint("x".repeat(20), 10)).toBe("$ xxxxxxx…")
  })
})

describe("turnVerb", () => {
  test("is one of Claude Code's verbs, and the same each time for a turn", () => {
    expect(["Baked", "Brewed", "Churned", "Cogitated", "Cooked", "Crunched", "Sautéed", "Worked"]).toContain(turnVerb("msg_1"))
    expect(turnVerb("msg_abc")).toBe(turnVerb("msg_abc"))
  })
})

describe("modeLabel", () => {
  test("lowercases the agent and picks Claude Code's glyph", () => {
    expect(modeLabel("Build")).toEqual({ glyph: "⏵⏵", name: "build" })
    expect(modeLabel("Plan")).toEqual({ glyph: "⏸", name: "plan" })
    expect(modeLabel("Docs-Writer")).toEqual({ glyph: "⏵⏵", name: "docs-writer" })
  })
})
