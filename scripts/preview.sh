#!/bin/sh
# Launch OpenCode with the Claude Code look, without editing your OpenCode config.
#
# OPENCODE_CLI_CONFIG_CONTENT is merged over your cli.json, so your providers,
# logins, and keybinds all still apply. Extra args go to opencode.
# (The plugin does copy its theme into ~/.config/opencode/themes/ when it loads.)
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)

OPENCODE_CLI_CONFIG_CONTENT=$(printf '{"theme":{"name":"claude-code"},"plugins":["%s"]}' "$ROOT") \
  exec "${OPENCODE_BIN:-opencode}" "$@"
