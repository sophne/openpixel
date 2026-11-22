/* Agent Chat's state (app.js 3312–3328).
   chatState is the old object, field for field. What the old page then drew by hand (the conversation, the message
   box's buttons, the "/" list, the two menus) is described by the small stores below: one per old render function,
   holding what that function last drew. The functions keep their old names in chat.ts: they fill the store and call
   changed(), and the components in ChatPane/ChatLog/ChatMenus draw it. So the DOM changes exactly when it did
   before: when a render function runs, not whenever some state changes. */
import type { DropdownApi, DropdownOption } from '../kit';
import { store } from '../lib/store';
import type { Reveal } from './reveal';
import type {
  AssistantMessage, ChatFileEntry, ChatMessage, ChatProvider, ChatSkill, ChatThread, LiveReply, TextPart, ThinkPart,
  ToolCall, ToolsPart, UserMessage,
} from './types';

export const EFFORT_LABELS: Record<string, string> = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };
export const CHAT_TOOLS_SHOWN = 4; // tool rows shown per run of calls; earlier ones fold into "N earlier steps"

/** The agent, model and effort the person picked last (kept in localStorage). */
export interface ChatPick { provider?: string; model?: string; effort: Record<string, string> }
interface SkillCache { list?: ChatSkill[]; at: number; loading?: Promise<ChatSkill[]> | null }

/* ------------------------------------------------------------------ what is on screen (the old page's DOM) */

/** A text part while shown. Text that is still streaming is drawn by its Reveal; a finished reply by <Markdown>. */
export interface TextView { kind: 'text'; key: number; part: TextPart; live: boolean; el: HTMLElement | null; reveal: Reveal | null }
/** A thinking part while shown: `live` and `open` are the classes on .cm-think. */
export interface ThinkView { kind: 'think'; key: number; part: ThinkPart; live: boolean; open: boolean; el: HTMLElement | null; box: HTMLElement | null }
/** A tool row: `cls` is its class list in the order the old code left it ("ctl-row enter ok open"). */
export interface ToolRowView { key: number; call: ToolCall; cls: string[]; hidden: boolean }
/** A run of tool calls while shown. `rows` finds a call's row; `list` is the rows in the order they were added. */
export interface ToolsView {
  kind: 'tools'; key: number; part: ToolsPart; el: HTMLElement | null;
  rows: Map<string, ToolRowView>; list: ToolRowView[]; expanded: boolean;
  moreHidden: boolean; moreOpen: boolean; moreText: string;
}
export type PartView = TextView | ThinkView | ToolsView;

/** What renderChatFoot() last drew under a reply. */
export interface FootView { key: number; error: string | null; stopped: boolean; text: string; model: string | null; provider: string }
export interface UserView { role: 'user'; key: number; msg: UserMessage; enter: boolean }
export interface AssistantView {
  role: 'assistant'; key: number; msg: AssistantMessage; enter: boolean; el: HTMLElement | null;
  parts: PartView[];
  /** .cm-status: hidden or not, "Thinking"/"Working", and the seconds beside it. */
  statusHidden: boolean; statusText: string; sec: string;
  foot: FootView | null;
}
export type MessageView = UserView | AssistantView;

/** What chatEmpty() drew: looking for agents, none to chat with, or the welcome for the chosen agent. */
export type EmptyView =
  | { kind: 'loading'; key: number }
  | { kind: 'none'; key: number; /** The agents that are installed but not connected, "A or B"; null when there are none. */ waiting: string | null }
  | { kind: 'welcome'; key: number; id: string; name: string; plan: string };

/** #chat-title and #chat-log (renderChatThread, appendChatMessage). */
export const logView = store({ title: 'Agent Chat', empty: null as EmptyView | null, items: [] as MessageView[] });

export interface EffortView { key: number; options: DropdownOption[]; value: string; level: number; label: string; onChange: (v: string) => void }
/** The agent + model button and the effort dropdown (renderChatPickers). `drawn` is false until the first call:
 *  the button still reads "Agent" and is disabled, as wireChat() left it. */
export const pickersView = store({
  drawn: false, id: null as string | null, name: '', plan: '', label: '',
  effort: null as EffortView | null, effortHidden: false,
});
/** #chat-send (updateChatSend). `drawn` is false until the first call: no tooltip yet, as in the markup. */
export const sendView = store({ drawn: false, busy: false, disabled: true });
/** #chat-skills (updateSkillMenu, markSkill, closeSkillMenu): shown or not, a note or the rows, and the row that
 *  is marked (the list stays as it was while it is closed, as the old element did). */
export const skillView = store({ key: 0, hidden: true, note: null as string | null, items: [] as ChatSkill[], index: 0 });

export interface HistoryRow { thread: ChatThread; sel: boolean; running: boolean; title: string; when: string }
/** #chat-history-menu as openHistoryMenu() filled it. */
export const historyMenuView = store({ key: 0, file: null as ChatFileEntry | { threads: ChatThread[] } | null, rows: [] as HistoryRow[] });
export interface ModelGroup { provider: ChatProvider; models: { id: string; label: string; sel: boolean }[] }
/** #chat-model-menu as openModelMenu() filled it. */
export const modelMenuView = store({ key: 0, groups: [] as ModelGroup[] });

let viewKeys = 0;
/** A key for something newly drawn: React makes new elements for it, as the old code did with createElement. */
export const viewKey = (): number => ++viewKeys;

/* ------------------------------------------------------------------ chatState */

export const chatState = store({
  providers: null as ChatProvider[] | null, providersLoading: null as Promise<ChatProvider[]> | null, opened: false,
  skills: new Map<string, SkillCache>(), // provider -> { list, at } for the "/" menu
  skillMenu: { open: false, items: [] as ChatSkill[], index: 0 },
  pick: ((): ChatPick => { try { return JSON.parse(localStorage.getItem('openpixel.chatPick') || '{}'); } catch (e) { return {} as ChatPick; } })(),
  key: null as string | null, files: new Map<string, ChatFileEntry>(), thread: null as ChatThread | null,
  gone: new Set<string>(), // gone: files deleted for good (their chats too)
  live: new Map<string, LiveReply>(),          // thread id -> { thread, msg, key, timer }
  views: new WeakMap<ChatMessage | ToolsPart | TextPart | ThinkPart, AssistantView | PartView>(), // message or part -> its view while shown
  stick: true, effortMenu: null as DropdownApi | null, saveTimers: new Map<string, ReturnType<typeof setTimeout>>(),
  get busy(): boolean { return this.live.size > 0; },
});
chatState.pick.effort = chatState.pick.effort || {};

export const chatId = (): string => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
