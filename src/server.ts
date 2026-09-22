import type { Hooks, Plugin, PluginModule } from "@opencode-ai/plugin"

/**
 * Agent accent colors, named by theme key so they follow whatever theme is active.
 * With the bundled `claude-code` theme, build gets Claude Code's lavender
 * (`secondary`) and plan gets its plan-mode teal (`accent`). Without this, OpenCode
 * colors agents by list position and plan lands on `warning` yellow.
 */
export const AGENT_COLORS: Record<string, string> = {
  build: "secondary",
  plan: "accent",
}

type AgentConfig = Record<string, { color?: string } | undefined>

/** Fill in agent colors the user hasn't set. Never overrides an explicit color. */
export function applyAgentColors(config: { agent?: AgentConfig }) {
  config.agent ??= {}
  for (const [name, color] of Object.entries(AGENT_COLORS)) {
    const agent = (config.agent[name] ??= {})
    agent.color ??= color
  }
}

const server: Plugin = async (_input, options) => {
  const hooks: Hooks = {}
  if ((options as { agentColors?: boolean } | undefined)?.agentColors === false) return hooks
  hooks.config = async (config) => applyAgentColors(config as { agent?: AgentConfig })
  return hooks
}

const plugin: PluginModule & { id: string } = {
  id: "opencode-claude-style",
  server,
}

export default plugin
