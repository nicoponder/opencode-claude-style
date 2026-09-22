/**
 * Claude Code colors that have no equivalent key in an OpenCode theme.
 *
 * Everything else (text, muted text, borders, diffs, markdown...) comes from the
 * active OpenCode theme so the plugin still looks sane under other themes.
 */
export const claude = {
  /** Clawd's body and the Claude brand orange. Identical in light and dark. */
  body: "#D77757",
  /** Clawd's eyes. Claude Code paints these black in every theme. */
  eyes: "#000000",
  shimmer: { dark: "#EB9F7F", light: "#F59575" },
  /** Prompt border colors per input mode. */
  promptBorder: { dark: "#888888", light: "#999999" },
  bashBorder: { dark: "#FD5DB1", light: "#FF0087" },
  planMode: { dark: "#48968C", light: "#006666" },
} as const

export type Mode = "dark" | "light"

export function pick(color: { dark: string; light: string }, mode: Mode) {
  return color[mode]
}

/** The glyph cycle Claude Code's spinner uses, played forward then backward. */
const glyphs = ["·", "✢", "✳", "✶", "✻", "✽"]
export const spinnerFrames = [...glyphs, ...glyphs.slice(1, -1).reverse()]

/** Whimsical status verbs in the style of Claude Code's spinner. */
export const spinnerVerbs = [
  "Accomplishing",
  "Baking",
  "Brewing",
  "Calculating",
  "Cerebrating",
  "Churning",
  "Coalescing",
  "Cogitating",
  "Computing",
  "Conjuring",
  "Considering",
  "Cooking",
  "Crafting",
  "Crunching",
  "Deliberating",
  "Finagling",
  "Forging",
  "Generating",
  "Hatching",
  "Herding",
  "Honking",
  "Hustling",
  "Ideating",
  "Inferring",
  "Manifesting",
  "Marinating",
  "Moseying",
  "Mulling",
  "Musing",
  "Noodling",
  "Percolating",
  "Pondering",
  "Puttering",
  "Reticulating",
  "Ruminating",
  "Schlepping",
  "Simmering",
  "Spinning",
  "Stewing",
  "Synthesizing",
  "Thinking",
  "Transmuting",
  "Vibing",
  "Working",
]
