import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseThemeDocument, resolveThemeDocument } from "@opencode/theme/tui"
import theme from "../themes/claude-code.json"
import { activate, installTheme, THEME } from "../src/theme"

const hex = (color: { toInts(): number[] }) => {
  const [r, g, b, a] = color.toInts()
  const byte = (v: number) => v.toString(16).padStart(2, "0").toUpperCase()
  return `#${byte(r)}${byte(g)}${byte(b)}${a === 255 ? "" : byte(a)}`
}

describe("claude-code theme", () => {
  // OpenCode's own parser: rejects anything its theme schema doesn't accept.
  const document = parseThemeDocument(theme, THEME)
  const dark = resolveThemeDocument(document, "dark")
  const light = resolveThemeDocument(document, "light")

  test("uses Claude Code's signature colors", () => {
    expect(hex(dark.hue.interactive[200])).toBe("#D77757")
    expect(hex(light.hue.interactive[200])).toBe("#D77757")
    expect(hex(dark.text.base)).toBe("#FFFFFF")
    expect(hex(dark.text.muted)).toBe("#999999")
    expect(hex(light.text.base)).toBe("#000000")
    expect(hex(dark.background.raised.base)).toBe("#373737")
    expect(hex(light.background.raised.base)).toBe("#F0F0F0")
    expect(hex(dark.text.feedback.success.base)).toBe("#4EBA65")
    expect(hex(dark.text.feedback.error.base)).toBe("#FF6B80")
    expect(hex(dark.diff.background.added)).toBe("#225C2B")
    expect(hex(dark.diff.background.removed)).toBe("#7A2936")
  })

  test("colors build lavender and plan teal when they come first", () => {
    expect(hex(dark.categorical[0][200])).toBe("#B1B9F9")
    expect(hex(dark.categorical[1][200])).toBe("#48968C")
    expect(hex(light.categorical[0][200])).toBe("#5769F7")
    expect(hex(light.categorical[1][200])).toBe("#006666")
  })

  test("inherits the terminal background and leaves the prompt unfilled", () => {
    for (const t of [dark, light]) {
      expect(t.background.base.a).toBe(0)
      // OpenCode fills the prompt with one step below the raised background.
      expect(t.decrease(t.background.raised.base).a).toBe(0)
    }
  })
})

describe("installTheme", () => {
  const fresh = () => mkdtempSync(path.join(os.tmpdir(), "oc-claude-theme-"))
  const target = (dir: string) => path.join(dir, "themes", `${THEME}.json`)

  test("installs the theme and picks it when cli.json has none", () => {
    const dir = fresh()
    writeFileSync(path.join(dir, "cli.json"), JSON.stringify({ $schema: "x", tabs: { mode: "on" } }))
    expect(installTheme({ activate: true }, dir)).toBe(true)
    expect(JSON.parse(readFileSync(target(dir), "utf8"))).toEqual(theme)
    expect(JSON.parse(readFileSync(path.join(dir, "cli.json"), "utf8"))).toEqual({
      $schema: "x",
      tabs: { mode: "on" },
      theme: { name: THEME },
    })
  })

  test("never overrides a theme you picked, or a theme file you edited", () => {
    const dir = fresh()
    writeFileSync(path.join(dir, "cli.json"), JSON.stringify({ theme: { name: "tokyonight", mode: "dark" } }))
    installTheme({ activate: true }, dir)
    expect(JSON.parse(readFileSync(path.join(dir, "cli.json"), "utf8")).theme.name).toBe("tokyonight")
    const edited = { ...theme, base: { ...theme.base, categorical: ["red"] } }
    writeFileSync(target(dir), JSON.stringify(edited))
    expect(installTheme({ activate: true }, dir)).toBe(false)
    expect(JSON.parse(readFileSync(target(dir), "utf8"))).toEqual(edited)
  })

  test("replaces the old-format copy earlier versions installed, without switching themes", () => {
    const dir = fresh()
    mkdirSync(path.join(dir, "themes"), { recursive: true })
    writeFileSync(target(dir), JSON.stringify({ defs: {}, theme: { primary: "#D77757" } }))
    expect(installTheme({ activate: true }, dir)).toBe(true)
    expect(JSON.parse(readFileSync(target(dir), "utf8"))).toEqual(theme)
    expect(existsSync(path.join(dir, "cli.json"))).toBe(false)
  })

  test("leaves cli.json alone when activateTheme is off or it isn't plain JSON", () => {
    const off = fresh()
    installTheme({ activate: false }, off)
    expect(existsSync(path.join(off, "cli.json"))).toBe(false)
    const commented = fresh()
    writeFileSync(path.join(commented, "cli.json"), "{ // mine\n}")
    expect(activate(commented)).toBe(false)
    expect(readFileSync(path.join(commented, "cli.json"), "utf8")).toBe("{ // mine\n}")
  })
})
