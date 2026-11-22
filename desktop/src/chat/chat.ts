/* ---------------------------------------------------------------- Agent Chat (app.js 3302–4216)
   Talks to the agents the person already has (Claude Code, Codex, Cursor, Gemini CLI), on their own subscriptions.
   For each message the app runs the agent's command-line tool with OpenPixel's tools attached and streams back its
   events (see Chat.swift): text and thinking deltas, tool calls and their results.
   Every file keeps its own chats (saved by the app, so they survive restarts): the title above the conversation lists
   them, and the pen starts another one on the same file. A chat continues the agent's own session while you stay
   with that agent; switching agents mid-chat hands the new one a short transcript instead.
   Motion: the reply is revealed at a steady pace (agents send text in bursts) and each newly shown run of words fades
   in; tool calls are rows whose pixel spinner settles into a check or a cross; thinking streams into a muted window
   that folds away into "Thought for 4s" when it ends. Typing, sending and switching chats never animate the panel.

   This module is the old code, function for function and under the old names. Where a function drew, it now fills
   the store that describes that part of the panel (state.ts) and calls changed(); the components draw it before
   changed() returns, so the measuring and scrolling that followed still follow. */
import { actions, registerActions } from '../app/actions';
import { askConfirm, closeMenus, placeMenu, toast } from '../kit';
import { $, $$, errorText } from '../lib/dom';
import { timeAgo } from '../lib/format';
import { chatNative, setChatMock } from '../lib/host';
import { lastInput, popIn, reducedMotion } from '../lib/motion';
import { platform, THIS_COMPUTER } from '../lib/platform';
import { batch, changed, store } from '../lib/store';
import { AGENTS, type AgentInfo } from '../state/agents';
import { activeTabName, leftSide, S, ui } from '../state/ui';
import { registerCompat } from '../testing/compat';
import { chatMock } from './mock';
import {
  CHAT_TOOLS_SHOWN, chatId, chatState, EFFORT_LABELS, historyMenuView, logView, modelMenuView, pickersView, sendView,
  skillView, viewKey,
  type AssistantView, type EmptyView, type FootView, type PartView, type TextView, type ThinkView, type ToolRowView,
  type ToolsView,
} from './state';
import type {
  AssistantMessage, ChatEvent, ChatFileEntry, ChatMessage, ChatModel, ChatPart, ChatProvider, ChatSkill, ChatThread,
  LiveReply, ToolCall, ToolsPart, UserMessage,
} from './types';

/* --- agents and models */
export async function loadChatProviders(force?: boolean): Promise<ChatProvider[]> {
  if (chatState.providers && !force) return chatState.providers;
  if (!chatState.providersLoading || force) {
    chatState.providersLoading = chatNative('providers').then((list) => {
      chatState.providers = Array.isArray(list) ? list : [];
      return chatState.providers;
    }).catch(() => { chatState.providers = []; return []; });
  }
  return chatState.providersLoading;
}
export const readyProviders = (): ChatProvider[] => (chatState.providers || []).filter((p) => p.ready);
/** Agents connected to OpenPixel, including one whose own sign-in has lapsed (it offers to sign in). */
export const connectedProviders = (): ChatProvider[] => (chatState.providers || []).filter((p) => p.ready || p.needs_login);
/** Looks for agents again (one connected or signed in since) and redraws what depends on them. */
export async function refreshChatProviders(): Promise<void> {
  const before = JSON.stringify(chatState.providers);
  await loadChatProviders(true);
  if (JSON.stringify(chatState.providers) === before) return;
  chatState.skills.clear();
  renderChatPickers();
  if (chatState.thread && !chatState.thread.messages.length) renderChatThread();
  if ($('#chat-model-menu').classList.contains('open')) { closeMenus(); openModelMenu(); }
}
export function chatProvider(): ChatProvider | null {
  const ready = readyProviders();
  return ready.find((p) => p.id === chatState.pick.provider) || ready[0] || null;
}
export function chatModel(p: ChatProvider | null = chatProvider()): ChatModel | null {
  if (!p) return null;
  return p.models.find((m) => m.id === chatState.pick.model && chatState.pick.provider === p.id)
    || p.models.find((m) => p.default_model && m.id === p.default_model) || p.models[0]; // the agent's own default (Codex's config)
}
/** Effort levels: the model's own when it has them (Codex lists them per model), else the agent's. */
export const chatEfforts = (p: ChatProvider | null, m: ChatModel | null = chatModel(p)): string[] => (m && m.efforts) || (p && p.efforts) || [];
export function chatEffort(p: ChatProvider | null = chatProvider()): string {
  const m = chatModel(p), levels = chatEfforts(p, m);
  if (!levels.length || !p) return '';
  const e = chatState.pick.effort[p.id];
  const d = (m && m.default_effort) || p.default_effort;
  return levels.includes(e) ? e : d && levels.includes(d) ? d : levels[0];
}
export function saveChatPick(): void { try { localStorage.setItem('openpixel.chatPick', JSON.stringify(chatState.pick)); } catch (e) { /* not saved */ } }
export function agentFor(id: string): AgentInfo { return AGENTS.find((a) => a.id === id) || { id, name: id, logo: null }; }

