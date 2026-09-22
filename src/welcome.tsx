/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createResource, For, Show } from "solid-js"
import { Clawd } from "./clawd"
import { configuredMaxWidth, GUTTER } from "./prompt"
import {
  abbreviateHome,
  describeModel,
  readRecentModels,
  relativeTime,
  safeUsername,
  truncateEnd,
  truncateStart,
} from "./format"

/** Below this width the banner collapses to Claude Code's condensed three-line header. */
const WIDE_MIN = 64

type Options = {
  api: TuiPluginApi
  /** Overrides the name shown in "Welcome back <name>!". */
  name?: string
}

export function Welcome(props: Options) {
  const dims = useTerminalDimensions()

  // Match the width of the prompt underneath so the two line up. Without a
  // configured prompt.max_width that's the whole terminal, like Claude Code.
  const width = createMemo(() => {
    const configured = configuredMaxWidth(props.api)
    if (configured === undefined) return Math.max(20, dims().width)
    const max = configured === "auto" ? Math.max(75, Math.floor(dims().width * 0.7)) : configured
    return Math.max(20, Math.min(dims().width - 2 * GUTTER, max))
  })

  const version = () => props.api.app.version
  const [defaults] = createResource(() =>
    props.api.client.config
      .providers()
      .then((res) => (res.data?.default ?? {}) as Record<string, string>)
      .catch(() => ({}) as Record<string, string>),
  )
  const model = createMemo(() =>
    describeModel({
      providers: props.api.state.provider,
      configured: props.api.state.config.model,
      recent: readRecentModels(props.api.state.path.state),
      defaults: defaults() ?? {},
    }),
  )
  const cwd = createMemo(() => abbreviateHome(props.api.state.path.directory || process.cwd()))

  return (
    <Show
      when={width() >= WIDE_MIN}
      fallback={<Condensed api={props.api} version={version()} model={model()} cwd={cwd()} width={width()} />}
    >
      <Banner {...props} width={width()} version={version()} model={model()} cwd={cwd()} />
    </Show>
  )
}

function Condensed(props: { api: TuiPluginApi; version: string; model?: string; cwd: string; width: number }) {
  const theme = () => props.api.theme.current
  const textWidth = () => Math.max(1, props.width - 11)
  return (
    <box flexDirection="row" gap={2} width={props.width}>
      <Clawd />
      <box flexDirection="column" flexShrink={1}>
        <text wrapMode="none">
          <span style={{ fg: theme().text, bold: true }}>OpenCode</span>
          <span style={{ fg: theme().textMuted }}> v{props.version}</span>
        </text>
        <text fg={theme().textMuted} wrapMode="none">
          {truncateEnd(props.model ?? "", textWidth())}
        </text>
        <text fg={theme().textMuted} wrapMode="none">
          {truncateStart(props.cwd, textWidth())}
        </text>
      </box>
    </box>
  )
}

function Banner(
  props: Options & {
    width: number
    version: string
    model?: string
    cwd: string
  },
) {
  const theme = () => props.api.theme.current
  const inner = () => props.width - 2
  const left = () => Math.max(28, Math.floor(inner() * 0.46))
  const right = () => inner() - left() - 1
  const name = createMemo(() => props.name ?? props.api.state.config.username ?? safeUsername())

  // ╭─── OpenCode v1.2.3 ─────────────╮
  const title = () => `OpenCode`
  const titleVersion = () => ` v${props.version}`
  const fill = () => Math.max(0, props.width - 5 - title().length - titleVersion().length - 2)

  const [recent] = createResource(async () => {
    const res = await props.api.client.session.list({ roots: true, limit: 3 }).catch(() => undefined)
    const list = (res?.data ?? []) as Array<{ title: string; time?: { updated?: number } }>
    return list.slice(0, 3)
  })

  return (
    <box flexDirection="column" width={props.width} flexShrink={0}>
      <text wrapMode="none" selectable={false}>
        <span style={{ fg: theme().primary }}>╭─── </span>
        <span style={{ fg: theme().primary }}>{title()}</span>
        <span style={{ fg: theme().textMuted }}>{titleVersion()}</span>
        <span style={{ fg: theme().primary }}>{" " + "─".repeat(fill()) + "╮"}</span>
      </text>
      <box
        flexDirection="row"
        width={props.width}
        border={["left", "right", "bottom"]}
        borderStyle="rounded"
        borderColor={theme().primary}
      >
        {/* Left column: greeting, Clawd, model and directory, all centered. */}
        <box width={left()} flexDirection="column" alignItems="center" paddingTop={1} paddingBottom={1}>
          <text fg={theme().text} wrapMode="none">
            <span style={{ bold: true }}>{truncateEnd(`Welcome back ${name()}!`, left() - 2)}</span>
          </text>
          <box height={1} />
          <Clawd />
          <box height={1} />
          <Show when={props.model}>
            <text fg={theme().textMuted} wrapMode="none">
              {truncateEnd(props.model!, left() - 2)}
            </text>
          </Show>
          <text fg={theme().textMuted} wrapMode="none">
            {truncateStart(props.cwd, left() - 2)}
          </text>
        </box>
        {/* Divider + right column: tips and recent activity. */}
        <box
          width={right() + 1}
          flexDirection="column"
          border={["left"]}
          borderColor={theme().primary}
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={theme().primary} wrapMode="none">
            <span style={{ bold: true }}>Tips for getting started</span>
          </text>
          <text fg={theme().text} wrapMode="word">
            Run /init to create an AGENTS.md file with instructions for OpenCode
          </text>
          <text fg={theme().primary} wrapMode="none" selectable={false}>
            {"─".repeat(Math.max(0, right() - 2))}
          </text>
          <text fg={theme().primary} wrapMode="none">
            <span style={{ bold: true }}>Recent activity</span>
          </text>
          <Show
            when={(recent() ?? []).length > 0}
            fallback={<text fg={theme().textMuted}>No recent activity</text>}
          >
            <For each={recent()}>
              {(item) => (
                <text fg={theme().textMuted} wrapMode="none">
                  {truncateEnd(`${relativeTime(item.time?.updated)}  ${item.title}`, right() - 2)}
                </text>
              )}
            </For>
          </Show>
        </box>
      </box>
    </box>
  )
}
