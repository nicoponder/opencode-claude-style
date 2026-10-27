/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import { createEffect, createSignal } from "solid-js"
import { cleanSuggestion, lastTurn } from "./format"
import { turnMessages } from "./data"
import { debug } from "./tree"

type Context = Plugin.Context

export const ACCEPT_COMMAND = "claude.suggestion.accept"

/** What the session's model is asked, beside the conversation, after each turn. */
const PROMPT = [
  "Suggest the user's most likely next message in this conversation, written as they would type it:",
  "short, specific, and in their voice. Reply with only that message, with no quotes or explanation.",
  "If there's no clear next step, reply with NONE. Do not call any tools and do not take any actions.",
].join(" ")

/** The latest suggestion, for the turn (the user message) it follows. */
const [latest, setLatest] = createSignal<{ sessionID: string; userID: string; text: string } | undefined>()

/**
 * The suggested next prompt for a session, if there is one: only while the
 * session is idle and nothing has been sent since the turn it follows.
 */
export function suggestion(context: Context, sessionID: string | undefined) {
  const s = latest()
  if (!s || !sessionID || s.sessionID !== sessionID) return
  if (context.data.session.status(sessionID) === "running") return
  const user = turnMessages(context, sessionID).findLast((m) => m.type === "user")
  return user?.id === s.userID ? s.text : undefined
}

export function dismissSuggestion() {
  setLatest(undefined)
}

/**
 * Claude Code's next-prompt suggestion: after each turn in the open session
 * finishes, ask the session's model (with the conversation as context, without
 * adding to it, as OpenCode's /btw does) what you're likely to send next. The
 * prompt shows it as its placeholder, and tab puts it in (see PromptChrome).
 * Only turns that finish after OpenCode started get one, so opening an old
 * session doesn't cost a request.
 */
export function SuggestionWatcher(props: { context: Context }) {
  const context = props.context
  const started = Date.now()
  const asked = new Set<string>()
  createEffect(() => {
    const route = context.ui.router.current()
    if (route.type !== "session") return
    const id = route.sessionID
    if (context.data.session.status(id) === "running") return
    const messages = turnMessages(context, id)
    const user = messages.findLast((m) => m.type === "user")
    const turn = lastTurn(messages)
    if (!user || !turn?.end || turn.failed || turn.end < started || asked.has(user.id)) return
    asked.add(user.id)
    context.client.session
      .generate({ sessionID: id, prompt: PROMPT })
      .then((result) => {
        const text = cleanSuggestion(result.text)
        if (text) setLatest({ sessionID: id, userID: user.id, text })
      })
      .catch((error) => debug("suggestion failed", error))
  })
  return null
}