export function renderChatPickers(): void {
  const p = chatProvider(), m = chatModel(p), v = pickersView;
  v.drawn = true;
  v.id = p ? p.id : null; v.name = p ? p.name : ''; v.plan = p ? p.plan : ''; v.label = p ? m!.label : '';
  const levels = chatEfforts(p, m);
  v.effortHidden = !levels.length;
  if (levels.length && p) {
    // Three bars fill as the effort rises through the model's own levels; the top levels light up in orange.
    const value = chatEffort(p), i = levels.indexOf(value), level = levels.length < 2 ? 2 : Math.round((i / (levels.length - 1)) * 4);
    v.effort = {
      key: viewKey(), options: levels.map((e) => ({ value: e, label: EFFORT_LABELS[e] || e })), value, level, label: EFFORT_LABELS[value],
      onChange: (val) => { chatState.pick.effort[p.id] = val; saveChatPick(); renderChatPickers(); },
    };
  }
  changed(v);
  updateChatSend();
}
let modelMenuRefreshing = false; // the old openModelMenu.refreshing
export function openModelMenu(): void {
  const m = $('#chat-model-menu'), btn = $('#chat-model .dd-btn');
  if (m.classList.contains('open')) { closeMenus(); return; }
  closeMenus();
  const cur = chatProvider(), curModel = chatModel(cur);
  modelMenuView.key = viewKey();
  // only agents that can reach OpenPixel; the rest are on the Agents page
  modelMenuView.groups = connectedProviders().map((p) => ({
    provider: p,
    // Connected, but the agent's own sign-in has lapsed (Cursor's command-line agent signs in apart from the editor).
    models: !p.ready ? [] : p.models.map((model) => ({ id: model.id, label: model.label, sel: !!(cur && cur.id === p.id && curModel!.id === model.id) })),
  }));
  changed(modelMenuView);
  m.style.minWidth = Math.max(230, btn.getBoundingClientRect().width) + 'px';
  placeMenu(m, btn);
  if (!modelMenuRefreshing) { modelMenuRefreshing = true; refreshChatProviders().finally(() => { modelMenuRefreshing = false; }); }
}
/** The model menu's rows (their onclick in the old openModelMenu). */
export async function signInToAgent(p: ChatProvider): Promise<void> {
  closeMenus();
  const r = await chatNative('login', { provider: p.id });
  toast(r === true ? `Finish signing in to ${p.name} in your browser` : String(r || `Couldn't start ${p.name}'s sign-in`));
}
export function pickChatModel(p: ChatProvider, modelId: string): void {
  closeMenus();
  chatState.pick.provider = p.id; chatState.pick.model = modelId; saveChatPick();
  renderChatPickers();
  if (chatState.thread && !chatState.thread.messages.length) renderChatThread();
}
export function connectAnotherAgent(): void { closeMenus(); actions.showHome('agents'); }

