import { describe, expect, test } from "bun:test"
import theme from "../themes/claude-code.json"

// Every color key OpenCode's ThemeJson requires (packages/tui/src/theme/index.ts).
const REQUIRED = [
  "primary", "secondary", "accent", "error", "warning", "success", "info",
  "text", "textMuted", "background", "backgroundPanel", "backgroundElement",
  "border", "borderActive", "borderSubtle",
  "diffAdded", "diffRemoved", "diffContext", "diffHunkHeader", "diffHighlightAdded",
  "diffHighlightRemoved", "diffAddedBg", "diffRemovedBg", "diffContextBg", "diffLineNumber",
  "diffAddedLineNumberBg", "diffRemovedLineNumberBg",
  "markdownText", "markdownHeading", "markdownLink", "markdownLinkText", "markdownCode",
  "markdownBlockQuote", "markdownEmph", "markdownStrong", "markdownHorizontalRule",
  "markdownListItem", "markdownListEnumeration", "markdownImage", "markdownImageText",
  "markdownCodeBlock",
  "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString",
  "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
]
const OPTIONAL = ["selectedListItemText", "backgroundMenu", "thinkingOpacity"]

type Value = string | number | { dark: string; light: string }
const defs = theme.defs as Record<string, string>
const colors = theme.theme as unknown as Record<string, Value>

// Mirrors resolveTheme() in OpenCode: hex, "none"/"transparent", or a reference
// to a def or another theme key, with dark/light variants.
function resolve(value: Value, mode: "dark" | "light", chain: string[] = []): string {
  if (typeof value === "number") return `ansi:${value}`
  if (typeof value === "object") return resolve(value[mode], mode, chain)
  if (value === "none" || value === "transparent") return "transparent"
  if (value.startsWith("#")) {
    if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value)) throw new Error(`bad hex ${value}`)
    return value.toUpperCase()
  }
  if (chain.includes(value)) throw new Error(`circular: ${[...chain, value].join(" -> ")}`)
  const next = defs[value] ?? colors[value]
  if (next === undefined) throw new Error(`unknown reference "${value}"`)
  return resolve(next as Value, mode, [...chain, value])
}

describe("claude-code theme", () => {
  test("defines every required key and nothing unknown", () => {
    for (const key of REQUIRED) expect(colors).toHaveProperty(key)
    for (const key of Object.keys(colors)) expect([...REQUIRED, ...OPTIONAL]).toContain(key)
  })

  for (const mode of ["dark", "light"] as const) {
    test(`every color resolves in ${mode} mode`, () => {
      for (const [key, value] of Object.entries(colors)) {
        if (key === "thinkingOpacity") continue
        expect(() => resolve(value, mode)).not.toThrow()
      }
    })
  }

  test("uses Claude Code's signature colors", () => {
    expect(resolve(colors.primary, "dark")).toBe("#D77757")
    expect(resolve(colors.primary, "light")).toBe("#D77757")
    expect(resolve(colors.text, "dark")).toBe("#FFFFFF")
    expect(resolve(colors.textMuted, "dark")).toBe("#999999")
    expect(resolve(colors.backgroundPanel, "dark")).toBe("#373737")
    expect(resolve(colors.success, "dark")).toBe("#4EBA65")
    expect(resolve(colors.error, "dark")).toBe("#FF6B80")
    expect(resolve(colors.accent, "dark")).toBe("#48968C")
    expect(resolve(colors.diffAddedBg, "dark")).toBe("#225C2B")
    expect(resolve(colors.diffRemovedBg, "dark")).toBe("#7A2936")
  })

  test("inherits the terminal background like Claude Code", () => {
    expect(resolve(colors.background, "dark")).toBe("transparent")
    expect(resolve(colors.background, "light")).toBe("transparent")
  })

  test("every def is used", () => {
    const text = JSON.stringify(theme.theme)
    for (const name of Object.keys(defs)) expect(text).toContain(`"${name}"`)
  })
})
