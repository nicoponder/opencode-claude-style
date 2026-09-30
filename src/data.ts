import type { Plugin } from "@opencode/plugin/tui"
import type { TurnMessage } from "./format"

/** A session's messages, in the shape the turn helpers in format.ts read. */
export function turnMessages(context: Plugin.Context, sessionID: string) {
  return context.data.session.message.list(sessionID) as ReadonlyArray<TurnMessage>
}
