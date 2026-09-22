import type { Renderable } from "@opencode-ai/plugin/tui"

// Helpers for finding and adjusting parts of OpenCode's rendered tree that plugins
// have no API for. Every caller treats a miss as "leave OpenCode's version alone".

/**
 * Blank the colored bar OpenCode draws down the left of a box (its left border),
 * such as the one beside the prompt or a user message. OpenCode re-applies the
 * bar's characters when the box re-renders, such as when the prompt's placeholder
 * rotates, so pin them on this one box. Turning the border off instead doesn't
 * stick: setting a border color turns it back on.
 */
export function blankBar(bar: Renderable) {
  const current = (bar as { customBorderChars?: Record<string, string> }).customBorderChars
  let proto = Object.getPrototypeOf(bar)
  let setter: ((value: unknown) => void) | undefined
  while (proto && !(setter = Object.getOwnPropertyDescriptor(proto, "customBorderChars")?.set)) {
    proto = Object.getPrototypeOf(proto)
  }
  if (!current || !setter) return false
  const blank = { ...current, vertical: " ", bottomLeft: " " }
  setter.call(bar, blank)
  Object.defineProperty(bar, "customBorderChars", { configurable: true, get: () => blank, set: () => {} })
  return true
}

export function find(node: Renderable, match: (node: Renderable) => boolean, depth = 0): Renderable | undefined {
  if (match(node)) return node
  if (depth >= 6) return
  for (const child of node.getChildren()) {
    const hit = find(child, match, depth + 1)
    if (hit) return hit
  }
}


/** The children OpenCode actually drew, without Solid's invisible slot markers. */
export function drawn(node: Renderable) {
  return node.getChildren().filter((child) => !child.id.startsWith("slot-"))
}

/** The text of a `<text>` renderable, or undefined for anything else. */
export function textOf(node: Renderable | undefined) {
  const text = (node as { plainText?: unknown } | undefined)?.plainText
  return typeof text === "string" ? text : undefined
}

/** The first text found in a subtree, depth first. */
export function firstText(node: Renderable, depth = 0): string | undefined {
  const own = textOf(node)
  if (own !== undefined) return own
  if (depth >= 4) return
  for (const child of drawn(node)) {
    const text = firstText(child, depth + 1)
    if (text !== undefined) return text
  }
}
