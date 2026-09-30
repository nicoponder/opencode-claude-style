/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import type { Renderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { getOwner, onCleanup, onMount } from "solid-js"
import { gutter } from "./prompt"
import { type Detached, detach } from "./detach"
import { drawn, find, isTextarea, placeIn, debug } from "./tree"
import type { ResolvedOptions } from "./tui"
import { Welcome } from "./welcome"

/**
 * The home screen, rearranged like Claude Code's: the welcome banner and Clawd in
 * place of OpenCode's logo, and the prompt at the bottom, spanning the terminal.
 *
 * This takes over OpenCode's home footer, whose directory and version the banner
 * already shows (Claude Code has no footer), and draws nothing there itself. The
 * home screen has no slot for its logo or prompt, so from the footer it finds the
 * column beside it and adjusts that. Anything it can't find is left as OpenCode
 * draws it.
 */
export function HomeChrome(props: { context: Plugin.Context; options: ResolvedOptions }) {
  const dims = useTerminalDimensions()
  const owner = getOwner()
  let self: Renderable | undefined
  let banner: Detached<null> | undefined
  const hidden = new Set<Renderable>()
  let restore: (() => void) | undefined

  /** OpenCode's home column: the box before the footer's. */
  const column = () => {
    const host = self?.parent
    const outer = host?.parent
    if (!host || !outer) return
    const siblings = drawn(outer)
    return siblings[siblings.indexOf(host) - 1]
  }

  const syncUnsafe = () => {
    if (!self || self.isDestroyed) return
    const col = column()
    if (!col) return
    const children = drawn(col)
    const prompt = children.find((child) => find(child, isTextarea))
    if (!prompt) return

    if (props.options.prompt) {
      // OpenCode caps the home prompt at 75 columns; Claude Code's spans the terminal.
      // (opentui ignores null here, so "100%" is how to lift it.)
      if (prompt.getLayoutNode().getMaxWidth().unit !== 0) prompt.maxWidth = "100%"
      if (!restore) restore = anchorToBottom(prompt)
    }

    if (props.options.banner) {
      // The logo's box: the first one above the prompt with anything in it.
      const logo = children.slice(0, children.indexOf(prompt)).find((child) => child.getChildrenCount() > 0)
      if (!logo) return
      banner ??= detach(owner, null, () => (
        <box flexShrink={0}>
          <Welcome context={props.context} width={Math.max(20, dims().width - 2 * gutter(dims().width))} name={props.options.name} />
        </box>
      ))
      for (const child of drawn(logo)) {
        if (child === banner.node) continue
        if (child.visible) child.visible = false
        hidden.add(child)
      }
      placeIn(banner.node, logo)
    }
  }

  const sync = () => {
    try {
      syncUnsafe()
    } catch (error) {
      debug("sync failed", error)
    }
  }

  onMount(() => {
    const timer = setTimeout(sync, 0)
    const poll = setInterval(sync, 250)
    onCleanup(() => {
      clearTimeout(timer)
      clearInterval(poll)
      banner?.dispose()
      for (const node of hidden) if (!node.isDestroyed) node.visible = true
      restore?.()
    })
  })

  return <box ref={(r: Renderable) => (self = r)} height={0} />
}

/**
 * OpenCode centers the home screen between two growing spacers. Claude Code's
 * prompt sits at the bottom of the terminal, so stop the lower spacer growing and
 * move whatever sits between the prompt and it above the prompt. Returns a
 * function that undoes the spacer change.
 */
function anchorToBottom(prompt: Renderable) {
  const parent = prompt.parent
  if (!parent) return
  const siblings = drawn(parent)
  const after = siblings.slice(siblings.indexOf(prompt) + 1)
  const spacer = after.find((s) => s.getLayoutNode().getFlexGrow() > 0)
  if (!spacer) return
  for (const s of after.slice(0, after.indexOf(spacer))) if (s.visible) parent.insertBefore(s, prompt)
  const grow = spacer.getLayoutNode().getFlexGrow()
  spacer.flexGrow = 0
  return () => {
    if (!spacer.isDestroyed) spacer.flexGrow = grow
  }
}
