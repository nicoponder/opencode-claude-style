/** @jsxImportSource @opentui/solid */
// In a .tsx file on purpose: OpenCode maps solid-js to its own copy only for
// JSX modules, and nodes made with another copy can't find the renderer.
import type { Renderable } from "@opentui/core"
import { type Accessor, createRoot, createSignal, type Owner } from "solid-js"

/** A node of ours that lives somewhere in OpenCode's tree, re-rendered from `set` data. */
export type Detached<T> = { node: Renderable; set: (data: T) => void; dispose: () => void }

/**
 * Render `make` outside Solid's usual tree so the node can be placed anywhere in
 * OpenCode's. It borrows `owner` (a component of ours) to find the renderer and
 * context. `dispose` takes the node out and destroys it.
 */
export function detach<T>(owner: Owner | null, data: T, make: (data: Accessor<T>) => unknown): Detached<T> {
  return createRoot((dispose) => {
    const [get, set] = createSignal(data, { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) })
    const node = make(get) as Renderable
    return {
      node,
      set: (value: T) => set(() => value),
      dispose() {
        node.parent?.remove(node)
        if (!node.isDestroyed) node.destroyRecursively()
        dispose()
      },
    }
  }, owner ?? undefined)
}
