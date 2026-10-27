import { describe, expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import {
  abbreviateHome,
  contextWarning,
  formatReset,
  parseAnsi,
  usageBar,
  claudeSummary,
  cleanSuggestion,
  describeModel,
  formatClock,
  formatDuration,
  formatTokens,
  lastTurn,
  modeLabel,
  relativeTime,
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

describe("cleanSuggestion", () => {
  test("keeps the first line, without wrapping quotes", () => {
    expect(cleanSuggestion("  run the tests  ")).toBe("run the tests")
    expect(cleanSuggestion('"commit it"')).toBe("commit it")
    expect(cleanSuggestion("push it\nand open a PR")).toBe("push it")
  })

  test("drops empty, NONE, and overlong replies", () => {
    expect(cleanSuggestion("")).toBeUndefined()
    expect(cleanSuggestion("NONE")).toBeUndefined()
    expect(cleanSuggestion("none.")).toBeUndefined()
    expect(cleanSuggestion("x".repeat(151))).toBeUndefined()
  })
})

describe("claudeSummary", () => {
  test("words OpenCode's summary like Claude Code, without thinking", () => {
    expect(claudeSummary("4 commands, 1 thought", false)).toBe("Ran 4 shell commands")
    expect(claudeSummary("2 reads, 1 command", false)).toBe("Read 2 files, ran 1 shell command")
    expect(claudeSummary("1 edit, 3 tools, 2 instructions", false)).toBe("Edited 1 file, used 3 tools, loaded 2 instruction files")
    expect(claudeSummary("2 thoughts", false)).toBe("Thought")
  })

  test("is in the present tense while the run is going", () => {
    expect(claudeSummary("1 read, 1 command", true)).toBe("Reading 1 file, running 1 shell command…")
    expect(claudeSummary("1 thought", true)).toBe("Thinking…")
  })

  test("leaves anything else alone", () => {
    expect(claudeSummary("Running command…", true)).toBeUndefined()
    expect(claudeSummary("Explored: 1 read", false)).toBeUndefined()
  })
})

describe("contextWarning", () => {
  test("warns once the context is 80% full", () => {
    expect(contextWarning(79)).toBeUndefined()
    expect(contextWarning(undefined)).toBeUndefined()
    expect(contextWarning(85)).toBe("15% context left · /compact")
    expect(contextWarning(104)).toBe("0% context left · /compact")
  })
})

describe("usageBar", () => {
  test("fills a share of the cells, clamped", () => {
    expect(usageBar(50, 10)).toBe("█████░░░░░")
    expect(usageBar(0, 4)).toBe("░░░░")
    expect(usageBar(130, 4)).toBe("████")
  })
})

describe("formatReset", () => {
  const now = new Date(2026, 9, 27, 10, 0).getTime()
  test("shows the time today, the weekday this week, and the date after", () => {
    expect(formatReset(new Date(2026, 9, 27, 16, 0).getTime(), now, "en-US")).toBe("4:00 PM")
    expect(formatReset(new Date(2026, 9, 29, 9, 0).getTime(), now, "en-US")).toBe("Thu 9:00 AM")
    expect(formatReset(new Date(2026, 10, 10, 9, 0).getTime(), now, "en-US")).toBe("Nov 10")
  })
})

describe("parseAnsi", () => {
  test("splits a line into styled runs", () => {
    expect(parseAnsi("plain")).toEqual([{ text: "plain" }])
    expect(parseAnsi("\x1b[1;32mok\x1b[0m done")).toEqual([{ text: "ok", bold: true, fg: "#00CD00" }, { text: " done" }])
  })

  test("reads 256 and true colors, and resets parts of the style", () => {
    expect(parseAnsi("\x1b[38;5;196mred\x1b[39m")).toEqual([{ text: "red", fg: "#FF0000" }])
    expect(parseAnsi("\x1b[48;2;1;2;3m\x1b[2mx\x1b[22my")).toEqual([
      { text: "x", bg: "#010203", dim: true },
      { text: "y", bg: "#010203", bold: undefined, dim: undefined },
    ])
  })

  test("drops other escape sequences", () => {
    expect(parseAnsi("\x1b]8;;https://x.dev\x07link\x1b]8;;\x07\x1b[2K!")).toEqual([{ text: "link" }, { text: "!" }])
  })
})
