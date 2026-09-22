import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  abbreviateHome,
  describeModel,
  readRecentModels,
  relativeTime,
  truncateEnd,
  truncateStart,
  type ProviderInfo,
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
