/** @jsxImportSource @opentui/solid */
import { claude } from "./palette"

/**
 * Clawd, drawn with the same quadrant-block glyphs Claude Code uses:
 *
 *    ▐▛███▜▌
 *   ▝▜█████▛▘
 *     ▘▘ ▝▝
 *
 * The eyes are the empty quadrants of ▛ and ▜ on the first row, so that
 * segment gets a black background to make them visible on any terminal.
 */
export function Clawd() {
  return (
    <box flexDirection="column" flexShrink={0} width={9}>
      <text selectable={false}>
        <span style={{ fg: claude.body }}> ▐</span>
        <span style={{ fg: claude.body, bg: claude.eyes }}>▛███▜</span>
        <span style={{ fg: claude.body }}>▌ </span>
      </text>
      <text selectable={false}>
        <span style={{ fg: claude.body }}>▝▜█████▛▘</span>
      </text>
      <text selectable={false}>
        <span style={{ fg: claude.body }}>{"  ▘▘ ▝▝  "}</span>
      </text>
    </box>
  )
}
