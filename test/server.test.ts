import { describe, expect, test } from "bun:test"
import plugin, { applyAgentColors } from "../src/server"

describe("agent colors", () => {
  test("fills in build and plan colors", () => {
    const config: { agent?: Record<string, { color?: string }> } = {}
    applyAgentColors(config)
    expect(config.agent?.build?.color).toBe("secondary")
    expect(config.agent?.plan?.color).toBe("accent")
  })

  test("never overrides a user's color", () => {
    const config = { agent: { plan: { color: "#ff0000" } } as Record<string, { color?: string }> }
    applyAgentColors(config)
    expect(config.agent.plan.color).toBe("#ff0000")
    expect(config.agent.build.color).toBe("secondary")
  })

  test("can be disabled with the agentColors option", async () => {
    const hooks = await plugin.server({} as never, { agentColors: false })
    expect(hooks.config).toBeUndefined()
    const enabled = await plugin.server({} as never, undefined)
    expect(typeof enabled.config).toBe("function")
  })
})
