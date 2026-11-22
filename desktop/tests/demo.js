'use strict';
/* Demo recordings for the website: `OpenPixel --record <folder> --demo <config.json>` sets window.OPENPIXEL_DEMO and
   this script plays a person using Agent Chat: a drawn cursor (the window's own picture has no system pointer) opens
   the agent menu, picks the agent, model and effort, types the request and sends it. From there it is a real run of
   that agent on the person's subscription; the app records the window until the reply is done, then the finished
   animation plays. Nothing here runs in normal use.
   Config: { name, width, height, depth?, open?, mode?: "slice"|"3d", pane?: "chat"|"layers"|"activity", chat?: false (a still
             picture only), agent, model, effort, prompt, play?, fps?, workFps?,
             screenshot?: path for the final 2× picture } */
(function () {
  const D = window.OPENPIXEL_DEMO;
  if (!D || !bridge) return;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const demo = (action, extra = {}) => bridge.postMessage({ kind: 'demo', action, ...extra });
  const until = async (fn, ms = 600000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(150); } return false; };

  /* The cursor: macOS's arrow, moved with an ease-in-out glide (on-screen movement), pressed with a quick scale. */
  const cursor = document.createElement('div');
  cursor.innerHTML = '<svg width="22" height="28" viewBox="0 0 22 28"><path d="M2 1.5v21.2l5.2-5 3.4 8 3.6-1.5-3.4-7.8h7.2z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  Object.assign(cursor.style, { position: 'fixed', left: '0', top: '0', zIndex: '9999', pointerEvents: 'none', opacity: '0',
    transition: 'transform 700ms cubic-bezier(0.65, 0, 0.35, 1), opacity 200ms ease', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.45))' });
  let at = { x: 0, y: 0 };
  const place = (x, y, ms = 700) => { cursor.style.transitionDuration = `${ms}ms, 200ms`; cursor.style.transform = `translate(${x}px, ${y}px)`; at = { x, y }; };
  const centre = (el, dx = 0, dy = 0) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2 + dx, r.top + r.height / 2 + dy]; };
  async function moveTo(el, { dx = 0, dy = 0, ms } = {}) {
    const [x, y] = centre(el, dx, dy);
    const dist = Math.hypot(x - at.x, y - at.y);
    const t = ms || Math.round(Math.min(900, Math.max(380, dist * 0.9)));
    place(x - 2, y - 2, t);
    await sleep(t + 60);
  }
  async function click(el) {
    lastInput = 'pointer';
    cursor.animate([{ scale: 1 }, { scale: 0.86 }, { scale: 1 }], { duration: 180, easing: 'ease-out' });
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    el.classList.add('demo-press');
    await sleep(110);
    el.classList.remove('demo-press');
    el.click();
    await sleep(260);
  }
  const option = (menu, text) => [...menu.querySelectorAll('.opt, div')].find((d) => d.textContent.trim() === text);

  async function run() {
    await until(() => typeof stateReady !== 'undefined' && stateReady, 30000);
    document.documentElement.classList.add('screenshot'); // the window's glass colour, painted by the page
    // The file to work on: a new one at the configured size, or an existing one.
    if (D.open) await nativeAction('openPath', { path: D.open });
    else {
      await nativeAction('newDocument', { tool: D.depth > 1 ? 'new_model' : 'new_sprite',
        args: D.depth > 1 ? { size_x: D.width, size_y: D.height, size_z: D.depth, name: D.name } : { width: D.width, height: D.height, name: D.name, palette: 'none' } });
    }
    await refresh();
    showEditor();
    await sleep(600);
    if (D.mode) setMode(D.mode);
    leftSide.pane = D.pane || 'chat'; leftSide.open = true; applyLeftSide();
    // Pictures show the editor as it opens: both side panels as wide as the right one's default (not a saved size).
    setSize('right', SIZES.right[2]); setSize('left', D.leftWidth || SIZES.right[2]);
    if (S.mode === 'slice') fitSlice(); else resetCamera();
    if (D.chat === false) {
      // Just a picture of the editor (a sidebar panel, the file as it is): no agent, nothing typed. An empty Agent
      // Chat waits for the agents first, so it shows its welcome rather than "Looking for your agents…".
      if (leftSide.pane === 'chat') { await until(() => readyProviders().length > 0, 60000); renderChatPickers(); renderChatThread(); }
      await sleep(D.settleMs || 2500);
      await demo('stop', { screenshot: D.screenshot, quit: D.quit !== false });
      return;
    }
    await until(() => readyProviders().length > 0, 60000);
    renderChatPickers();
    await sleep(1200);
    document.body.appendChild(cursor);
    if (D.record !== false) await demo('record', { fps: D.fps || 12 });
    await demo('mark', { name: 'start' });
    place(window.innerWidth * 0.62, window.innerHeight * 0.55, 0);
    await sleep(400);
    cursor.style.opacity = '1';
    await sleep(700);

    // Agent and model: the real menu.
    await moveTo($('#chat-model .dd-btn'));
    await click($('#chat-model .dd-btn'));
    await sleep(350);
    const menu = $('#chat-model-menu');
    const header = [...menu.querySelectorAll('header')].find((h) => h.querySelector('b').textContent === D.agent);
    let opt = null;
    for (let n = header && header.nextElementSibling; n && n.tagName !== 'HEADER' && n.tagName !== 'HR'; n = n.nextElementSibling) {
      if (n.textContent.trim() === D.model) { opt = n; break; }
    }
    if (!opt) throw new Error(`no ${D.agent} · ${D.model} in the agent menu`);
    await moveTo(opt, { dx: -40 });
    opt.classList.add('kb');
    await sleep(250);
    await click(opt);
    await sleep(300);

    // Effort.
    if (D.effort) {
      const eb = $('#chat-effort .dd-btn');
      await moveTo(eb);
      await click(eb);
      await sleep(300);
      const e = option($('#chat-effort .dd-list'), D.effort);
      if (!e) throw new Error(`no effort ${D.effort}`);
      await moveTo(e, { dx: -20 });
      e.classList.add('kb');
      await sleep(220);
      await click(e);
      await sleep(300);
    }

    // The request, typed.
    const ta = $('#chat-input');
    await moveTo(ta, { dx: -60 });
    await click(ta);
    ta.focus();
    for (const ch of D.prompt) {
      ta.value += ch;
      ta.dispatchEvent(new Event('input'));
      await sleep(ch === ' ' ? 34 : ch === ',' || ch === '.' ? 180 : 22 + Math.random() * 30);
    }
    await sleep(500);
    await moveTo($('#chat-send'));
    await demo('mark', { name: 'send' });
    await click($('#chat-send'));
    await sleep(900);
    cursor.style.opacity = '0';

    // The real run: frames come slower while the agent works (the video speeds this part up).
    if (D.record !== false) await demo('record', { fps: D.workFps || 1 });
    await demo('mark', { name: 'working' });
    await sleep(3000);
    await until(() => !chatState.busy, D.timeoutMs || 3600000);
    if (D.record !== false) await demo('record', { fps: D.fps || 12 });
    await demo('mark', { name: 'done' });
    await sleep(1800);
    if (D.play && S.frames.length > 1) {
      if (S.mode === 'slice') fitSlice();
      await moveTo($('#play'));
      cursor.style.opacity = '1';
      await click($('#play'));
      cursor.style.opacity = '0';
      await demo('mark', { name: 'play' });
      await sleep(D.playMs || 5000);
    }
    await demo('mark', { name: 'end' });
    await demo('stop', { screenshot: D.screenshot, quit: D.quit !== false });
  }
  run().catch(async (e) => {
    toast(`Demo stopped: ${errorText(e)}`);
    await demo('mark', { name: `error: ${errorText(e)}` });
    await demo('stop', { quit: false });
  });
})();
