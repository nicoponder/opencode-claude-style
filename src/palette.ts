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

/**
 * Tips shown under the spinner while a turn runs, as Claude Code does. They're
 * taken from OpenCode's own startup tips, so they describe OpenCode, not Claude Code.
 */
export const tips = [
  "Type @ followed by a filename to fuzzy search and attach files",
  "Start a message with ! to run shell commands (e.g., !ls -la)",
  "Use /undo to revert the last message and file changes",
  "Use /redo to restore previously undone messages and file changes",
  "Drag and drop images or PDFs into the terminal as context",
  "Use /editor to compose messages in your external editor",
  "Run /init to auto-generate project rules based on your codebase",
  "Use /models to switch between available AI models",
  "Use /new to start a fresh conversation session",
  "Use /sessions to list, pin, and continue sessions",
  "Run /compact to summarize long sessions near context limits",
  "Use /export to save the conversation as Markdown",
  "Switch to Plan agent for suggestions without making changes",
  "Use @agent-name in prompts to invoke specialized subagents",
  "Override any keybind in tui.json via the keybinds section",
  "Add .md files to .opencode/commands/ for reusable prompts",
  "Add .md files to .opencode/agents/ for specialized AI personas",
  "Use /timeline to jump to specific messages",
  "Use /review to review uncommitted changes, branches, or PRs",
  "Press ctrl+o to expand tool calls and thinking",
]
