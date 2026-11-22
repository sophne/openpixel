/* What Agent Chat keeps: the agents the app reports, and a file's chats as they are saved (app.js 3302–3311, and
   Chat.swift for what the app sends). The shapes are the old page's, field for field: saved chats are read back by
   both pages. */

/** One of an agent's models. Codex lists effort levels per model. */
export interface ChatModel { id: string; label: string; efforts?: string[]; default_effort?: string }

/** An agent as the app's `providers` answer describes it (Chat.swift, `providerList`). */
export interface ChatProvider {
  id: string; name: string; plan: string;
  installed?: boolean;
  /** Its command-line tool is there, it can reach OpenPixel and it is signed in. */
  ready?: boolean;
  needs_setup?: boolean;
  /** Connected, but the agent's own sign-in has lapsed. */
  needs_login?: boolean;
  efforts?: string[]; default_effort?: string; default_model?: string;
  models: ChatModel[];
}

/** One of an agent's skills (the `skills` answer, ChatSkills.swift). */
export interface ChatSkill { name: string; description?: string; source?: string; command?: boolean }

/** A tool call inside a reply. `input` is whatever the agent sent (shown as text, never as markup). */
export interface ToolCall { id: string; name: string; input: unknown; done: boolean; ok: boolean; out: string }

export interface TextPart { kind: 'text'; text: string }
export interface ThinkPart { kind: 'think'; text: string; start?: number; ms?: number }
export interface ToolsPart { kind: 'tools'; calls: ToolCall[] }
export type ChatPart = TextPart | ThinkPart | ToolsPart;

export interface UserMessage { role: 'user'; text: string; skill?: string; args?: string }
export interface AssistantMessage {
  role: 'assistant'; v?: number; parts: ChatPart[]; provider: string; model?: string;
  done: boolean; started?: number; error?: string; stopped?: boolean;
}
export type ChatMessage = UserMessage | AssistantMessage;

export interface ChatThread {
  id: string; title: string; provider: string | null; session: string | null;
  created: number; updated: number; messages: ChatMessage[];
}
/** A file's chats: the saved ones, the one being shown, and the clean one a file opens on. */
export interface ChatFileEntry { threads: ChatThread[]; current: string | null; draft?: ChatThread | null }

/** A reply that is streaming in. */
export interface LiveReply { thread: ChatThread; msg: AssistantMessage; key: string | null; timer: ReturnType<typeof setInterval> | 0 }

/** An event of a running reply, as the app sends it to PC.chatEvent (Chat.swift, `send(run, …)`):
 *  session, text, think, tool, tool_input, tool_done, error, done, and providers (an agent's sign-in finished).
 *  It comes from outside the page, so its fields are read defensively. */
export type ChatEvent = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
