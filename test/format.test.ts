import { describe, expect, test } from "bun:test"
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
  relativeTime,
  summarizeTools,
  commandHint,
  commandKind,
  turnVerb,
  truncateEnd,
  truncateStart,
  turnOf,
  turnProgress,
  type ModelInfo,
  type ProviderInfo,
  type TurnMessage,
} from "../src/format"

const models: ModelInfo[] = [
  { id: "claude-sonnet-5", providerID: "anthropic", name: "Claude Sonnet 5" },
  { id: "gpt-x", providerID: "openai", name: "GPT X" },
  { id: "a/b", providerID: "openrouter", name: "A B" },
]
const providers: ProviderInfo[] = [
  { id: "anthropic", name: "Anthropic" },
  { id: "openai", name: "OpenAI" },
  { id: "openrouter", name: "OpenRouter" },
]

describe("describeModel", () => {
  test("names the prompt's selected model and its provider", () => {
    expect(describeModel({ providerID: "openai", modelID: "gpt-x" }, models, providers)).toBe("GPT X · OpenAI")
  })

  test("keeps slashes in model ids", () => {
    expect(describeModel({ providerID: "openrouter", modelID: "a/b" }, models, providers)).toBe("A B · OpenRouter")
  })

  test("falls back to IDs for models and providers it doesn't know", () => {
    expect(describeModel({ providerID: "local", modelID: "mystery" }, models, providers)).toBe("mystery · local")
  })

  test("returns undefined with no model selected", () => {
    expect(describeModel(undefined, models, providers)).toBeUndefined()
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
  const user = (id: string, created: number): TurnMessage => ({ id, type: "user", time: { created } })
  const reply = (id: string, created: number, completed?: number): TurnMessage => ({
    id,
    type: "assistant",
    time: { created, completed },
  })
  const idle = (id: string, created: number, outcome: TurnMessage["outcome"] = "succeeded"): TurnMessage => ({
    id,
    type: "idle",
    time: { created },
    outcome,
  })

  test("spans the last user message to when OpenCode marked it idle", () => {
    const turn = lastTurn([
      user("u1", 0),
      reply("a1", 1, 5),
      idle("i1", 6),
      user("u2", 100),
      reply("a2", 101, 110),
      reply("a3", 110, 142),
      idle("i2", 142),
    ])
    expect(turn).toEqual({ start: 100, end: 142, failed: false, interrupted: false })
  })

  test("has no end until the turn is idle", () => {
    expect(lastTurn([user("u1", 0), reply("a1", 1, 5), reply("a2", 5)])?.end).toBeUndefined()
    expect(lastTurn([user("u1", 0), reply("a1", 1, 5), idle("i1", 6), user("u2", 10)])?.end).toBeUndefined()
  })

  test("flags failed or interrupted turns", () => {
    expect(lastTurn([user("u1", 0), reply("a1", 1, 5), idle("i1", 5, "interrupted")])).toMatchObject({
      failed: true,
      interrupted: true,
    })
    expect(lastTurn([user("u1", 0), reply("a1", 1, 5), idle("i1", 5, "failed")])).toMatchObject({
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
    const u1: TurnMessage = { id: "u1", type: "user", time: { created: 0 } }
    const messages: TurnMessage[] = [
      u1,
      { id: "a1", type: "assistant", time: { created: 1, completed: 9 } },
      { id: "i1", type: "idle", time: { created: 8 }, outcome: "succeeded" },
      { id: "u2", type: "user", time: { created: 20 } },
    ]
    expect(turnOf(messages, u1)).toEqual({ start: 0, end: 9, failed: false, interrupted: false })
  })
})

describe("turnProgress", () => {
  test("counts finished steps and estimates the one in progress", () => {
    const messages: TurnMessage[] = [
      { id: "u1", type: "user", time: { created: 50 } },
      {
        id: "a1",
        type: "assistant",
        time: { created: 51, completed: 60 },
        tokens: { output: 300, reasoning: 100 },
        content: [{ type: "text", text: "ignored, already counted" }],
      },
      {
        id: "a2",
        type: "assistant",
        time: { created: 60 },
        content: [
          { type: "text", text: "x".repeat(40) },
          { type: "tool", state: { input: { command: "ls" } } },
        ],
      },
    ]
    // 400 counted, plus (40 + 16 characters of tool input) / 4.
    expect(turnProgress(messages)).toEqual({ start: 50, tokens: 414, thinking: false })
  })

  test("is thinking while the latest part is unfinished reasoning", () => {
    const thought = { type: "reasoning", text: "hmm", time: { created: 61 } as { created: number; completed?: number } }
    const messages: TurnMessage[] = [
      { id: "u1", type: "user", time: { created: 50 } },
      { id: "a1", type: "assistant", time: { created: 60 }, content: [thought] },
    ]
    expect(turnProgress(messages)?.thinking).toBe(true)
    thought.time.completed = 70
    expect(turnProgress(messages)?.thinking).toBe(false)
  })

  test("only counts the latest turn", () => {
    const messages: TurnMessage[] = [
      { id: "u1", type: "user", time: { created: 0 } },
      { id: "a1", type: "assistant", time: { created: 1, completed: 2 }, tokens: { output: 999, reasoning: 0 } },
      { id: "u2", type: "user", time: { created: 10 } },
    ]
    expect(turnProgress(messages)).toEqual({ start: 10, tokens: 0, thinking: false })
  })

  test("returns undefined before any message", () => {
    expect(turnProgress([])).toBeUndefined()
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
