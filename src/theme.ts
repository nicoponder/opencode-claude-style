import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

export const THEME = "claude-code"

const bundled = path.join(import.meta.dirname, "..", "themes", `${THEME}.json`)

/** OpenCode's global config directory: $XDG_CONFIG_HOME/opencode, or ~/.config/opencode. */
export function configDir() {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode")
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return undefined
  }
}

function writeAtomic(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

/**
 * Copy the bundled theme into OpenCode's themes folder, where OpenCode looks for
 * custom themes (plugins can't register them directly). It's written when missing,
 * or when the copy there is the old-format one earlier versions of this plugin
 * installed; a theme you've edited in the new format is left alone. Returns whether
 * the theme was newly installed.
 */
export function installTheme(options: { activate: boolean }, dir = configDir()) {
  try {
    const target = path.join(dir, "themes", `${THEME}.json`)
    const existing = existsSync(target) ? readJson(target) : undefined
    const fresh = existing === undefined && !existsSync(target)
    const legacy = !!existing && typeof existing === "object" && "theme" in existing && !("base" in existing)
    if (!fresh && !legacy) return false
    writeAtomic(target, readFileSync(bundled, "utf8"))
    if (fresh && options.activate) activate(dir)
    // OpenCode reads its themes folder at startup and again on SIGUSR2, so the
    // theme is available right away. Without a handler SIGUSR2 would end the
    // process, so only send it when OpenCode is listening.
    if (process.listenerCount("SIGUSR2") > 0) process.kill(process.pid, "SIGUSR2")
    return true
  } catch (error) {
    console.error("opencode-claude-style: couldn't install the theme", error)
    return false
  }
}

/**
 * Pick the theme in cli.json, as OpenCode's own theme picker would, unless a theme
 * is already chosen there or in OPENCODE_CLI_CONFIG_CONTENT. A cli.json that isn't
 * plain JSON (comments, say) is left alone.
 */
export function activate(dir = configDir()) {
  const inline = process.env.OPENCODE_CLI_CONFIG_CONTENT
  if (inline && (readInline(inline) as { theme?: { name?: string } } | undefined)?.theme?.name) return false
  const file = path.join(dir, "cli.json")
  const config = existsSync(file) ? readJson(file) : { $schema: "https://opencode.ai/v2/cli.json" }
  if (!config || typeof config !== "object" || Array.isArray(config)) return false
  const current = (config as { theme?: unknown }).theme
  if (current !== undefined && (typeof current !== "object" || (current as { name?: unknown }).name !== undefined)) {
    return false
  }
  const next = { ...config, theme: { ...(current as object | undefined), name: THEME } }
  writeAtomic(file, JSON.stringify(next, null, 2) + "\n")
  return true
}

function readInline(text: string) {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}
