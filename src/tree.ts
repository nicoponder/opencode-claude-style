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

/** The first text found in a subtree, depth first, skipping spinners' glyphs. */
export function firstText(node: Renderable, depth = 0): string | undefined {
  if (node.id.startsWith("spinner")) return
  const own = textOf(node)
  if (own !== undefined) return own
  if (depth >= 4) return
  for (const child of drawn(node)) {
    const text = firstText(child, depth + 1)
    if (text !== undefined) return text
  }
}

/**
 * Route every assignment to `node[key]` through `write`, which gets the value and
 * the original setter to pass it on with (or not). Reads still go to the original
 * getter, so they return what's actually applied. False if there's no setter.
 */
export function interceptSetter<T>(node: object, key: string, write: (value: T, set: (value: T) => void) => void) {
  let proto = Object.getPrototypeOf(node)
  let descriptor: PropertyDescriptor | undefined
  while (proto && !(descriptor = Object.getOwnPropertyDescriptor(proto, key))?.set) proto = Object.getPrototypeOf(proto)
  const original = descriptor
  if (!original?.set) return false
  const set = (value: T) => original.set!.call(node, value)
  Object.defineProperty(node, key, {
    configurable: true,
    get: () => original.get?.call(node),
    set: (value: T) => write(value, set),
  })
  return true
}

const beforeRender = new Set<() => void>()
let unpatch: (() => void) | undefined

/**
 * Run `fn` synchronously just before each frame is laid out and drawn. The
 * renderer's frame callbacks are awaited, which lets OpenCode's own updates slip
 * in after them and show for a frame; this runs with nothing in between.
 * Returns a function that stops it.
 */
export function onBeforeRender(root: Renderable, fn: () => void) {
  beforeRender.add(fn)
  if (!unpatch) {
    const target = root as unknown as { render: (...args: unknown[]) => unknown }
    const original = target.render
    const patched = function (this: unknown, ...args: unknown[]) {
      for (const run of beforeRender) {
        try {
          run()
        } catch (error) {
          console.error("opencode-claude-style: restyle failed", error)
        }
      }
      return original.apply(this, args)
    }
    target.render = patched
    unpatch = () => {
      if (target.render === patched) target.render = original
    }
  }
  return () => {
    beforeRender.delete(fn)
    if (beforeRender.size === 0) {
      unpatch?.()
      unpatch = undefined
    }
  }
}
