#!/bin/sh
# Launch OpenCode with the Claude Code look, without editing your OpenCode config.
#
# OPENCODE_TUI_CONFIG / OPENCODE_CONFIG are layered on top of your normal config,
# so your providers, auth, and keybinds all still apply. Extra args go to opencode.
# (OpenCode does copy the bundled theme into its themes folder when the plugin loads.)
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/opencode-claude-style.XXXXXX")
trap 'rm -rf "$TMP"' EXIT INT TERM

cat >"$TMP/tui.json" <<EOF
{
  "\$schema": "https://opencode.ai/tui.json",
  "theme": "claude-code",
  "plugin": ["$ROOT"]
}
EOF

cat >"$TMP/opencode.json" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["$ROOT"]
}
EOF

OPENCODE_TUI_CONFIG="$TMP/tui.json" OPENCODE_CONFIG="$TMP/opencode.json" "${OPENCODE_BIN:-opencode}" "$@"
