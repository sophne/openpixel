/* --- the page opened in a browser without the app (design previews): a scripted agent, never used inside OpenPixel
   (app.js 4218–4261). lib/host.ts sends Agent Chat's messages here when there is no host. */
import { actions } from '../app/actions';
import type { ChatEvent } from './types';

const chatMockState = { store: {} as Record<string, unknown>, timers: new Map<string, { stop(): void }>() };
export function chatMock(action: string, x: Record<string, any>): unknown {
  if (action === 'providers') {
    const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
    return [
      { id: 'claude-code', name: 'Claude', plan: 'Claude subscription', installed: true, ready: true, efforts, default_effort: 'medium',
        models: [{ id: 'opus', label: 'Opus 5.5' }, { id: 'sonnet', label: 'Sonnet 5.5' }, { id: 'fable', label: 'Fable 5.2' }, { id: 'haiku', label: 'Haiku 5.5' }] },
      { id: 'codex', name: 'Codex', plan: 'ChatGPT subscription', installed: true, ready: true, efforts: ['low', 'medium', 'high'], default_effort: 'medium',
        default_model: 'gpt-5.6-sol', models: [{ id: 'gpt-6.2-sol', label: 'GPT-6.2-Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], default_effort: 'low' },
          { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], default_effort: 'low' },
          { id: 'gpt-5.6-luna', label: 'GPT-5.6-Luna', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], default_effort: 'medium' }] },
      { id: 'cursor', name: 'Cursor', plan: 'Cursor plan', installed: true, ready: false, needs_setup: true, efforts: [], models: [{ id: '', label: 'Auto' }] },
    ];
  }
  if (action === 'history') return chatMockState.store[x.key] || null;
  if (action === 'skills') return [
    { name: 'emil-design-eng', description: "Emil Kowalski's design-engineering philosophy for UI polish and animation.", source: 'Personal', command: false },
    { name: 'frontend-design:frontend-design', description: 'Distinctive, intentional visual design for new UI.', source: 'frontend-design', command: false },
    { name: 'anthropic-skills:pdf', description: 'Read, create and edit PDF files.', source: 'anthropic-skills', command: false },
    { name: 'code-review:code-review', description: 'Code review a pull request', source: 'code-review', command: true },
  ];
  if (action === 'login') return true;
  if (action === 'saveHistory') { chatMockState.store[x.key] = JSON.parse(JSON.stringify(x.data)); return true; }
  if (action === 'stop') { const s = chatMockState.timers.get(x.chat); if (s) s.stop(); return true; }
  if (action !== 'send') return null;
  const ev: [number, ChatEvent][] = [];
  let at = 300;
  const push = (ms: number, e: ChatEvent): void => { at += ms; ev.push([at, e]); };
  push(0, { t: 'session', session: 'mock-session' });
  for (const w of 'The person wants changes to the sprite. I should look at the file first, then block in the shape and review.'.split(' ')) push(45, { t: 'think', d: w + ' ' });
  push(200, { t: 'tool', id: 't1', name: 'get_model_info' }); push(60, { t: 'tool_input', id: 't1', input: {} });
  push(500, { t: 'tool_done', id: 't1', ok: true, out: '{ "size": [32, 32, 1], "layers": 1 }' });
  push(150, { t: 'tool', id: 't2', name: 'paint_slice' }); push(60, { t: 'tool_input', id: 't2', input: { axis: 'z', index: 0, rows: new Array(20).fill('') } });
  push(900, { t: 'tool_done', id: 't2', ok: true, out: 'Painted 212 cells.' });
  push(150, { t: 'tool', id: 't3', name: 'review_model' }); push(60, { t: 'tool_input', id: 't3', input: { views: ['front'] } });
  push(700, { t: 'tool_done', id: 't3', ok: true, out: 'Score 92. No open issues.' });
  const reply = 'Done — I drew it on the **Layer 1** of this sprite:\n\n- A dark outline and three-tone wood ramp\n- A gold lock plate with a `#fbf236` highlight\n- Light from the top left, no pillow shading\n\nThe review scored it 92 with no open issues. Want an opening animation next?';
  for (let i = 0; i < reply.length;) { const n = 3 + Math.floor(Math.random() * 9); push(30 + Math.random() * 40, { t: 'text', d: reply.slice(i, i + n) }); i += n; }
  push(100, { t: 'done', ok: true, session: 'mock-session' });
  const ids = ev.map(([ms, e]) => setTimeout(() => actions.chatEvent({ chat: x.chat, ...e }), ms));
  chatMockState.timers.set(x.chat, { stop() { ids.forEach(clearTimeout); actions.chatEvent({ chat: x.chat, t: 'done', ok: false, stopped: true }); } });
  return true;
}