/* --- chats per file */
export function chatKey(): string | null {
  if (ui.active == null) return null;
  return S.file || `untitled:${activeTabName()}`;
}
export function newThread(): ChatThread { return { id: chatId(), title: 'New chat', provider: null, session: null, created: Date.now(), updated: Date.now(), messages: [] }; }
// A chat with no file open is kept under the key null, as the old Map did.
const fileKey = (key: string | null): string => key as string;
export async function chatFile(key: string | null): Promise<ChatFileEntry> {
  if (!chatState.files.has(fileKey(key))) {
    chatState.gone.delete(fileKey(key)); // a new file where a deleted one was starts with no chats
    const entry: ChatFileEntry = { threads: [], current: null };
    chatState.files.set(fileKey(key), entry);
    let data: any = null; // the app's answer: read defensively
    try { data = await chatNative('history', { key }); } catch (e) { data = null; }
    if (data && Array.isArray(data.threads)) {
      // Replies that were still streaming when the app quit end where they stopped.
      for (const t of data.threads) for (const m of t.messages || []) if (m.role === 'assistant' && !m.done) { m.done = true; m.stopped = true; }
      // Codex replies saved before format 2 marked every tool call failed (Codex's "error": null was read as an
      // error). Back then a real failure only ever stored Codex's error object ({"message": …}), so any other
      // result is a call that worked.
      for (const t of data.threads) for (const m of t.messages || []) {
        if (m.role !== 'assistant' || m.provider !== 'codex' || m.v >= 2) continue;
        for (const p of m.parts || []) if (p.kind === 'tools') for (const c of p.calls || []) {
          if (c.done && !c.ok && c.out && !/^\s*\{\s*"message"\s*:/.test(c.out)) c.ok = true;
        }
        m.v = 2;
      }
      // Earlier chats come back in the chat menu only: opening a file always starts on a clean chat.
      entry.threads = (data.threads as ChatThread[]).filter((t) => t && t.id && Array.isArray(t.messages)).concat(entry.threads);
    }
  }
  return chatState.files.get(fileKey(key))!;
}
export function saveChatFile(key: string | null): void {
  if (!key || chatState.gone.has(key)) return;
  clearTimeout(chatState.saveTimers.get(key));
  chatState.saveTimers.set(key, setTimeout(() => {
    const f = chatState.files.get(key);
    if (!f) return;
    const threads = f.threads.filter((t) => t.messages.length).sort((a, b) => b.updated - a.updated).slice(0, 50).map((t) => ({
      ...t,
      messages: t.messages.map((m) => (m.role !== 'assistant' ? m : { ...m, parts: m.parts.map((p) => (p.kind !== 'tools' ? p
        : { ...p, calls: p.calls.map((c) => ({ ...c, out: c.out && c.out.length > 1500 ? c.out.slice(0, 1500) + '…' : c.out })) })) })),
    }));
    chatNative('saveHistory', { key, data: { v: 1, current: f.current, threads } }).catch(() => {});
  }, 400));
}
/** A file deleted for good: its chats are gone from disk (the app removed them), so drop them here too and stop any
    reply still running on them, so nothing writes them back. */
export function chatForget(key: string): void {
  chatState.gone.add(key);
  clearTimeout(chatState.saveTimers.get(key));
  for (const [id, live] of chatState.live) if (live.key === key) chatNative('stop', { chat: id });
  chatState.files.delete(key);
  if (chatState.key === key) { chatState.key = null; if (chatState.opened) showChatThread(newThread()); }
}
/** A renamed file: the app moved its chats on disk; the page follows (open chats, a running reply, pending saves). */
export function chatMoved(from: string, to: string): void {
  const f = chatState.files.get(from);
  clearTimeout(chatState.saveTimers.get(from));
  chatState.files.delete(from);
  if (f) chatState.files.set(to, f);
  for (const live of chatState.live.values()) if (live.key === from) live.key = to;
  if (chatState.key === from) chatState.key = to;
  if (f) saveChatFile(to);
}
/** Shows the chat for the file that is open now, when the file changed: the one you were on if you were already
    chatting about it since it opened, else a clean new chat (the file's earlier chats wait in the chat menu). */
export async function syncChatFile(): Promise<void> {
  const key = chatKey();
  if (key === chatState.key) return;
  chatState.key = key;
  // Files no longer open in a tab start clean the next time they are opened.
  const open = new Set((ui.tabs || []).map((t) => t.path).filter(Boolean));
  for (const [k, entry] of chatState.files) if (k !== key && !open.has(k)) { entry.current = null; entry.draft = null; }
  if (!key) return;
  const f = await chatFile(key);
  if (chatState.key !== key) return;
  if (!f.draft) f.draft = newThread();
  showChatThread(f.threads.find((x) => x.id === f.current) || f.draft);
}
export function showChatThread(t: ChatThread): void {
  chatState.thread = t;
  const f = chatState.files.get(fileKey(chatState.key));
  if (f) { f.current = t.messages.length ? t.id : null; if (!t.messages.length) f.draft = t; }
  renderChatThread();
}
export function startNewChat(): void {
  closeMenus();
  if (chatState.thread && !chatState.thread.messages.length) { $('#chat-input').focus(); return; }
  showChatThread(newThread());
  $('#chat-input').focus();
}
export function openHistoryMenu(): void {
  const m = $('#chat-history-menu'), btn = $('#chat-history');
  if (m.classList.contains('open')) { closeMenus(); return; }
  closeMenus();
  const f = chatState.files.get(fileKey(chatState.key)) || { threads: [] as ChatThread[] };
  const list = f.threads.filter((t) => t.messages.length).sort((a, b) => b.updated - a.updated);
  historyMenuView.key = viewKey();
  historyMenuView.file = f;
  historyMenuView.rows = list.map((t) => ({
    thread: t, sel: !!(chatState.thread && t.id === chatState.thread.id), running: chatState.live.has(t.id),
    title: t.title, when: timeAgo(t.updated / 1000),
  }));
  changed(historyMenuView);
  m.style.minWidth = '240px';
  placeMenu(m, btn);
}
/** The history menu's rows (their onclick in the old openHistoryMenu). */
export function openChatThread(t: ChatThread): void { closeMenus(); showChatThread(t); }
export async function deleteChatThread(f: { threads: ChatThread[] }, t: ChatThread): Promise<void> {
  closeMenus();
  if (!(await askConfirm('Delete this chat?', `“${t.title}” and its messages will be removed from this file's chats. The changes it made to the file stay.`, 'Delete chat'))) return;
  if (chatState.live.has(t.id)) chatNative('stop', { chat: t.id });
  f.threads = f.threads.filter((x) => x !== t);
  if (chatState.thread === t) showChatThread(f.threads.slice().sort((a, b) => b.updated - a.updated)[0] || newThread());
  saveChatFile(chatState.key);
}

/* --- drawing the conversation */
export const prettyTool = (n: unknown): string => { const s = String(n || 'tool').replace(/[_-]+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };
export function toolSummary(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input.slice(0, 80);
  if (Array.isArray(input)) return `${input.length} items`;
  const out: string[] = [];
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (out.length >= 3) break;
    if (v == null || typeof v === 'object' && !Array.isArray(v)) continue;
    out.push(Array.isArray(v) ? `${k} [${v.length}]` : `${k} ${String(v).slice(0, 24)}`);
  }
  return out.join(' · ');
}
export function chatScrollGrow(): void { if (chatState.stick) { const sc = $('#chat-scroll'); sc.scrollTop = sc.scrollHeight; } }

export function renderChatThread(): void {
  const t = chatState.thread;
  // One render for the whole conversation (the old code filled #chat-log before anything was measured, too).
  batch(() => {
    logView.title = t && t.messages.length ? t.title : 'Agent Chat';
    logView.items = []; logView.empty = null;
    chatState.stick = true;
    if (!t || !t.messages.length) logView.empty = chatEmpty();
    else for (const m of t.messages) appendChatMessage(m, false);
    changed(logView);
  });
  const sc = $('#chat-scroll'); sc.scrollTop = sc.scrollHeight;
  updateChatJump();
  updateChatSend();
}
function chatEmpty(): EmptyView {
  if (chatState.providers === null) return { kind: 'loading', key: viewKey() };
  const p = chatProvider();
  if (!p) {
    const waiting = (chatState.providers || []).filter((x) => x.installed);
    return { kind: 'none', key: viewKey(), waiting: waiting.length ? waiting.map((x) => x.name).join(' or ') : null };
  }
  return { kind: 'welcome', key: viewKey(), id: p.id, name: p.name, plan: p.plan };
}
/** The two buttons of "No agent to chat with yet". */
export function showAgentsPage(): void { actions.showHome('agents'); }
export async function lookForAgentsAgain(): Promise<void> {
  chatState.providers = null; renderChatThread(); await loadChatProviders(true); renderChatPickers(); renderChatThread();
}
export function appendChatMessage(msg: ChatMessage, animate: boolean): void {
  logView.empty = null;
  if (msg.role === 'user') {
    logView.items.push({ role: 'user', key: viewKey(), msg, enter: animate });
    changed(logView);
    return;
  }
  const view: AssistantView = store<AssistantView>({
    role: 'assistant', key: viewKey(), msg, enter: animate, el: null, parts: [], statusHidden: true, statusText: '', sec: '', foot: null,
  });
  chatState.views.set(msg, view);
  const live = !msg.done;
  msg.parts.forEach((p, i) => view.parts.push(partView(msg, p, live && i === msg.parts.length - 1)));
  setChatStatus(view);
  if (msg.done) view.foot = footView(msg);
  logView.items.push(view);
  changed(logView);
}
const shown = (v: { el: HTMLElement | null } | null | undefined): boolean => !!(v && v.el && v.el.isConnected);
function chatView(msg: AssistantMessage): AssistantView | null {
  const v = chatState.views.get(msg) as AssistantView | undefined;
  return v && shown(v) ? v : null;
}
/** What a part looks like when it is first drawn (the old appendChatPart built its element here). */
function partView(msg: AssistantMessage, part: ChatPart, live: boolean): PartView {
  let v: PartView;
  if (part.kind === 'text') {
    // What was already said shows at once; only what streams in from here fades in.
    v = store<TextView>({ kind: 'text', key: viewKey(), part, live: !msg.done, el: null, reveal: null });
  } else if (part.kind === 'think') {
    v = store<ThinkView>({ kind: 'think', key: viewKey(), part, live, open: live, el: null, box: null });
  } else {
    const tv = store<ToolsView>({
      kind: 'tools', key: viewKey(), part, el: null, rows: new Map(), list: [], expanded: false, moreHidden: true, moreOpen: false, moreText: '',
    });
    for (const c of part.calls) toolRow(tv, c, false);
    v = tv;
  }
  chatState.views.set(part, v);
  return v;
}
export function appendChatPart(msg: AssistantMessage, part: ChatPart, live: boolean): void {
  const mv = chatView(msg);
  if (!mv) return;
  mv.parts.push(partView(msg, part, live));
  changed(mv);
}
/** classList.toggle(name, on) on a row's class list, keeping the order the old code left the classes in. */
function toggleClass(cls: string[], name: string, on: boolean): void {
  const i = cls.indexOf(name);
  if (on && i < 0) cls.push(name); else if (!on && i >= 0) cls.splice(i, 1);
}
function toolRow(v: ToolsView, call: ToolCall, animate: boolean): void {
  const row: ToolRowView = { key: viewKey(), call, cls: ['ctl-row', call.done ? (call.ok ? 'ok' : 'bad') : 'running'], hidden: false };
  if (animate) row.cls.push('enter');
  v.rows.set(call.id, row);
  v.list.push(row);
  setToolRow(row);
  fold(v);
}
export function addToolRow(part: ToolsPart, call: ToolCall, animate: boolean): void {
  const v = chatState.views.get(part) as ToolsView | undefined;
  if (!v || !shown(v)) return;
  toolRow(v, call, animate);
  changed(v);
}
function setToolRow(row: ToolRowView): void {
  const call = row.call;
  toggleClass(row.cls, 'running', !call.done);
  toggleClass(row.cls, 'ok', !!call.done && call.ok);
  toggleClass(row.cls, 'bad', !!call.done && !call.ok);
}
export function updateToolRow(part: ToolsPart, call: ToolCall): void {
  const v = chatState.views.get(part) as ToolsView | undefined;
  const row = v && v.rows.get(call.id);
  if (!v || !row) return;
  setToolRow(row);
  changed(v); // the row's name, summary, input and result are drawn from the call
}
/** A tool row's head was pressed: its detail opens or closes. */
export function toggleToolRow(v: ToolsView, row: ToolRowView): void {
  toggleClass(row.cls, 'open', !row.cls.includes('open'));
  changed(v);
}
function fold(v: ToolsView): void {
  const rows = [...v.rows.values()];
  const hidden = v.expanded ? 0 : Math.max(0, rows.length - CHAT_TOOLS_SHOWN);
  rows.forEach((r, i) => { r.hidden = i < hidden; });
  v.moreHidden = rows.length <= CHAT_TOOLS_SHOWN;
  v.moreOpen = v.expanded;
  v.moreText = v.expanded ? 'Show fewer steps' : `${hidden} earlier step${hidden === 1 ? '' : 's'}`;
}
export function foldTools(_part: ToolsPart, v: ToolsView): void { fold(v); changed(v); }
function setChatStatus(v: AssistantView): void {
  const msg = v.msg;
  const last = msg.parts[msg.parts.length - 1];
  const waiting = !msg.done && (!last || (last.kind === 'tools' && last.calls.every((c) => c.done)));
  v.statusHidden = !waiting;
  v.statusText = !last ? 'Thinking' : 'Working';
}
export function updateChatStatus(msg: AssistantMessage): void {
  const v = chatView(msg);
  if (!v) return;
  const hidden = v.statusHidden, text = v.statusText;
  setChatStatus(v);
  if (v.statusHidden !== hidden || v.statusText !== text) changed(v);
}
function footView(msg: AssistantMessage): FootView {
  const text = msg.parts.filter((p) => p.kind === 'text').map((p) => p.text.trim()).join('\n\n');
  return {
    key: viewKey(), error: msg.error ? String(msg.error) : null, stopped: !!msg.stopped, text: text && msg.done ? text : '',
    model: msg.model ? String(msg.model) : null, provider: String(msg.provider),
  };
}
export function renderChatFoot(msg: AssistantMessage): void {
  const v = chatView(msg);
  if (!v) return;
  v.foot = footView(msg);
  changed(v);
}
/** A thinking part's head was pressed. */
export function toggleThink(v: ThinkView): void { v.open = !v.open; changed(v); }

/* --- sending and the event stream */
/** What the agent is told it runs on: the system decides where files are and how paths are written. */
const PERSONS_COMPUTER = { darwin: "the person's Mac", win32: "the person's Windows PC", linux: "the person's Linux computer" }[platform];
export function chatSystemPrompt(): string {
  const kind = S.isSprite ? `${S.sx}×${S.sy} 2D sprite` : `${S.sx}×${S.sy}×${S.sz} 3D voxel model`;
  return [
    `You are the assistant in the Chat panel of OpenPixel, a pixel-art and voxel editor on ${PERSONS_COMPUTER}.`,
    `The file open in the editor is "${activeTabName()}", a ${kind} with ${S.layers.length} layer${S.layers.length === 1 ? '' : 's'} and ${S.frames.length} frame${S.frames.length === 1 ? '' : 's'}.`,
    'Work on it with the openpixel tools: your edits appear in the editor as you make them, and the person can undo each one.',
    "Use the person's skills when one fits (you may read a skill's own files); don't run shell commands or change any other files.",
    'Look before you change things (get_model_info, view_as_text, review_model), stay in this file unless asked for a new one, and review your work before you finish.',
    'Reply briefly in plain language; use short Markdown lists when they help.',
  ].join(' ');
}
export function chatTranscript(messages: ChatMessage[]): string {
  const turns = messages.slice(-8).map((m) => {
    const text = m.role === 'user' ? m.text : m.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('\n');
    const clipped = text.length > 700 ? text.slice(0, 700) + '…' : text;
    return clipped.trim() ? `${m.role === 'user' ? 'Person' : 'Agent'}: ${clipped.trim()}` : '';
  }).filter(Boolean);
  return turns.length ? `Earlier in this chat (with another agent):\n${turns.join('\n\n')}\n\nNow:\n` : '';
}
export async function sendChat(raw: unknown): Promise<void> {
  const text = String(raw || '').trim();
  const t = chatState.thread, key = chatState.key;
  if (!text || !t || chatState.live.has(t.id)) return;
  const p = chatProvider();
  if (!p) { toast('No agent to send to: connect one on the Agents page'); return; }
  const model = chatModel(p)!, effort = chatEffort(p);
  const resume = t.session && t.provider === p.id ? t.session : null;
  // "/name rest": one of this agent's skills, then what to do with it.
  const sm = text.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  const skills = sm ? await loadChatSkills(p) : [];
  const skill = sm && skills.some((k) => k.name === sm[1]) ? sm[1] : null;
  const args = skill ? (sm![2] || '').trim() : '';
  const transcript = resume ? '' : chatTranscript(t.messages);
  const prompt = transcript + (skill ? args : text);
  const f = await chatFile(key);
  if (!f.threads.includes(t)) f.threads.push(t);
  f.current = t.id;
  if (!t.messages.length) t.title = text.replace(/\s+/g, ' ').slice(0, 60);
  if (!resume) t.session = null;
  t.provider = p.id;
  t.updated = Date.now();
  const user: UserMessage = skill ? { role: 'user', text, skill, args } : { role: 'user', text };
  const msg: AssistantMessage = { role: 'assistant', v: 2, parts: [], provider: p.id, model: `${model.label}${effort ? ` · ${EFFORT_LABELS[effort] || effort}` : ''}`, done: false, started: Date.now() };
  t.messages.push(user, msg);
  const live: LiveReply = { thread: t, msg, key, timer: 0 };
  chatState.live.set(t.id, live);
  if (chatState.thread === t) {
    logView.title = t.title;
    chatState.stick = true;
    appendChatMessage(user, true);
    appendChatMessage(msg, true);
    chatScrollGrow();
    const input = $<HTMLTextAreaElement>('#chat-input');
    if (input.value.trim() === text) { input.value = ''; sizeChatInput(); }
  }
  live.timer = setInterval(() => tickChatStatus(live), 1000);
  updateChatSend();
  saveChatFile(key);
  let r: unknown;
  try {
    r = await chatNative('send', { chat: t.id, provider: p.id, model: model.id, effort, prompt, resume, system: chatSystemPrompt(),
      skill: skill || undefined, transcript: !!transcript });
  } catch (e) { r = errorText(e); }
  if (r !== true && chatState.live.get(t.id) === live) {
    chatEvent({ chat: t.id, t: 'error', message: typeof r === 'string' ? r : `Couldn't start ${p.name}.` });
    chatEvent({ chat: t.id, t: 'done', ok: false });
  }
}
function tickChatStatus(live: LiveReply): void {
  const v = chatView(live.msg);
  if (!v) return;
  const s = Math.round((Date.now() - (live.msg.started as number)) / 1000);
  const sec = s >= 3 ? `${s}s` : '';
  if (sec !== v.sec) { v.sec = sec; changed(v); }
}
export function stopChat(): void {
  const t = chatState.thread;
  if (t && chatState.live.has(t.id)) chatNative('stop', { chat: t.id });
}
function chatPart(live: LiveReply, kind: 'text'): Extract<ChatPart, { kind: 'text' }>;
function chatPart(live: LiveReply, kind: 'think'): Extract<ChatPart, { kind: 'think' }>;
function chatPart(live: LiveReply, kind: 'tools'): ToolsPart;
function chatPart(live: LiveReply, kind: ChatPart['kind']): ChatPart {
  const msg = live.msg;
  const last = msg.parts[msg.parts.length - 1];
  if (last && last.kind === kind) return last;
  if (last) closeChatPart(last);
  const part: ChatPart = kind === 'tools' ? { kind, calls: [] } : kind === 'think' ? { kind, text: '', start: Date.now() } : { kind, text: '' };
  msg.parts.push(part);
  appendChatPart(msg, part, true);
  return part;
}
function closeChatPart(part: ChatPart): void {
  const v = chatState.views.get(part);
  if (part.kind === 'think' && part.ms == null) {
    part.ms = Date.now() - (part.start as number);
    const tv = v as ThinkView | undefined;
    if (tv && shown(tv)) { tv.live = false; tv.open = false; changed(tv); } // the label turns into "Thought for 4s"
  }
  if (part.kind === 'text' && v) { const r = (v as TextView).reveal; if (r) r.finish(); }
}
export function chatEvent(e: ChatEvent): void {
  if (e && e.t === 'providers') { refreshChatProviders(); return; } // an agent's sign-in finished
  const live = e && chatState.live.get(e.chat);
  if (!live) return;
  const { thread, msg } = live;
  switch (e.t) {
    case 'session': thread.session = e.session; break;
    case 'text': {
      if (!e.d) break;
      const part = chatPart(live, 'text');
      part.text += e.d;
      const v = chatState.views.get(part) as TextView | undefined;
      if (v && shown(v) && v.reveal) v.reveal.push(e.d, e.whole);
      break;
    }
    case 'think': {
      if (!e.d) break;
      const part = chatPart(live, 'think');
      part.text += e.d;
      const v = chatState.views.get(part) as ThinkView | undefined;
      if (v && shown(v)) { changed(v); if (v.box) v.box.scrollTop = v.box.scrollHeight; chatScrollGrow(); }
      break;
    }
    case 'tool': {
      const part = chatPart(live, 'tools');
      if (part.calls.some((c) => c.id === e.id)) break;
      const call: ToolCall = { id: e.id, name: e.name, input: null, done: false, ok: true, out: '' };
      part.calls.push(call);
      addToolRow(part, call, true);
      break;
    }
    case 'tool_input': case 'tool_done': {
      for (const part of msg.parts) {
        const call = part.kind === 'tools' && part.calls.find((c) => c.id === e.id);
        if (!call) continue;
        if (e.t === 'tool_input') call.input = e.input;
        else { call.done = true; call.ok = e.ok !== false; call.out = e.out || ''; }
        updateToolRow(part as ToolsPart, call);
        break;
      }
      break;
    }
    case 'error': msg.error = msg.error ? `${msg.error}\n${e.message}` : e.message; break;
    case 'done': {
      const last = msg.parts[msg.parts.length - 1];
      if (last) closeChatPart(last);
      for (const part of msg.parts) if (part.kind === 'tools') for (const c of part.calls) if (!c.done) { c.done = true; c.ok = !e.stopped; updateToolRow(part, c); }
      msg.done = true;
      if (e.stopped) msg.stopped = true;
      if (e.session) thread.session = e.session;
      delete msg.started;
      thread.updated = Date.now();
      clearInterval(live.timer as ReturnType<typeof setInterval>);
      chatState.live.delete(thread.id);
      renderChatFoot(msg);
      updateChatSend();
      saveChatFile(live.key);
      const showing = leftSide.open && leftSide.pane === 'chat' && chatState.thread === thread && ui.view === 'editor';
      // The rail's dot is the editor's element (it renders it hidden); the chat only un-hides it.
      if (!showing) { const dot = $('#chat-dot'); if (dot) dot.hidden = false; }
      break;
    }
    default: break;
  }
  updateChatStatus(msg);
  chatScrollGrow();
}

/* --- the message box */
export function sizeChatInput(): void {
  const ta = $<HTMLTextAreaElement>('#chat-input');
  ta.style.height = 'auto';
  const sec = $('#chat-sec');
  const max = Math.max(54, Math.min(240, Math.round(sec.clientHeight * 0.42)));
  const h = Math.min(ta.scrollHeight, max);
  ta.style.height = h + 'px';
  ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
}
export function updateChatSend(): void {
  const t = chatState.thread;
  const busy = !!(t && chatState.live.has(t.id));
  const has = !!$<HTMLTextAreaElement>('#chat-input').value.trim();
  sendView.drawn = true;
  sendView.busy = busy;
  sendView.disabled = !busy && (!has || !chatProvider());
  changed(sendView);
}
export function updateChatJump(): void {
  const sc = $('#chat-scroll');
  chatState.stick = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 32;
  $('#chat-jump').classList.toggle('on', !chatState.stick);
}
export async function openChat(): Promise<void> {
  if (!chatState.opened) {
    chatState.opened = true;
    renderChatThread();
    await loadChatProviders();
    renderChatPickers();
  } else refreshChatProviders(); // an agent connected (or signed in) since: it shows up without a restart
  await syncChatFile();
  if (!chatState.thread) showChatThread(newThread());
  else if (!chatState.thread.messages.length) renderChatThread();
  sizeChatInput();
  if (lastInput === 'pointer' && !$<HTMLTextAreaElement>('#chat-input').disabled) $('#chat-input').focus({ preventScroll: true });
}
/* --- skills: "/" in the message box lists the chosen agent's own skills (from its folders on this computer). Picking one
   writes "/name " at the start; sending "/name what to do" runs it (Claude Code natively, the others with the skill's
   instructions in front). Typing filters the list; ↑↓ move, Return or Tab picks, Escape closes. */
export async function loadChatSkills(p: ChatProvider | null = chatProvider()): Promise<ChatSkill[]> {
  if (!p) return [];
  const c = chatState.skills.get(p.id);
  if (c && c.list && Date.now() - c.at < 30000) return c.list;
  if (c && c.loading) return c.loading;
  const entry: { list?: ChatSkill[]; at: number; loading?: Promise<ChatSkill[]> | null } = { list: c && c.list, at: 0 };
  entry.loading = chatNative('skills', { provider: p.id }).then((list) => {
    entry.list = Array.isArray(list) ? list : []; entry.at = Date.now(); entry.loading = null; return entry.list as ChatSkill[];
  }).catch(() => { entry.loading = null; return entry.list || []; });
  chatState.skills.set(p.id, entry);
  return entry.loading;
}
function skillQuery(): string | null {
  const ta = $<HTMLTextAreaElement>('#chat-input');
  const m = ta.value.match(/^\/(\S*)$/);
  return m && ta.selectionStart <= ta.value.length ? m[1] : null; // only while the first word is being typed
}
export function rankSkills(list: ChatSkill[], q: string): ChatSkill[] {
  q = q.toLowerCase();
  if (!q) return list.slice(0, 80);
  const scored: [number, ChatSkill][] = [];
  for (const k of list) {
    const n = k.name.toLowerCase(), short = n.split(':').pop() as string;
    const s = short.startsWith(q) ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : (k.description || '').toLowerCase().includes(q) ? 3 : -1;
    if (s >= 0) scored.push([s, k]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).map((x) => x[1]).slice(0, 80);
}
export async function updateSkillMenu(): Promise<void> {
  const q = skillQuery(), box = $('#chat-skills'), sm = chatState.skillMenu, p = chatProvider();
  if (q == null || !p) { closeSkillMenu(); return; }
  const wasOpen = sm.open;
  sm.open = true;
  skillView.hidden = false;
  const cached = chatState.skills.get(p.id);
  if (!cached || !cached.list) { skillView.key = viewKey(); skillView.note = 'Loading skills…'; skillView.items = []; }
  changed(skillView);
  const list = await loadChatSkills(p);
  if (skillQuery() == null) return;
  sm.items = rankSkills(list, skillQuery() as string);
  sm.index = Math.min(sm.index, Math.max(0, sm.items.length - 1));
  skillView.key = viewKey();
  skillView.note = sm.items.length ? null : list.length ? 'No skill matches' : `${p.name} has no skills on ${THIS_COMPUTER}`;
  skillView.items = sm.items;
  skillView.index = sm.index;
  changed(skillView);
  if (!wasOpen) popIn(box, '50% 100%', { duration: 150, scale: 0.98 });
  markSkill();
}
export function markSkill(): void {
  const sm = chatState.skillMenu;
  skillView.index = sm.index;
  changed(skillView); // the row the keyboard or the pointer is on
  const cur = $$('#chat-skills .sk-item')[sm.index];
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}
export function closeSkillMenu(): void {
  chatState.skillMenu.open = false;
  chatState.skillMenu.index = 0;
  skillView.hidden = true;
  changed(skillView);
}
export function pickSkill(k: ChatSkill): void {
  const ta = $<HTMLTextAreaElement>('#chat-input');
  ta.value = `/${k.name} `;
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  closeSkillMenu();
  sizeChatInput(); updateChatSend();
}
/** #chat-jump: back to the latest message. */
export function jumpToLatest(): void {
  const sc = $('#chat-scroll');
  chatState.stick = true;
  sc.scrollTo({ top: sc.scrollHeight, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}

/* --- what the rest of the page and the old scripts reach for */
// wireChat() is now handlers and effects in ChatPane; nothing is left to do at startup.
function initChat(): void { /* see ChatPane.tsx */ }
registerActions({
  initChat, chatOpened: () => chatState.opened, chatBusy: () => chatState.busy,
  syncChatFile, chatForget, chatMoved, chatEvent, openChat,
});
// The page opened in a browser without the app talks to the scripted agent.
setChatMock(chatMock);
registerCompat({
  // demo.js
  chatState, readyProviders, renderChatPickers, renderChatThread,
  // not used by the old scripts: the rest of the chat's old globals, for tests and the console
  openChat, sendChat, stopChat, chatEvent, chatForget, chatMoved, syncChatFile, startNewChat, showChatThread, newThread,
  loadChatProviders, refreshChatProviders, chatProvider, chatModel, chatEffort, openModelMenu, openHistoryMenu,
  updateSkillMenu, closeSkillMenu, sizeChatInput, updateChatSend, updateChatJump, chatSystemPrompt, chatTranscript,
});
