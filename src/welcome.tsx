/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createResource, For, Show } from "solid-js"
import { Clawd } from "./clawd"
import { describeModel, relativeTime, safeUsername, truncateEnd, truncateStart, type ModelInfo } from "./format"

type Context = Plugin.Context

/** Below this width the banner collapses to Claude Code's condensed three-line header. */
const WIDE_MIN = 64

type Options = {
  context: Context
  /** The banner's width: the home screen's, inside OpenCode's padding. */
  width: number
  /** Overrides the name shown in "Welcome back <name>!". */
  name?: string
}

export function Welcome(props: Options) {
  const context = props.context
  const location = () => context.location ?? context.data.location.default()
  const version = () => context.app.version
  const model = createMemo(() =>
    describeModel(
      context.ui.model.current(),
      (context.data.location.model.list(location()) ?? []) as ReadonlyArray<ModelInfo>,
      context.data.location.provider.list(location()) ?? [],
    ),
  )
  const cwd = createMemo(() => context.ui.format.path(location().directory || process.cwd()))

  return (
    <Show
      when={props.width >= WIDE_MIN}
      fallback={<Condensed context={context} version={version()} model={model()} cwd={cwd()} width={props.width} />}
    >
      <Banner {...props} version={version()} model={model()} cwd={cwd()} />
    </Show>
  )
}

function Condensed(props: { context: Context; version: string; model?: string; cwd: string; width: number }) {
  const theme = () => props.context.theme
  const textWidth = () => Math.max(1, props.width - 11)
  return (
    <box flexDirection="row" gap={2} width={props.width}>
      <Clawd />
      <box flexDirection="column" flexShrink={1}>
        <text wrapMode="none">
          <span style={{ fg: theme().text.base, bold: true }}>OpenCode</span>
          <span style={{ fg: theme().text.muted }}> v{props.version}</span>
        </text>
        <text fg={theme().text.muted} wrapMode="none">
          {truncateEnd(props.model ?? "", textWidth())}
        </text>
        <text fg={theme().text.muted} wrapMode="none">
          {truncateStart(props.cwd, textWidth())}
        </text>
      </box>
    </box>
  )
}

function Banner(
  props: Options & {
    version: string
    model?: string
    cwd: string
  },
) {
  const theme = () => props.context.theme
  const inner = () => props.width - 2
  const left = () => Math.max(28, Math.floor(inner() * 0.46))
  const right = () => inner() - left() - 1
  const name = createMemo(() => props.name ?? safeUsername())

  // ╭─── OpenCode v1.2.3 ─────────────╮
  const title = () => `OpenCode`
  const titleVersion = () => ` v${props.version}`
  const fill = () => Math.max(0, props.width - 5 - title().length - titleVersion().length - 2)

  const [recent] = createResource(async () => {
    const location = props.context.location ?? props.context.data.location.default()
    const res = await props.context.client.session
      .list({ limit: 3, order: "desc", parentID: null, directory: location.directory })
      .catch(() => undefined)
    return (res?.data ?? []).slice(0, 3).map((item) => ({ title: item.title ?? "Untitled", updated: item.time.updated }))
  })

  return (
    <box flexDirection="column" width={props.width} flexShrink={0}>
      <text wrapMode="none" selectable={false}>
        <span style={{ fg: theme().hue.interactive[200] }}>╭─── </span>
        <span style={{ fg: theme().hue.interactive[200] }}>{title()}</span>
        <span style={{ fg: theme().text.muted }}>{titleVersion()}</span>
        <span style={{ fg: theme().hue.interactive[200] }}>{" " + "─".repeat(fill()) + "╮"}</span>
      </text>
      <box
        flexDirection="row"
        width={props.width}
        border={["left", "right", "bottom"]}
        borderStyle="rounded"
        borderColor={theme().hue.interactive[200]}
      >
        {/* Left column: greeting, Clawd, model and directory, all centered. */}
        <box width={left()} flexDirection="column" alignItems="center" paddingTop={1} paddingBottom={1}>
          <text fg={theme().text.base} wrapMode="none">
            <span style={{ bold: true }}>{truncateEnd(`Welcome back ${name()}!`, left() - 2)}</span>
          </text>
          <box height={1} />
          <Clawd />
          <box height={1} />
          <Show when={props.model}>
            <text fg={theme().text.muted} wrapMode="none">
              {truncateEnd(props.model!, left() - 2)}
            </text>
          </Show>
          <text fg={theme().text.muted} wrapMode="none">
            {truncateStart(props.cwd, left() - 2)}
          </text>
        </box>
        {/* Divider + right column: tips and recent activity. */}
        <box
          width={right() + 1}
          flexDirection="column"
          border={["left"]}
          borderColor={theme().hue.interactive[200]}
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={theme().hue.interactive[200]} wrapMode="none">
            <span style={{ bold: true }}>Tips for getting started</span>
          </text>
          <text fg={theme().text.base} wrapMode="word">
            Run /init to create an AGENTS.md file with instructions for OpenCode
          </text>
          <text fg={theme().hue.interactive[200]} wrapMode="none" selectable={false}>
            {"─".repeat(Math.max(0, right() - 2))}
          </text>
          <text fg={theme().hue.interactive[200]} wrapMode="none">
            <span style={{ bold: true }}>Recent activity</span>
          </text>
          <Show
            when={(recent() ?? []).length > 0}
            fallback={<text fg={theme().text.muted}>No recent activity</text>}
          >
            <For each={recent()}>
              {(item) => (
                <text fg={theme().text.muted} wrapMode="none">
                  {truncateEnd(`${relativeTime(item.updated)}  ${item.title}`, right() - 2)}
                </text>
              )}
            </For>
          </Show>
        </box>
      </box>
    </box>
  )
}
