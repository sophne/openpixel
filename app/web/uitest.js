'use strict';
/* OpenPixel UI test. Runs only when the app is started with `--ui-test <folder>`: it clicks through the
   editor like a person would, resizes every panel and the window, checks that nothing spills out or gets
   cut off, saves pictures of the checkpoints and writes report.json into that folder. */
(function () {
  const CFG = window.OPENPIXEL_UITEST;
  if (!CFG) return;
  // Snapshots capture the page alone, without the window's glass behind it; a dark stand-in keeps them readable.
  document.documentElement.style.background = '#2b2b2e';
  const results = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const post = (msg) => bridge.postMessage(msg);
  const snap = (name) => post({ kind: 'snap', name });
  function assert(c, msg) { if (!c) throw new Error(msg); }
  async function until(cond, what, ms = 5000) {
    const t = Date.now();
    while (Date.now() - t < ms) { if (await cond()) return; await sleep(40); }
    throw new Error('timed out waiting for ' + what);
  }
  async function settle() { await sleep(80); await until(() => !refreshing, 'the editor to refresh'); await sleep(80); }
  async function edited(rev) { await until(() => S.revision > rev && !refreshing, 'the model to change'); await sleep(80); }
  async function test(name, fn) {
    const t0 = performance.now();
    try { await fn(); results.push({ name, ok: true, ms: Math.round(performance.now() - t0) }); }
    catch (e) { results.push({ name, ok: false, error: String(e && e.message ? e.message : e) }); }
    closeMenus(); closePicker(); closeModals();
  }
  const ev = (target, type, x, y, o = {}) => target.dispatchEvent(new MouseEvent(type, {
    clientX: x, clientY: y, bubbles: true, cancelable: true, button: o.button || 0, buttons: 1, altKey: !!o.alt, shiftKey: !!o.shift,
  }));
  function cellXY(c, r) {
    const rect = sliceCanvas.getBoundingClientRect();
    return [rect.left + sv.panX + (c + 0.5) * sv.zoom, rect.top + sv.panY + (r + 0.5) * sv.zoom];
  }
  async function stroke(cells, o = {}) {
    const pts = cells.map(([c, r]) => cellXY(c, r));
    ev(sliceCanvas, 'mousedown', pts[0][0], pts[0][1], o);
    for (const [x, y] of pts) ev(window, 'mousemove', x, y, o);
    const last = pts[pts.length - 1];
    ev(window, 'mouseup', last[0], last[1], o);
  }
  const pick = (id) => document.querySelector(`.tool[data-tool="${id}"]`).click();
  const vox = async (x, y, z) => (await call('get_voxel', { at: [x, y, z] })).index || 0;
  const count = async () => (await call('get_model_info', {})).voxels_in_active_frame;
  const px = (c, r) => vox(c, S.sy - 1 - r, 0); // a sprite pixel by image row

  /* Everything visible inside `root` must stay within it horizontally (and vertically when asked). */
  function spills(root, { vertical = false, skip = [] } = {}) {
    const R = root.getBoundingClientRect();
    const bad = [];
    for (const el of root.querySelectorAll('*')) {
      if (el.closest('[hidden]') || el.closest('.resizer') || skip.some((s) => el.closest(s))) continue;
      if (el.closest('svg') && el.tagName !== 'svg') continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      // Content that scrolls inside its own box is fine.
      let scroller = el.parentElement, scrolled = false;
      while (scroller && scroller !== root) {
        const s = getComputedStyle(scroller);
        if (/(auto|scroll)/.test(s.overflowX + s.overflowY)) { scrolled = true; break; }
        scroller = scroller.parentElement;
      }
      if (scrolled) continue;
      const out = r.right > R.right + 0.5 || r.left < R.left - 0.5 || (vertical && (r.bottom > R.bottom + 0.5 || r.top < R.top - 0.5));
      if (out) bad.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} "${(el.textContent || '').trim().slice(0, 20)}"`);
    }
    // Text cut off without an ellipsis inside buttons/labels.
    for (const el of root.querySelectorAll('button, label, .lbl, .sec-head, .chip')) {
      if (el.closest('[hidden]')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || !el.offsetWidth) continue;
      if (el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && cs.overflow !== 'visible') bad.push(`clipped text: ${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 20)}"`);
    }
    return [...new Set(bad)];
  }
  function noSpill(root, name, o) { const b = spills(root, o); assert(!b.length, `${name}: ${b.slice(0, 6).join('; ')}`); }
  function topBarOk() {
    const left = $('#top .left').getBoundingClientRect(), mid = $('#mode-seg').getBoundingClientRect(), right = $('#top .right').getBoundingClientRect();
    const top = $('#top').getBoundingClientRect();
    assert(left.right <= mid.left + 1, 'top bar: left side overlaps the 2D/3D switch');
    assert(mid.right <= right.left + 1, 'top bar: right side overlaps the 2D/3D switch');
    assert(right.right <= top.right + 1, 'top bar: buttons run off the right edge');
    // 2D/3D sits over the middle of the canvas, and its selected segment has the same gap above and below.
    const st = $('#stage').getBoundingClientRect();
    assert(Math.abs((mid.left + mid.right) / 2 - (st.left + st.right) / 2) < 1, `top bar: 2D/3D is not over the middle of the canvas (${Math.round((mid.left + mid.right) / 2)} vs ${Math.round((st.left + st.right) / 2)})`);
    const on = $('#mode-seg button.on').getBoundingClientRect();
    const gaps = [on.top - mid.top, mid.bottom - on.bottom];
    assert(Math.abs(gaps[0] - gaps[1]) < 0.5 && gaps[0] >= 1.5, `top bar: the selected 2D/3D segment sits unevenly (${gaps.map((g) => g.toFixed(1)).join(' above, ')} below)`);
    noSpill($('#top .right'), 'top bar buttons');
  }
  function stageOk() {
    const st = $('#stage').getBoundingClientRect(), tb = $('#toolbar').getBoundingClientRect();
    assert(tb.left >= st.left - 1 && tb.right <= st.right + 1, `toolbar wider than the canvas (${Math.round(tb.width)} > ${Math.round(st.width)})`);
  }
  function framesOk() {
    const strip = $('#strip').getBoundingClientRect();
    for (const t of $$('#strip .fr .thumb')) {
      const r = t.getBoundingClientRect(), fr = t.parentElement.getBoundingClientRect();
      assert(r.bottom <= strip.bottom + 1 && r.top >= strip.top - 1, 'frame preview spills out of the frames panel');
      assert(r.right <= fr.right + 1 && r.left >= fr.left - 1, 'frame preview spills out of its card');
    }
    noSpill($('#frames-bar'), 'frames bar');
  }
  function layoutOk(where) {
    topBarOk(); stageOk(); framesOk();
    noSpill($('#right'), `${where}: right panel`);
    noSpill($('#left'), `${where}: left panel`);
  }
  async function drag(resizer, x, y) {
    const el = document.querySelector(`.resizer[data-resize="${resizer}"]`);
    const r = el.getBoundingClientRect();
    ev(el, 'mousedown', r.left + 2, r.top + 2);
    ev(window, 'mousemove', x, y);
    ev(window, 'mouseup', x, y);
    await sleep(150);
  }
  /** Back to the active file from the home screen (what Back to editor used to do): its tab. */
  async function backToEditor() {
    const t = $(`#tabs .tab[data-tab="${ui.active}"]`);
    assert(t, 'no tab for the active file');
    t.click();
    await until(() => !S.home && ui.view === 'editor', 'the editor');
  }
  /** Home remembers the page it was on; tests pick one (Recents unless they say). */
  async function goHome(view = 'recents') {
    $('#tab-home').click();
    await until(() => S.home && ui.view === 'home', 'the home screen');
    $(`.home-nav[data-home="${view}"]`).click();
    await until(() => home.view === view && (view === 'agents' || !$('#home-files-wrap').hidden), `the ${view} page`);
  }
  const homeCard = (text) => $$('#home-files .card').find((c) => c.textContent.includes(text));
  /** An open dropdown's list sits right under its button (or right above it when there is no room), left edges lined up. */
  function underItsButton(dd) {
    dd.querySelector('.dd-list').getAnimations().forEach((x) => x.finish()); // measured at its final size, not mid-zoom
    const b = dd.querySelector('.dd-btn').getBoundingClientRect(), l = dd.querySelector('.dd-list').getBoundingClientRect();
    underItsButton.last = `button ${Math.round(b.left)},${Math.round(b.bottom)}; list ${Math.round(l.left)},${Math.round(l.top)}`;
    const vertical = Math.abs(l.top - (b.bottom + 4)) < 1.5 || Math.abs(l.bottom - (b.top - 4)) < 1.5;
    return dd.classList.contains('open') && vertical && (Math.abs(l.left - b.left) < 1.5 || Math.abs(l.right - (window.innerWidth - 8)) < 1.5);
  }
  function dnd(source, target) {
    const dt = new DataTransfer();
    const at = (el) => { const r = el.getBoundingClientRect(); return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; };
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt, ...at(source) }));
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, ...at(target) });
    target.dispatchEvent(over);
    const accepted = over.defaultPrevented;
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ...at(target) }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    return accepted;
  }
  async function bothModes(fn) {
    for (const m of ['slice', '3d']) { setMode(m); await sleep(120); await fn(m); }
    setMode('slice'); await sleep(80);
  }

  // The person's own remembered choices (home view, new-file size and palette) are put back after the run.
  const KEPT = ['openpixel.homeView', 'openpixel.newFile', 'openpixel.leftSide'];
  const savedPrefs = Object.fromEntries(KEPT.map((k) => { try { return [k, localStorage.getItem(k)]; } catch (e) { return [k, null]; } }));
  function restoreHomeView() {
    for (const k of KEPT) {
      try { if (savedPrefs[k] === null) localStorage.removeItem(k); else localStorage.setItem(k, savedPrefs[k]); } catch (e) { /* not stored */ }
    }
  }
  async function run() {
    await until(() => stateReady, 'the editor to start', 15000);
    Object.assign(homePrefs, { layout: 'grid', filter: 'all', sort: 'modified', dir: 'desc' });
    leftSide.pane = 'layers'; leftSide.open = true; applyLeftSide(); // the editor's sidebar as it starts, open on Layers
    await sleep(300);

    await test('starts on the home screen: samples among the files, search in the sidebar, Create new and Open file buttons', async () => {
      assert(S.home && !$('#home').hidden, 'home screen not shown');
      await until(() => $$('#home-files .card[data-sample]').length === 2, 'two sample cards among the files');
      assert($('#home-files .card[data-sample] img'), 'sample cards have no preview');
      assert(!$('.home-nav[data-home="samples"]'), 'the Samples page should be gone');
      assert(!$('#home-back') && !$$('.home-nav').some((n) => /back to editor/i.test(n.textContent)), 'Back to editor should be gone');
      assert($('.home-side #home-search'), 'search is not in the sidebar');
      for (const id of ['#home-create', '#home-open']) {
        const b = $(id);
        assert(b && b.tagName === 'BUTTON' && b.closest('.home-top') && b.firstElementChild && b.firstElementChild.tagName === 'svg', `${id} is not a button with a leading icon in the header`);
      }
      assert($('.home-nav[data-home="folders"]') && $('.home-nav[data-home="archive"]'), 'All folders / Archive missing from the sidebar');
      assert(!$$('#tabs .tab').length && $('#tab-home').classList.contains('on'), 'tab bar should show only Home');
      // The sidebar: no logo, no new-folder button, no agents dot; GitHub and X at the bottom.
      assert(!$('.home-side .home-brand, .home-side img:not(.app-link img), #side-new-folder, #nav-agent-dot'), 'logo, + or agents dot still in the sidebar');
      const side = $('.home-side').getBoundingClientRect(), links = $$('.side-links .side-link');
      assert(links.map((b) => b.dataset.link).join() === 'website,github,x' && links.every((b) => b.querySelector('svg, img')), 'website, GitHub and X links');
      const appIcon = links[0].querySelector('svg.i');
      assert(getComputedStyle(links[0]).color === getComputedStyle(links[1]).color && getComputedStyle(links[1]).color === getComputedStyle(links[2]).color,
        'the website, GitHub and X icons share one colour');
      assert(appIcon && appIcon.querySelector('.px') && getComputedStyle(appIcon.querySelector('.px')).fill !== 'none', 'the website link shows the app icon (the 2D file mark, its pixel in the accent)');
      assert(side.bottom - links[0].getBoundingClientRect().bottom < 20, 'GitHub and X should sit at the bottom of the sidebar');
      // The tab bar is the title bar: room for the window buttons on the left, Home first.
      const bar = $('#tabbar').getBoundingClientRect(), homeBtn = $('#tab-home').getBoundingClientRect();
      assert(bar.top === 0 && homeBtn.left >= 72, `Home should sit after the window buttons (at ${homeBtn.left})`);
      assert($('#tab-home svg'), 'Home has no icon');
      // GitHub stars at the right end of the bar, lined up with the page's right edge (Create new), the bar's height,
      // on its centre line; counts are shortened.
      const stars = $('#tab-stars'), sr = stars.getBoundingClientRect(), hr = $('#tab-home').getBoundingClientRect();
      const pageRight = $('#home-create').getBoundingClientRect().right;
      assert(stars.querySelector('svg') && Math.abs(sr.right - pageRight) < 1 && Math.abs(sr.height - hr.height) < 1 && Math.abs((sr.top + sr.bottom) - (hr.top + hr.bottom)) < 1,
        `stars button: GitHub icon, right edge at the page's (${Math.round(sr.right)} vs ${Math.round(pageRight)}), same height and centre as Home`);
      // Liquid Glass: the tab bar and the home sidebar share the window's glass (no fill, no line between them);
      // the page is a solid rounded sheet.
      const clear = (el) => getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)';
      assert(clear($('#tabbar')) && clear($('.home-side')) && getComputedStyle($('#tabbar')).boxShadow === 'none', 'tab bar and sidebar should be on the window glass');
      assert(!clear($('.home-main')) && parseFloat(getComputedStyle($('.home-main')).borderTopLeftRadius) >= 10, 'the page should be a rounded sheet');
      const before = $('#stars-count').textContent;
      for (const [n, t] of [[1, '1'], [999, '999'], [1000, '1K'], [108600, '108.6K'], [1250000, '1.2M']]) {
        PC.githubStars(n);
        assert($('#stars-count').textContent === t, `${n} stars shown as ${$('#stars-count').textContent}`);
      }
      $('#stars-count').textContent = before;
      await sleep(40);
      assert(JSON.parse(titlebarSent).holes.some(([a, b]) => a <= sr.left + 1 && b >= sr.right - 1), 'the stars button is not reported as a title-bar control');
      assert(titlebarSent && JSON.parse(titlebarSent).holes.length >= 2, 'the app was not told where the tab bar controls are');
      noSpill($('.home-main'), 'home');
      await snap('01-home');
    });
    await test('New file page from + (a page, not a dialog): 2D File, 3D File and Import above a search and Recents; 2D File opens a sprite in a tab', async () => {
      $('#tab-add').click();
      await until(() => ui.view === 'new' && !$('#newpage').hidden, 'the New file page');
      assert(!$$('.modal-bg.open').length, 'a dialog opened');
      assert($('#tabs .tab.new-tab.on'), 'no New file tab');
      const starts = $$('.np-starts .np-start').map((b) => b.textContent.trim());
      assert(starts.join('|') === '2D File|3D File|Import', `start buttons: ${starts.join(', ')}`);
      const pills = $('.np-starts').getBoundingClientRect(), search = $('.np-search').getBoundingClientRect();
      assert(pills.bottom < search.top, 'the start buttons should sit above the search');
      assert(document.activeElement === $('#np-search'), 'the search should be ready to type in');
      await until(() => $$('#np-recents .np-row').length >= 2, 'files to open on the New file page');
      assert($('#np-title').textContent === 'Recents', 'Recents heading');
      assert($('#np-browse').hidden, 'Browse all recent should hide while every recent file is already listed');
      noSpill($('#newpage'), 'New file page');
      await snap('01b-new-page');
      // 2D File asks for the name, size and palette first.
      $('#np-2d').click();
      await until(() => $('#newfile-dialog').classList.contains('open'), 'the New 2D file dialog');
      assert($('#newfile-title').textContent === 'New 2D file' && $('#nf-z').closest('.stepper').hidden, '2D dialog: title, no depth');
      $('#nf-name').value = 'Sprite test';
      $('#nf-x').value = 18; $('#nf-y').value = 18;
      $$('#newfile-dialog .stepper button[data-step="-1"]')[0].click();
      $$('#newfile-dialog .stepper button[data-step="-1"]')[0].click();
      $$('#newfile-dialog .stepper button[data-step="-1"]')[1].click();
      $$('#newfile-dialog .stepper button[data-step="-1"]')[1].click();
      assert($('#nf-x').value === '16' && $('#nf-y').value === '16', `steppers gave ${$('#nf-x').value}×${$('#nf-y').value}`);
      assert($('.nf-presets [data-nf-size="16"]').classList.contains('on'), 'the 16 preset should show as chosen');
      $('#nf-palette .dd-btn').click();
      assert($('#nf-palette .opt[data-value="none"]'), 'No palette is not offered');
      const soon = underItsButton($('#nf-palette')), soonAt = underItsButton.last;
      await sleep(200);
      assert(soon, `the palette list should open under its field, right away (${soonAt})`);
      assert(underItsButton($('#nf-palette')), `the palette list should open under its field (${underItsButton.last})`);
      $('#nf-palette .opt[data-value="db32"]').click();
      noSpill($('#newfile-dialog .modal'), 'New file dialog', { vertical: true });
      await sleep(200);
      await snap('01c-new-file-dialog');
      $('#nf-ok').click();
      await until(() => S.sx === 16 && S.sy === 16 && S.sz === 1 && !S.home, 'a 16×16 sprite in the editor');
      await settle();
      assert(S.name === 'Sprite test' && S.palette.length === 33, `name ${S.name}, ${S.palette.length - 1} colours`);
      assert(S.mode === 'slice', 'sprite did not open on the 2D canvas');
      assert(!$('#newfile-dialog').classList.contains('open'), 'the dialog should close');
      assert($$('#tabs .tab.file').length === 1 && $('#tabs .tab.file.on') && !$('#tabs .tab.new-tab'), 'the new file should take the New file tab\'s place');
      await settle();
      // Created means saved: the file is on disk (in the files folder) and the tab has nothing unsaved.
      const made = (await nativeAction('tabs')).tabs.find((t) => t.name === 'Sprite test');
      assert(made && made.path && made.path.endsWith('/Files/Sprite test.openpixel') && !made.dirty, `the new file should be saved right away (${made && made.path}, dirty ${made && made.dirty})`);
      assert((await nativeAction('library')).files.some((f) => f.path === made.path), 'the new file should be in Recents');
    });
    await test('autosave: changes are written a moment after they happen', async () => {
      const rev = S.revision;
      await call('set_pixels', { pixels: [[0, 0, 4]] });
      await edited(rev);
      const active = async () => { const r = await nativeAction('tabs'); return r.tabs.find((t) => t.id === r.active); };
      assert((await active()).dirty, 'the change should first show as unsaved');
      const t0 = Date.now();
      await until(async () => !(await active()).dirty, 'the autosave', 4000);
      assert(Date.now() - t0 < 3000, `autosave took ${Date.now() - t0} ms`);
      await until(() => !$('#tabs .tab.file.on').classList.contains('dirty'), 'the tab to drop its unsaved dot');
      await call('undo', {});
    });
    await test('pencil draws one pixel', async () => {
      pick('pencil'); setFg(5);
      const rev = S.revision;
      await stroke([[3, 4]]);
      await edited(rev);
      assert(await px(3, 4) === 5, 'pixel (3,4) not painted');
    });
    await test('pencil drag draws a continuous line', async () => {
      const rev = S.revision;
      await stroke([[0, 8], [7, 8]]);
      await edited(rev);
      for (let c = 0; c <= 7; c++) assert(await px(c, 8) === 5, `gap at (${c},8)`);
    });
    await test('line tool', async () => {
      pick('line'); setFg(9);
      const rev = S.revision;
      await stroke([[0, 12], [3, 12], [6, 12]]);
      await edited(rev);
      for (let c = 0; c <= 6; c++) assert(await px(c, 12) === 9, `line gap at (${c},12)`);
    });
    await test('rectangle tool', async () => {
      pick('rect'); setFg(12);
      const before = await count(), rev = S.revision;
      await stroke([[10, 1], [12, 3]]);
      await edited(rev);
      assert(await count() - before === 9, 'rectangle is not 3×3');
    });
    await test('eraser removes a pixel', async () => {
      pick('eraser');
      const rev = S.revision;
      await stroke([[3, 4]]);
      await edited(rev);
      assert(await px(3, 4) === 0, 'pixel still there');
    });
    await test('right-click erases', async () => {
      pick('pencil'); setFg(5);
      let rev = S.revision;
      await stroke([[5, 5]]); await edited(rev);
      rev = S.revision;
      await stroke([[5, 5]], { button: 2 }); await edited(rev);
      assert(await px(5, 5) === 0, 'right-click did not erase');
    });
    await test('paint bucket fills an area', async () => {
      pick('fill'); setFg(20);
      const before = await count(), rev = S.revision;
      await stroke([[15, 15]]);
      await edited(rev);
      assert(await count() - before > 100, 'fill covered too little');
      await call('undo', {}); await settle();
    });
    await test('recolour paints only existing pixels', async () => {
      pick('recolor'); setFg(22);
      const rev = S.revision;
      await stroke([[0, 8], [2, 8]]);
      await edited(rev);
      assert(await px(1, 8) === 22, 'pixel not recoloured');
    });
    await test('eyedropper picks a colour (tool and Alt+click)', async () => {
      pick('picker'); setFg(1);
      await stroke([[4, 12]]);
      assert(S.fg === 9, `picked ${S.fg}, expected 9`);
      pick('pencil'); setFg(1);
      await stroke([[11, 2]], { alt: true });
      assert(S.fg === 12, `Alt+click picked ${S.fg}, expected 12`);
    });
    await test('mirror X draws on both sides', async () => {
      pick('pencil'); setFg(5);
      $('[data-mirror="x"]').click();
      const rev = S.revision;
      await stroke([[1, 14]]);
      await edited(rev);
      $('[data-mirror="x"]').click();
      assert(await px(14, 14) === 5, 'mirrored pixel missing');
    });
    await test('brush size 3 paints a 3×3 square', async () => {
      $('#brush').value = 3; $('#brush').dispatchEvent(new Event('input'));
      const before = await count(), rev = S.revision;
      await stroke([[8, 5]]);
      await edited(rev);
      $('#brush').value = 1; $('#brush').dispatchEvent(new Event('input'));
      assert(await count() - before === 9, 'not 9 pixels');
    });
    await test('undo and redo buttons', async () => {
      const n = await count();
      let rev = S.revision;
      $('#undo').click(); await edited(rev);
      assert(await count() !== n, 'undo changed nothing');
      rev = S.revision;
      $('#redo').click(); await edited(rev);
      assert(await count() === n, 'redo did not bring it back');
    });
    await test('add a colour with the + button and the picker', async () => {
      $('#add-color').click();
      assert(!$('#picker').hidden, 'picker did not open');
      $('#pk-hex').value = '#123456'; $('#pk-hex').dispatchEvent(new Event('input'));
      const rev = S.revision;
      $('#pk-ok').click();
      await edited(rev);
      assert(S.palette.includes('#123456'), 'colour not in the palette');
      assert(S.palette[S.fg] === '#123456', 'new colour not selected');
      await snap('02-picker-added');
    });
    await test('picker: dragging in the colour square changes the colour', async () => {
      $('#add-color').click();
      await until(() => !$('#picker').hidden, 'the colour picker');
      $('#picker').getAnimations().forEach((a) => a.finish()); // measure the square at its full size, not mid-zoom
      const sq = $('#sv').getBoundingClientRect();
      ev($('#sv'), 'mousedown', sq.left + sq.width * 0.9, sq.top + sq.height * 0.1);
      ev(window, 'mouseup', sq.left + sq.width * 0.9, sq.top + sq.height * 0.1);
      $('#hue').value = 120; $('#hue').dispatchEvent(new Event('input'));
      const hex = $('#pk-hex').value;
      assert(/^#[0-9a-f]{6}$/.test(hex) && hex !== '#123456', `picker shows ${hex}`);
      const rev = S.revision;
      $('#pk-ok').click(); await edited(rev);
      assert(S.palette.includes(hex), 'picked colour not added');
    });
    await test('edit a colour by double-clicking its swatch', async () => {
      $$('#palette .sw')[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      assert(!$('#picker').hidden && $('#pk-ok').textContent === 'Apply', 'edit picker did not open');
      $('#pk-hex').value = '#abcdef'; $('#pk-hex').dispatchEvent(new Event('input'));
      const rev = S.revision;
      $('#pk-ok').click(); await edited(rev);
      assert(S.palette[2] === '#abcdef', `swatch 2 is ${S.palette[2]}`);
    });
    await test('toolbar swatch and typed hex add colours', async () => {
      $('#tb-color').click();
      $('#pk-hex').value = '#00ff88'; $('#pk-hex').dispatchEvent(new Event('input'));
      let rev = S.revision;
      $('#pk-ok').click(); await edited(rev);
      assert(S.palette.includes('#00ff88'), 'toolbar swatch did not add');
      $('#fg-hex').value = '#445566';
      rev = S.revision;
      $('#fg-hex').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await edited(rev);
      assert(S.palette[S.fg] === '#445566', 'typed hex not added and selected');
    });
    await test('palette preset dropdown is the app\'s own menu', async () => {
      $('#preset .dd-btn').click();
      assert($('#preset').classList.contains('open'), 'dropdown did not open');
      const list = $('#preset .dd-list').getBoundingClientRect();
      assert(list.height > 100 && list.right <= window.innerWidth, 'dropdown list badly placed');
      await snap('03-dropdown');
      const rev = S.revision;
      $('#preset .opt[data-value="pico8"]').click();
      await edited(rev);
      assert(S.palette[2] === '#1d2b53', 'PICO-8 not applied');
      assert(!$('#preset').classList.contains('open'), 'dropdown stayed open');
    });
    await test('shortcuts: layer and frame commands from the menu bar, ⌥↑/↓, O, and not while typing', async () => {
      const key = (k, o = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
      let rev = S.revision;
      PC.command('newLayer'); await edited(rev);
      assert(S.layers.length === 2, 'new layer (⇧⌘N)');
      rev = S.revision; PC.command('duplicateLayer'); await edited(rev);
      assert(S.layers.length === 3, 'duplicate layer (⌘D)');
      const top = S.layer;
      key('ArrowDown', { altKey: true }); await settle();
      assert(S.layer === top - 1, `⌥↓ should select the layer below (${top} → ${S.layer})`);
      key('ArrowUp', { altKey: true }); await settle();
      assert(S.layer === top, '⌥↑ should select the layer above');
      // ⌘⌫ while typing a hex colour edits the text, not the document.
      $('#fg-hex').focus();
      PC.command('deleteLayer'); await sleep(150);
      assert(S.layers.length === 3, '⌘⌫ deleted a layer while typing');
      $('#fg-hex').blur();
      rev = S.revision; PC.command('deleteLayer'); await edited(rev);
      rev = S.revision; PC.command('deleteLayer'); await edited(rev);
      assert(S.layers.length === 1, 'delete layer (⌘⌫)');
      PC.command('deleteLayer'); await sleep(100);
      assert(S.layers.length === 1 && $('#toast').textContent.includes('at least one layer'), 'deleting the last layer should explain why not');
      rev = S.revision; PC.command('newFrame'); await edited(rev);
      assert(S.frames.length === 2, 'new frame (⌥⌘N)');
      rev = S.revision; PC.command('deleteFrame'); await edited(rev);
      assert(S.frames.length === 1, 'delete frame (⌥⌘⌫)');
      const onion = S.onionOn;
      key('o'); await settle();
      assert(S.onionOn !== onion, 'O toggles onion skin');
      key('o'); await settle();
    });
    await test('tooltips: own label with key caps above the control, after a pause, then instantly for the next one', async () => {
      const over = (el) => el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
      const out = (el, to) => el.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: to }));
      const tipBox = () => document.querySelector('.tip');
      const picker = $('.tool[data-tool="picker"]'), line = $('.tool[data-tool="line"]');
      over(picker);
      assert(!tipBox() || !tipBox().classList.contains('on'), 'the first tooltip should wait');
      await sleep(650);
      const t = tipBox();
      assert(t && t.classList.contains('on'), 'no tooltip');
      assert(t.textContent.startsWith('Eyedropper') && t.querySelector('kbd').textContent === 'I', `content: ${t.textContent}`);
      assert(!picker.hasAttribute('title') && picker.getAttribute('aria-label') === 'Eyedropper', 'the system tooltip should be gone and the name kept');
      const tr = t.getBoundingClientRect(), pr = picker.getBoundingClientRect();
      assert(t.dataset.side === 'top' && tr.bottom <= pr.top, 'should sit above the toolbar button');
      await snap('18-tooltip');
      out(picker, line); over(line);
      await sleep(30);
      assert(t.classList.contains('on') && t.textContent.startsWith('Line'), 'the next tooltip should show at once');
      out(line, document.body);
      assert(!t.classList.contains('on'), 'leaving should hide it');
      // Near the top edge it flips below.
      over($('#undo')); await sleep(30);
      assert(t.classList.contains('on') && t.dataset.side === 'bottom', 'top bar tooltip should sit below');
      out($('#undo'), document.body);
    });
    await test('Help ▸ Keyboard Shortcuts (⌘/ or ?) lists every group with key caps', async () => {
      PC.command('shortcuts');
      assert($('#shortcuts-dialog').classList.contains('open'), 'did not open');
      const groups = [...$$('#shortcuts-body h3')].map((h) => h.textContent);
      for (const g of ['Tools', 'Drawing', 'Layers', 'Frames', 'View', 'File']) assert(groups.includes(g), `${g} missing`);
      assert($$('#shortcuts-body kbd').length > 60, 'too few keys listed');
      assert($('#shortcuts-body').textContent.includes('Delete layer'), 'delete layer missing');
      noSpill($('#shortcuts-dialog .modal'), 'shortcuts dialog');
      await sleep(220);
      await snap('17-shortcuts');
      closeModals();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true }));
      assert($('#shortcuts-dialog').classList.contains('open'), '? did not open the shortcuts');
      closeModals();
    });
    await test('layers: add, rename, hide, lock, duplicate, merge, delete', async () => {
      let rev = S.revision;
      $('#layer-add').click(); await edited(rev);
      assert(S.layers.length === 2 && S.layer === 1, 'layer not added');
      // The selected layer stands out (a fill like the sidebar's active page) and the buttons name it.
      {
        const rows = $$('#layers .layer'), on = rows.find((r) => r.classList.contains('on')), off = rows.find((r) => !r.classList.contains('on'));
        assert(on && off && on.getAttribute('aria-current') === 'true', 'one layer row should be marked selected');
        assert(getComputedStyle(on).backgroundColor !== getComputedStyle(off).backgroundColor && getComputedStyle(on).backgroundColor !== 'rgba(0, 0, 0, 0)', 'the selected layer should have its own fill');
        assert($('#layer-del').title.includes(`“${S.layers[S.layer].name}”`), `Delete should name the layer (${$('#layer-del').title})`);
        rev = S.revision; off.click(); await until(() => S.layer === 0, 'layer 1 to be selected');
        const again = $$('#layers .layer');
        assert(again[again.length - 1].classList.contains('on') && !again[0].classList.contains('on'), 'clicking a layer should move the highlight to it');
        assert($('#layer-del').title.includes(`“${S.layers[0].name}”`), 'Delete should follow the selection');
        again[0].click(); await until(() => S.layer === 1, 'the new layer selected again');
      }
      const name = $('#layers .layer .lname');
      name.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const input = $('#layers .layer .lname input');
      assert(input, 'rename field missing');
      input.value = 'Details';
      rev = S.revision;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await edited(rev);
      assert(S.layers[1].name === 'Details', 'not renamed');
      rev = S.revision; $$('#layers .layer')[0].querySelectorAll('.tog')[1].click(); await edited(rev);
      assert(!S.layers[1].visible, 'not hidden');
      rev = S.revision; $$('#layers .layer')[0].querySelectorAll('.tog')[1].click(); await edited(rev);
      rev = S.revision; $$('#layers .layer')[0].querySelectorAll('.tog')[0].click(); await edited(rev);
      assert(S.layers[1].locked, 'not locked');
      pick('pencil');
      await stroke([[2, 2]]); await sleep(300);
      assert(await px(2, 2) === 0, 'a locked layer was drawn on');
      rev = S.revision; $$('#layers .layer')[0].querySelectorAll('.tog')[0].click(); await edited(rev);
      rev = S.revision; $('#layer-dup').click(); await edited(rev);
      assert(S.layers.length === 3, 'not duplicated');
      // Drag to reorder: the top row is the front. Drop the front layer below the back one, then put it back.
      {
        const drag = (src, dst, where) => {
          const dt = new DataTransfer(), r = dst.getBoundingClientRect();
          const y = where === 'above' ? r.top + 3 : where === 'below' ? r.bottom - 3 : r.bottom + 20;
          const at = { clientX: r.left + r.width / 2, clientY: y };
          src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
          const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, ...at });
          dst.dispatchEvent(over);
          const line = dst.classList.contains('drop-above') || dst.classList.contains('drop-below') || $('#layers').classList.contains('drop-end');
          dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
          src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
          return over.defaultPrevented && line;
        };
        const names = () => $$('#layers .layer .lname').map((n) => n.textContent);
        const before = names(); // top (front) first
        assert(before.length === 3, `three layers to reorder (${before})`);
        let rows = $$('#layers .layer'), rev = S.revision;
        assert(drag(rows[0], rows[2], 'below'), 'the bottom row should accept the drop and show where it lands');
        await edited(rev);
        assert(JSON.stringify(names()) === JSON.stringify([before[1], before[2], before[0]]), `front layer should move to the back (${names()})`);
        assert(S.layers[0].name === before[0], 'the back of the stack is index 0');
        rows = $$('#layers .layer'); rev = S.revision;
        assert(drag(rows[2], rows[0], 'above'), 'the top row should accept the drop');
        await edited(rev);
        assert(JSON.stringify(names()) === JSON.stringify(before), `and back to the front (${names()})`);
        // ⌥↓ on the selected row moves it one step back.
        rows = $$('#layers .layer'); rev = S.revision;
        const sel = $('#layers .layer.on'), selName = sel.querySelector('.lname').textContent;
        sel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
        await edited(rev);
        assert(S.layers[S.layer].name === selName, 'the moved layer should stay selected');
        rev = S.revision; await call('undo', {}); await edited(rev);
        assert(JSON.stringify(names()) === JSON.stringify(before), 'undo should put the layer back');
      }
      rev = S.revision; $('#layer-merge').click(); await edited(rev);
      assert(S.layers.length === 2, 'not merged');
      rev = S.revision; $('#layer-del').click(); await edited(rev);
      assert(S.layers.length === 1, 'not deleted');
    });
    await test('frames: add, select, duration stepper, onion, play, delete', async () => {
      let rev = S.revision;
      $('#frame-add').click(); await edited(rev);
      assert(S.frames.length === 2 && S.frame === 1, 'frame not added');
      $$('#strip .fr')[0].click();
      await until(() => S.frame === 0 && !refreshing, 'frame 1 to be selected');
      await sleep(80);
      rev = S.revision;
      $('#frames-bar .stepper button[data-step="1"]').click(); await edited(rev);
      assert(S.frames[0].duration_ms === 110, `duration is ${S.frames[0].duration_ms}`);
      $('#onion').click(); await settle();
      assert(S.onionOn && S.onion.length === 1, 'onion skin not on');
      $('#onion').click(); await settle();
      $('#play').click(); await sleep(400);
      assert(S.playing, 'not playing');
      $('#play').click();
      assert(!S.playing, 'did not stop');
      await settle();
      await until(() => $$('#strip .fr .thumb img').every((i) => i.src), 'frame previews');
      rev = S.revision; $('#frame-del').click(); await edited(rev);
      assert(S.frames.length === 1, 'frame not deleted');
    });
    await test('2D zoom buttons and fit', async () => {
      const z = sv.zoom;
      $('#zoom-in').click(); await sleep(250); assert(sv.zoom > z && ZOOMS.includes(sv.zoom), `zoom in (${sv.zoom})`);
      $('#zoom-out').click(); await sleep(250); $('#zoom-out').click(); await sleep(250); assert(sv.zoom < z && ZOOMS.includes(sv.zoom), `zoom out (${sv.zoom})`);
      $('#zoom-fit').click(); assert(sv.zoom === z, 'fit');
    });
    await test('trackpad: two fingers move the canvas, a pinch zooms smoothly around the fingers and settles on even pixels', async () => {
      $('#zoom-fit').click();
      const r = sliceCanvas.getBoundingClientRect();
      const at = { clientX: Math.round(r.left + r.width * 0.3), clientY: Math.round(r.top + r.height * 0.4) }; // events carry whole pixels
      const wheel = (o) => sliceCanvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaMode: 0, ...at, ...o }));
      // Two-finger scroll: the canvas moves with the fingers, the zoom stays.
      const z0 = sv.zoom, x0 = sv.panX, y0 = sv.panY;
      wheel({ deltaX: 12, deltaY: 30 });
      assert(sv.zoom === z0 && sv.panX === x0 - 12 && sv.panY === y0 - 30, `scrolling should pan (zoom ${sv.zoom}, pan ${sv.panX - x0},${sv.panY - y0})`);
      // A pinch (ctrl + wheel): a small continuous step, the cell under the fingers stays where it is.
      const cell = () => [(at.clientX - r.left - sv.panX) / sv.zoom, (at.clientY - r.top - sv.panY) / sv.zoom];
      const before = cell();
      wheel({ ctrlKey: true, deltaY: -5 });
      const step = sv.zoom / z0;
      assert(step > 1.02 && step < 1.1, `one pinch step should zoom a little (×${step.toFixed(3)})`);
      const after = cell();
      const r2 = sliceCanvas.getBoundingClientRect();
      assert(Math.abs(after[0] - before[0]) < 1e-6 && Math.abs(after[1] - before[1]) < 1e-6, `the cell under the fingers moved (${before.map((v) => v.toFixed(4))} → ${after.map((v) => v.toFixed(4))}; canvas ${r.left},${r.top},${r.width} → ${r2.left},${r2.top},${r2.width}; zoom ${z0} → ${sv.zoom})`);
      // Safari's own pinch events: the scale is relative to where the pinch began.
      const gesture = (type, scale) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.assign(e, { scale, ...at }); sliceCanvas.dispatchEvent(e); return e; };
      gesture('gesturestart', 1);
      const zs = sv.zoom;
      const g = gesture('gesturechange', 1.5);
      assert(g.defaultPrevented && Math.abs(sv.zoom / zs - 1.5) < 1e-9, `a pinch to 1.5× should zoom 1.5× (${(sv.zoom / zs).toFixed(3)})`);
      wheel({ ctrlKey: true, deltaY: -5 });
      assert(Math.abs(sv.zoom / zs - 1.5) < 1e-9, 'the wheel copy of a pinch should be ignored while the pinch runs');
      gesture('gestureend', 1.5);
      await sleep(400);
      assert(sv.zoom >= 8 ? ZOOMS.includes(sv.zoom) || sv.zoom % 1 !== 0 : Number.isInteger(sv.zoom), `the zoom should settle (${sv.zoom})`);
      if (sv.zoom < 8) assert(Number.isInteger(sv.zoom), `below 8× every pixel should be whole screen pixels (${sv.zoom})`);
      assert(/^\d+%$/.test($('#zoom-label').textContent), `zoom label ${$('#zoom-label').textContent}`);
      // 3D: two fingers move the camera, a pinch moves it closer.
      setMode('3d'); await sleep(100);
      // The starting view fits the whole model on the canvas, clear of the drawing toolbar.
      {
        resetCamera(); await sleep(60);
        const m = viewProj(), gr = glCanvas.getBoundingClientRect(), tbTop = $('#toolbar').getBoundingClientRect().top;
        for (const [x, y, z] of [[0, 0, 0], [S.sx, 0, 0], [0, S.sy, 0], [0, 0, S.sz], [S.sx, S.sy, 0], [S.sx, 0, S.sz], [0, S.sy, S.sz], [S.sx, S.sy, S.sz]]) {
          const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
          const px = gr.left + (cx / cw + 1) / 2 * gr.width, py = gr.top + (1 - cy / cw) / 2 * gr.height;
          assert(px >= gr.left && px <= gr.right && py >= gr.top && py <= tbTop, `3D: the model's corner ${x},${y},${z} falls outside the view (${Math.round(px)},${Math.round(py)})`);
        }
      }
      const c0 = { ...cam };
      glCanvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 20, deltaY: 0, ...at }));
      assert(cam.dist === c0.dist && cam.yaw === c0.yaw && (cam.tx !== c0.tx || cam.tz !== c0.tz), '3D: scrolling should move the camera, not turn or zoom it');
      glCanvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -10, ...at }));
      assert(cam.dist < c0.dist, '3D: a pinch should zoom in');
      Object.assign(cam, c0); render3dDirty = true;
      setMode('slice'); await sleep(100);
      $('#zoom-fit').click();
    });
    await test('2D grid button hides and shows the lines between pixels (and is remembered)', async () => {
      const dpr = window.devicePixelRatio || 1, rect = sliceCanvas.getBoundingClientRect();
      // Pixels along the line between columns 7 and 8.
      const line = () => {
        const x = Math.round((cellXY(8, 0)[0] - sv.zoom / 2 - rect.left) * dpr);
        const top = Math.round((cellXY(0, 0)[1] - rect.top) * dpr), h = Math.round(S.sy * sv.zoom * dpr * 0.8);
        return Array.from(sctx.getImageData(x, top, 1, h).data).join(',');
      };
      const saved = localStorage.getItem('openpixel.pixelGrid'); // the person's own choice, put back afterwards
      setPixelGrid(true); await sleep(120);
      assert(S.pixelGrid && $('#pixel-grid-btn').classList.contains('on'), 'grid should be on');
      const on = line();
      $('#pixel-grid-btn').click();
      await sleep(120);
      assert(!S.pixelGrid && !$('#pixel-grid-btn').classList.contains('on') && localStorage.getItem('openpixel.pixelGrid') === 'off', 'grid button did not turn off');
      const off = line();
      assert(on !== off, 'the canvas still shows the grid lines');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: "'", bubbles: true }));
      await sleep(120);
      assert(S.pixelGrid && line() === on, "' did not turn the grid back on");
      await snap('05b-grid-on');
      if (saved === 'off') setPixelGrid(false);
    });
    await test('make 3D with the depth stepper', async () => {
      $('#view-sprite .stepper button[data-step="1"]').click();
      $('#view-sprite .stepper button[data-step="1"]').click();
      assert($('#extrude-depth').value === '6', `depth shows ${$('#extrude-depth').value}`);
      const rev = S.revision;
      $('#extrude-btn').click(); await edited(rev);
      await until(() => S.sz === 6 && S.mode === '3d', '3D mode with depth 6');
      await sleep(300);
      await snap('04-3d');
    });
    await test('3D: pencil click adds a voxel, eraser removes it', async () => {
      pick('pencil');
      await sleep(200);
      const g = glCanvas.getBoundingClientRect();
      const before = await count();
      let rev = S.revision;
      ev(glCanvas, 'mousedown', g.left + g.width / 2, g.top + g.height / 2);
      ev(window, 'mouseup', g.left + g.width / 2, g.top + g.height / 2);
      await edited(rev);
      assert(await count() === before + 1, 'no voxel added');
      pick('eraser');
      rev = S.revision;
      ev(glCanvas, 'mousedown', g.left + g.width / 2, g.top + g.height / 2);
      ev(window, 'mouseup', g.left + g.width / 2, g.top + g.height / 2);
      await edited(rev);
      assert(await count() === before, 'voxel not erased');
    });
    await test('3D: orbit with right-drag, ortho camera, edges and bounds toggles', async () => {
      const g = glCanvas.getBoundingClientRect(), yaw = cam.yaw;
      ev(glCanvas, 'mousedown', g.left + 100, g.top + 100, { button: 2 });
      ev(window, 'mousemove', g.left + 180, g.top + 110, { button: 2 });
      ev(window, 'mouseup', g.left + 180, g.top + 110, { button: 2 });
      assert(cam.yaw !== yaw, 'camera did not turn');
      $('[data-proj="ortho"]').click(); assert(S.ortho, 'ortho');
      $('[data-proj="persp"]').click();
      $('#edges-btn').click(); assert(!S.edges, 'edges off'); $('#edges-btn').click();
      $('#grid-btn').click(); assert(!S.grid, 'bounds off'); $('#grid-btn').click();
      $('#reset-cam').click(); assert(cam.yaw === 45, 'reset view');
    });
    await test('slice view of a 3D model: axis and slice stepping', async () => {
      $('[data-mode="slice"]').click(); await sleep(100);
      assert(!$('#view-slice').hidden, 'slice controls hidden');
      $('[data-axis="y"]').click();
      assert(S.axis === 'y' && S.slice === 0, 'axis');
      $('#slice-up').click(); assert(S.slice === 1, 'slice up');
      $('#slice-down').click(); assert(S.slice === 0, 'slice down');
      $('[data-axis="z"]').click();
    });
    await test('preview panel buttons', async () => {
      $('[data-pview="front"]').click(); assert(S.previewPitch === 0, 'front');
      $('[data-pview="iso"]').click(); assert(S.previewPitch === 30, 'iso');
      assert(!$('#prev-left'), 'the turn button is gone (Front / Iso only)');
      $('[data-pscale="4"]').click(); assert(S.previewScale === 4, 'size');
      await until(() => $('#preview').src.startsWith('data:'), 'a preview picture');
    });
    await test('review dialog', async () => {
      $('#review-btn').click();
      await until(() => $('#review-dialog').classList.contains('open') && $('#review-img').naturalWidth > 0, 'the review picture');
      await snap('05-review');
    });
    await test('Agents page: table of 7 agents with logos, statuses and info popups', async () => {
      assert(!$('#agent-btn'), 'the editor should have no Agents button');
      await goHome('agents');
      await until(() => S.home && home.view === 'agents' && $$('#agents-body .agent-row').length >= 16, 'the Agents page');
      assert(!$('.agents-intro') && !$('#agent-cmd'), 'the intro box should be gone (each row has its own steps)');
      assert(!$('.agents-foot') && !$('.agent-list .c-act') && !$('table.agents'), 'no footnote, no Activity column, no table');
      assert($('.agent-list .fl-head') && $('#agents-body .agent-row').getBoundingClientRect().height === 44, 'rows should match the files list (44px under a header)');
      // The header's text (inside its 6px padding, like the file list's) starts where the status badges start.
      const headEl = $$('.agent-list .fl-head > *')[1], statusPill = $('#agents-body .agent-row .c-status .pill').getBoundingClientRect();
      const headText = headEl.getBoundingClientRect().left + parseFloat(getComputedStyle(headEl).paddingLeft);
      assert(Math.abs(headText - statusPill.left) < 1, `the Status header should line up with the statuses (${Math.round(headText)} vs ${Math.round(statusPill.left)})`);
      // The page refreshes its statuses every 2.5 s: the rows stay the same elements and the scroll stays put.
      {
        const main = $('.home-main'), wrap = $('#home-agents-wrap');
        wrap.style.paddingBottom = '1200px'; // room to scroll, whatever the window's height
        main.scrollTop = 600;
        const first = $('#agents-body .agent-row'), top = main.scrollTop;
        assert(top > 0, 'the Agents page should scroll');
        await sleep(2800);
        await loadAgents();
        assert(main.scrollTop === top, `the scroll jumped from ${top} to ${main.scrollTop} when the statuses refreshed (scrollHeight ${main.scrollHeight}, client ${main.clientHeight}, padding ${wrap.style.paddingBottom}, wrap hidden ${wrap.hidden}, view ${home.view}, home ${S.home}, ui ${ui.view}, rows ${$$('#agents-body .agent-row').length})`);
        assert($('#agents-body .agent-row') === first, 'the rows should be kept, not rebuilt');
        wrap.style.paddingBottom = ''; main.scrollTop = 0;
      }
      // Any other MCP app: its own row whose steps give the command.
      $('#agents-body .agent-row[data-agent="other-mcp"] .info-btn').click();
      assert($('#agent-info').classList.contains('open') && $$('#ai-body .codebox pre').some((p) => p.textContent.includes('--mcp')), 'Other MCP app steps should give the command');
      assert(/starts OpenPixel by itself/.test($('#ai-body').textContent), 'the steps should say it starts by itself');
      closeModals();
      for (const id of ['chatgpt', 'codex', 'claude', 'claude-code', 'cursor', 'openclaw', 'hermes',
        'copilot', 'windsurf', 'gemini-cli', 'cline', 'kiro', 'opencode', 'goose', 'lm-studio']) {
        const row = $(`#agents-body .agent-row[data-agent="${id}"]`);
        assert(row, `${id} row missing`);
        assert(row.querySelector('.pill').textContent.trim(), `${id} has no status`);
        const logo = row.querySelector('.alogo svg');
        assert(logo && logo.getBoundingClientRect().width >= 16 && logo.querySelector('path'), `${id} logo missing`);
        row.querySelector('.info-btn').click();
        assert($('#agent-info').classList.contains('open'), `${id} info popup did not open`);
        assert($$('#ai-body ol.steps li').length >= 2, `${id} has no steps`);
        // Every guide but ChatGPT's starts with a prompt the agent can follow to add OpenPixel itself.
        const pr = $('#ai-body .setup-prompt pre');
        if (id === 'chatgpt') assert(!pr, 'ChatGPT cannot set itself up; no prompt');
        else assert(pr && pr.textContent.includes('--mcp') && pr.textContent.includes('openpixel') && $('#ai-body .setup-prompt .copy'), `${id}: no setup prompt with the command and a Copy button`);
        if (id === 'cursor') assert($('#ai-extra').textContent.includes('Add to Cursor'), 'no Add to Cursor button');
        if (id === 'claude-code') {
          // Copy answers in the button: "Copy" swaps to "Copied" without changing the button's width, then back.
          const c = $('#ai-body .codebox .copy');
          assert(c, 'no copy button in the steps');
          const real = nativeAction;
          nativeAction = async () => true; // keep the person's clipboard untouched
          try {
            const w = c.getBoundingClientRect().width;
            c.click();
            const [idle, done] = c.children;
            assert(idle.classList.contains('out') && !done.classList.contains('out') && done.textContent.includes('Copied'), 'copy button did not show Copied');
            assert(Math.abs(c.getBoundingClientRect().width - w) < 1, 'copy button changed width');
            await sleep(260);
            const cs = getComputedStyle(done);
            assert(cs.opacity === '1' && !/blur\((?!0)/.test(cs.filter), `"Copied" did not settle sharp (opacity ${cs.opacity}, filter ${cs.filter})`);
            await snap('14-agent-info');
            await until(() => !idle.classList.contains('out'), 'the copy button to turn back', 3000);
          } finally { nativeAction = real; }
        }
        closeModals();
      }
      noSpill($('.home-main'), 'Agents page');
      await snap('15-agents');
    });
    await test('Agents page: an agent that has connected but made no call yet shows as Connected', async () => {
      await goHome('agents');
      await until(() => S.home && home.view === 'agents', 'the Agents page');
      await post({ kind: 'spawnAgent', client: 'claude-code', call: false });
      await until(async () => { await loadAgents(); return $('#agents-body .agent-row[data-agent="claude-code"] .pill').classList.contains('live'); }, 'Claude Code to show as connected and live without a call', 8000);
      assert($('#agents-body .agent-row[data-agent="claude-code"] .pill').dataset.activity.includes('no calls yet'), 'should say no calls yet');
      await post({ kind: 'stopAgents' });
      await until(async () => { await loadAgents(); return !$('#agents-body .agent-row[data-agent="claude-code"] .pill').classList.contains('live'); }, 'the connection to close', 8000);
    });
    await test('Agents page: a real agent connection shows as Connected, then as last connected', async () => {
      await post({ kind: 'spawnAgent', client: 'claude-code' });
      await loadAgents();
      await until(async () => { await loadAgents(); return $('#agents-body .agent-row[data-agent="claude-code"] .pill').classList.contains('live'); }, 'Claude Code to show as connected and live', 8000);
      assert($('#agents-body .agent-row[data-agent="claude-code"] .pill').dataset.activity.includes('1 call'), 'call not counted');
      await post({ kind: 'spawnAgent', client: 'my-custom-agent' });
      await until(async () => { await loadAgents(); return $$('#agents-body .agent-row[data-agent="other"]').length === 1; }, 'the unknown agent row', 8000);
      await snap('16-agents-connected');
      await post({ kind: 'stopAgents' });
      await until(async () => { await loadAgents(); return !$('#agents-body .agent-row[data-agent="claude-code"] .pill').classList.contains('live'); }, 'the connection to close', 8000);
      const after = $('#agents-body .agent-row[data-agent="claude-code"] .pill').dataset.activity;
      assert(['Last used', 'Not used yet', 'not set up', 'Not installed'].some((t) => after.includes(t)), `activity after closing: ${after}`);
      // Only two statuses, and no settings-file paths in the activity column.
      for (const tr of $$('#agents-body .agent-row')) {
        const label = tr.querySelector('.pill').textContent.trim();
        assert(['Connected', 'Disconnected', 'Not found'].includes(label) || label.startsWith('Connected ×') || (tr.dataset.agent === 'other-mcp' && label === 'Any app'), `unexpected status "${label}"`);
        assert(!tr.querySelector('.asub'), 'agent description should be gone');
        const act = tr.querySelector('.pill').dataset.activity || '';
        assert(!act.includes('.json') && !act.includes('.toml') && !act.includes('Library'), `path in activity: ${act}`);
      }
      await backToEditor();
    });
    await test('update button: hidden when up to date; when an update is found, one round button before the GitHub stars on every page', async () => {
      const real = await nativeAction('version'); // restore whatever the real check found afterwards
      const b = $('#tab-update'), stars = $('#tab-stars');
      try {
        PC.updateAvailable(null);
        assert(b.hidden, 'the update button shows while up to date');
        assert(!$('.update-slot') && !$('.update-btn'), 'no update buttons in the sidebars any more');
        PC.updateAvailable('99.0.0');
        const check = (where) => {
          const r = b.getBoundingClientRect(), s = stars.getBoundingClientRect();
          assert(!b.hidden && r.width > 20, `${where}: update button not shown`);
          assert(Math.abs(r.width - r.height) < 0.5 && Math.abs(r.height - s.height) < 0.5, `${where}: should be a circle as tall as the stars (${r.width}×${r.height}, stars ${s.height})`);
          assert(getComputedStyle(b).borderTopLeftRadius === '999px' && getComputedStyle(stars).borderTopLeftRadius === '999px', `${where}: should be fully round like the stars`);
          assert(r.right <= s.left && s.left - r.right <= 8 && Math.abs((r.top + r.bottom) / 2 - (s.top + s.bottom) / 2) < 0.5, `${where}: should sit just before the stars (update ${r.left.toFixed(1)}–${r.right.toFixed(1)} at ${((r.top + r.bottom) / 2).toFixed(1)}, stars ${s.left.toFixed(1)}–${s.right.toFixed(1)} at ${((s.top + s.bottom) / 2).toFixed(1)})`);
          assert(b.querySelector('svg.i') && !b.textContent.trim() && b.querySelector('.tb-dot'), `${where}: download icon and an accent dot, no text`);
          assert(getComputedStyle(b.querySelector('.tb-dot')).backgroundColor !== 'rgba(0, 0, 0, 0)', `${where}: the dot has no colour`);
          assert(b.dataset.tip.includes('99.0.0') && b.getAttribute('aria-label').includes('99.0.0'), `${where}: the tooltip and name should give the version`);
        };
        check('editor');
        await PC.showHome(); await sleep(200);
        check('home');
        await snap('24-update-button');
        await backToEditor();
      } finally {
        PC.updateAvailable(real && real.available ? real.available : null);
      }
    });
    await test('file and export menus open and can be seen (own menus, SVG and HTML listed)', async () => {
      const visible = (list) => {
        const r = list.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 14));
        return hit && list.contains(hit);
      };
      $('[data-menu="file-menu"]').click();
      assert($('#file-menu').classList.contains('open'), 'file menu');
      assert(visible($('#file-menu .menu-list')), 'file menu is open but cannot be seen');
      await snap('06a-file-menu');
      assert(!$('[data-action="sample2d"], [data-action="sample3d"]'), 'the sample items should be gone from the File menu');
      document.body.click();
      $('[data-menu="export-menu"]').click();
      assert($('#export-menu').classList.contains('open'), 'export menu');
      assert($('[data-export="svg"]') && $('[data-export="html"]'), 'SVG/HTML missing');
      assert(visible($('#export-menu .menu-list')), 'export menu is open but cannot be seen');
      await sleep(200); // let the opening animation finish before the picture
      await snap('06-export-menu');
    });
    await test('editor sidebar: a rail (app menu, Layers, Activity), the panel it fills, named like Figma, and it hides', async () => {
      const saved = localStorage.getItem('openpixel.leftSide');
      const shown = (el) => el && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
      try {
        leftSide.pane = 'layers'; setLeftOpen(true); await sleep(60);
        assert($('#rail .rail-app svg.i .px') && $('#rail [data-menu="file-menu"]'), 'the app icon (2D file mark) in the rail opens the file menu');
        // A frosted column the sidebar's full height, in the selected tab's fill; open icon in the accent, no box.
        {
          const rr = $('#rail').getBoundingClientRect(), lr = $('#left').getBoundingClientRect();
          // Floating like the selected tab: the tab's fill, rounded, inset 8px from the window's left and bottom.
          const tabOn = $('#tabs .tab.on');
          assert(tabOn && getComputedStyle($('#rail')).backgroundColor === getComputedStyle(tabOn).backgroundColor, 'the rail should have the selected tab\'s fill');
          assert(Math.abs(rr.left - 8) < 0.5 && Math.abs(window.innerHeight - rr.bottom - 8) < 0.5 && Math.abs(rr.top - lr.top - 4) < 0.5 && lr.left - rr.right >= 3.5,
            `the rail should float: 8px from the left and bottom, 4px from the top and the panel (${rr.left}, ${window.innerHeight - rr.bottom}, ${rr.top - lr.top}, ${lr.left - rr.right})`);
          assert(parseFloat(getComputedStyle($('#rail')).borderTopLeftRadius) === 12, 'the rail should have round corners');
          // Its buttons' touch areas fill its width, with no inset.
          for (const b of $$('#rail .rail-app, #rail .rail-btn')) {
            const q = b.getBoundingClientRect(), hl = (b.querySelector('.ri') || b).getBoundingClientRect();
            assert(Math.abs(q.left - rr.left) < 0.5 && Math.abs(rr.right - q.right) < 0.5 && Math.abs(hl.width - rr.width) < 0.5,
              `rail buttons should fill the rail's width (${q.left - rr.left}, ${rr.right - q.right}, highlight ${hl.width} of ${rr.width})`);
          }
          const on = $('#rail .rail-btn.on .ri'), accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
          const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
          assert(getComputedStyle(on).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(on).color === rgb(accent), `the open rail icon should be the accent with no box (${getComputedStyle(on).color}, ${getComputedStyle(on).backgroundColor})`);
          const sizes = $$('#rail .rail-app svg.i, #rail .rail-btn svg.i').map((i) => i.getBoundingClientRect().width);
          assert(sizes.every((w) => Math.abs(w - 16) < 0.5), `rail icons should all be 16px like the sidebar's (${sizes.join(', ')})`);
        }
        assert(!$('#rail .rl') && $$('#rail [data-pane]').every((b) => !b.textContent.trim() && b.dataset.tip && b.getAttribute('aria-label') === b.dataset.tip),
          'rail buttons show only their icon; the name is a tooltip and the accessible name');
        assert(!$('#top [data-menu="file-menu"]') && !$('#top #doc-name'), 'the file menu and name left the top bar');
        assert(shown($('#left [data-pane="layers"]')) && !shown($('#left [data-pane="activity"]')) && $('#rail [data-pane="layers"]').classList.contains('on'), 'Layers should show');
        assert($('#doc-name').textContent === activeTabName() && !$('#doc-kind'), `the panel names the file and nothing else (${$('#doc-name').textContent})`);
        assert($('#doc-title').matches('button') && !$('#doc-title').contains($('#doc-name')), 'the chevron is its own button, apart from the name');
        // One line across the top: app icon, name, chevron and collapse share the top bar's middle; the name starts
        // where the Layers heading does.
        {
          const mid = (el) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
          const textLeft = (el) => { const rg = document.createRange(); rg.selectNodeContents(el.firstChild && el.firstChild.nodeType === 3 ? el : el); const rr = [...rg.getClientRects()].filter((q) => q.width)[0]; return rr ? rr.left : el.getBoundingClientRect().left; };
          const bar = mid($('#mode-seg'));
          const parts = { 'app icon': $('#rail .rail-app'), name: $('#doc-name'), chevron: $('#doc-title'), collapse: $('#left-collapse') };
          for (const [k, el] of Object.entries(parts)) assert(Math.abs(mid(el) - bar) < 0.75, `${k} is ${(mid(el) - bar).toFixed(1)}px off the top bar's middle`);
          const nameX = textLeft($('#doc-name')), headX = textLeft($('#left [data-pane="layers"] .sec-head'));
          assert(Math.abs(nameX - headX) < 0.75, `the file name starts at ${nameX.toFixed(1)}, the Layers heading at ${headX.toFixed(1)}`);
          const del = $('#layer-del').getBoundingClientRect(), delIcon = $('#layer-del svg').getBoundingClientRect();
          for (const id of ['#doc-title', '#left-collapse']) {
            const b = $(id).getBoundingClientRect(), ic = $(`${id} svg`).getBoundingClientRect();
            assert(Math.abs(b.width - del.width) < 0.5 && Math.abs(b.height - del.height) < 0.5 && Math.abs(ic.width - delIcon.width) < 0.5,
              `${id} is ${b.width}×${b.height} with a ${ic.width}px icon; the Layers buttons are ${del.width}×${del.height} with ${delIcon.width}px`);
          }
          assert(Math.abs($('#left-collapse').getBoundingClientRect().right - del.right) < 0.75, 'the collapse button should sit right above Delete');
          const lb = $('#rail [data-pane="layers"] svg.i').getBoundingClientRect(), lh = $('#left [data-pane="layers"] .sec-head').getBoundingClientRect();
          assert(Math.abs((lb.top + lb.bottom) / 2 - (lh.top + lh.bottom) / 2) < 0.75, `the Layers rail icon should line up with the Layers heading (${((lb.top + lb.bottom) / 2).toFixed(1)} vs ${((lh.top + lh.bottom) / 2).toFixed(1)})`);
          const sep = $('#rail .rail-sep').getBoundingClientRect(), stageTop = $('#stage').getBoundingClientRect().top;
          assert(Math.abs(sep.top - stageTop) < 0.75, `the rail's divider is at ${sep.top.toFixed(1)}, the canvas's top edge at ${stageTop.toFixed(1)}`);
        }
        // Double-click the name to rename the file (on disk, in its tab), Escape to leave it.
        {
          const before = activeTabName(), tabId = ui.active;
          $('#doc-name').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
          let field = $('#doc-name input.rename');
          assert(field && document.activeElement === field && field.value === before, 'double-clicking the name should open a field with the name');
          field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          assert(!$('#doc-name input.rename') && $('#doc-name').textContent === before, 'Escape should keep the name');
          $('#doc-name').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
          field = $('#doc-name input.rename'); field.value = 'Renamed sprite';
          field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          await until(async () => { const t = (await nativeAction('tabs')).tabs.find((x) => x.id === tabId); return t && t.name === 'Renamed sprite' && t.path.endsWith('/Renamed sprite.openpixel'); }, 'the file renamed on disk');
          await until(() => $('#doc-name').textContent === 'Renamed sprite' && $(`#tabs .tab[data-tab="${tabId}"] .name`).textContent === 'Renamed sprite', 'the new name in the panel and the tab');
          // The tab's name renames the same way: back to what it was.
          const nm = $(`#tabs .tab[data-tab="${tabId}"] .name`);
          nm.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
          field = nm.querySelector('input.rename');
          assert(field && field.value === 'Renamed sprite', 'double-clicking a tab should rename it');
          field.value = before; field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          await until(async () => { const t = (await nativeAction('tabs')).tabs.find((x) => x.id === tabId); return t && t.name === before; }, 'the tab renamed back');
          await until(() => $('#doc-name').textContent === before, 'the panel shows the name again');
        }
        const rail = $('#rail').getBoundingClientRect(), left = $('#left').getBoundingClientRect(), tabs = $('#tabbar').getBoundingClientRect();
        assert(Math.abs(left.left - rail.right - 4) < 1 && Math.abs(left.top - tabs.bottom) < 2, 'the panel sits 4px from the floating rail, from the top of the editor');
        // Activity fills the whole panel.
        $('#rail [data-pane="activity"]').click(); await sleep(60);
        const act = $('#activity-sec').getBoundingClientRect(), head = $('#left .doc-head').getBoundingClientRect();
        assert(shown($('#activity-sec')) && !shown($('#left [data-pane="layers"]')) && $('#rail [data-pane="activity"]').getAttribute('aria-pressed') === 'true', 'Activity should replace Layers');
        assert(act.top >= head.bottom - 1 && act.bottom >= left.bottom - 2, 'Activity should fill the panel below the file name');
        // Picking the open one hides the panel: the canvas takes the room, the rail stays.
        const stageW = $('#stage').getBoundingClientRect().width;
        $('#rail [data-pane="activity"]').click(); await sleep(60);
        assert($('#app').classList.contains('left-closed') && !shown($('#left')) && shown($('#rail')), 'picking the open pane again should hide the panel');
        assert($('#stage').getBoundingClientRect().width > stageW + left.width - 2, 'the canvas should take the panel\'s room');
        assert(!$$('#rail [data-pane]').some((b) => b.classList.contains('on')), 'no rail button looks open while the panel is hidden');
        await snap('09b-left-hidden');
        $('#rail [data-pane="layers"]').click(); await sleep(60);
        assert(!$('#app').classList.contains('left-closed') && shown($('#left [data-pane="layers"]')), 'a rail button brings the panel back');
        // The collapse button and View > Show or Hide Sidebar (⌘\\).
        $('#left-collapse').click(); await sleep(60);
        assert($('#app').classList.contains('left-closed') && $('#left-collapse').getAttribute('aria-expanded') === 'false', 'the collapse button should hide the panel');
        assert(JSON.parse(localStorage.getItem('openpixel.leftSide')).open === false, 'hidden should be remembered');
        PC.command('sidebar'); await sleep(60);
        assert(!$('#app').classList.contains('left-closed'), '⌘\\ should show the panel again');
        // The chevron beside the name opens the file's own menu.
        $('#doc-title').click(); await sleep(200);
        const dm = $('#doc-menu');
        assert(dm.classList.contains('open') && ['saveAs', 'close'].every((k) => shown(dm.querySelector(`[data-doc="${k}"]`))), 'the file name opens its menu');
        await snap('09c-doc-menu');
        closeMenus();
      } finally {
        try { if (saved === null) localStorage.removeItem('openpixel.leftSide'); else localStorage.setItem('openpixel.leftSide', saved); } catch (e) { /* ignore */ }
        leftSide.pane = 'layers'; leftSide.open = true; applyLeftSide();
      }
    });
    await test('popups grow from what opened them; from the keyboard they appear at once and arrow keys move through items', async () => {
      const press = (el) => { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el.click(); };
      const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      // Pointer: the menu animates, growing from the point of the menu under the middle of its button.
      const b = $('[data-menu="export-menu"]'), list = $('#export-menu .menu-list');
      closeMenus();
      press(b);
      assert(list.getAnimations().length === 1, 'the export menu did not animate when clicked');
      await sleep(200); // measure the menu at its full size
      const [ox, oy] = list.style.transformOrigin.split(' ').map(parseFloat);
      const lr = list.getBoundingClientRect(), br = b.getBoundingClientRect();
      assert(oy === 0 && Math.abs(lr.left + ox - (br.left + br.width / 2)) < 2, `origin ${list.style.transformOrigin} is not under the button`);
      closeMenus();
      // The dropdown in the right panel too.
      const dd = $('#preset .dd-btn'), ddl = $('#preset .dd-list');
      press(dd);
      const ddAnimated = ddl.getAnimations().length === 1;
      await sleep(200);
      const [, dy] = ddl.style.transformOrigin.split(' ').map(parseFloat);
      const flipped = ddl.getBoundingClientRect().top < dd.getBoundingClientRect().top;
      const edge = flipped ? ddl.getBoundingClientRect().height : 0; // grows down from its top, or up from its bottom when flipped
      assert(ddAnimated && Math.abs(dy - edge) < 1, `dropdown origin ${ddl.style.transformOrigin} (flipped: ${flipped}, animated: ${ddAnimated})`);
      assert(underItsButton($('#preset')), `the palette preset list should open by its button (${underItsButton.last})`);
      closeMenus();
      // Keyboard: no animation, the first item is highlighted, arrows move, Escape closes and returns focus.
      key('Shift'); key('ArrowLeft'); // a key press (not a modifier) marks keyboard use
      b.focus(); b.click();
      assert(list.getAnimations().length === 0, 'a keyboard-opened menu should not animate');
      const items = [...list.children].filter((d) => d.tagName === 'DIV' && d.offsetParent !== null);
      assert(items[0].classList.contains('kb'), 'first item not highlighted');
      key('ArrowDown');
      assert(items[1].classList.contains('kb') && !items[0].classList.contains('kb'), 'ArrowDown did not move');
      key('End');
      assert(items[items.length - 1].classList.contains('kb'), 'End did not go to the last item');
      key('Escape');
      assert(!$('#export-menu').classList.contains('open') && document.activeElement === b, 'Escape should close and focus the button');
      // Dialogs grow from the centre.
      press($('#review-btn'));
      await until(() => $('#review-dialog').classList.contains('open'), 'the review dialog');
      assert($('#review-dialog .modal').style.transformOrigin.replace(/ 50%$/, '') === '50%', 'dialog should grow from the centre, not ' + $('#review-dialog .modal').style.transformOrigin);
      await sleep(220);
      await snap('06b-review-dialog');
    });
    await test('every export writes a file', async () => {
      for (const [t, ext] of [['export_png', 'png'], ['export_svg', 'svg'], ['export_html', 'html'], ['export_gif', 'gif'],
        ['export_sheet', 'png'], ['export_vox', 'vox'], ['export_obj', 'obj']]) {
        const r = await call(t, { path: `${CFG.folder}/exports/${t}.${ext}` });
        assert(r.saved, `${t} did not save`);
      }
    });
    await test('saving adds the file to the home screen with a preview, and it opens again', async () => {
      await call('save_model', { path: `${CFG.folder}/My Robot.openpixel` });
      await goHome();
      await until(() => homeCard('My Robot'), 'the saved file on the home screen');
      const c = homeCard('My Robot');
      assert(c.querySelector('.pv img'), 'no preview');
      assert(c.title.endsWith('/My Robot.openpixel') && !c.querySelector('.loc'), 'the card keeps where the file is for its tooltip, not as a line');
      await snap('07-home-recents');
      $('#home-search').value = 'zzz'; $('#home-search').dispatchEvent(new Event('input'));
      assert(!$$('#home-files .card').length, 'search did not filter');
      const art = $('#home-files .empty-state .pxa-search');
      assert(art && /search\.png/.test(getComputedStyle(art).backgroundImage) && getComputedStyle(art).animationName === 'pxa-play',
        'no results should show the animated search buddy');
      assert(art.getAttribute('aria-hidden') === 'true' && /Nothing matches/.test($('#home-files .empty-state').textContent), 'the picture is decoration; the text explains');
      await sleep(150); await snap('22-empty-search');
      $('#home-search').value = 'robot'; $('#home-search').dispatchEvent(new Event('input'));
      assert($$('#home-files .card').length === 1 && homeCard('My Robot'), 'search did not find the file');
      $('#home-search').value = ''; $('#home-search').dispatchEvent(new Event('input'));
      await call('new_sprite', { width: 8, height: 8 });
      await until(() => !S.home && S.sx === 8, 'leaving home after a new sprite');
      await goHome();
      await until(() => homeCard('My Robot'), 'home again');
      homeCard('My Robot').click();
      await until(() => !S.home && S.sz === 6, 'the saved model reopened');
      assert($$('#tabs .tab.file').length === 2, `reopening should add a tab (have ${$$('#tabs .tab.file').length})`);
    });
    await test('home: sample cards open the samples in a new tab', async () => {
      await goHome();
      $('#home-files .card[data-sample="sample3d"]').click();
      await until(() => !S.home && S.sx === 24 && S.sz === 24, 'the 3D sample');
      assert($$('#tabs .tab.file').length === 3, 'the sample did not get its own tab');
      await snap('07b-tabs');
    });
    await test('tabs: switching keeps each file, unsaved changes show a dot, closing goes to the neighbour', async () => {
      const tabs = () => $$('#tabs .tab.file');
      const first = tabs()[0];
      first.click();
      await until(() => S.sx === 8 && S.sz === 1 && !S.home, 'the first tab (the 8×8 sprite)');
      assert(first.classList.contains('on') || $('#tabs .tab.file.on').dataset.tab === first.dataset.tab, 'first tab not active');
      const rev = S.revision;
      await call('set_pixels', { pixels: [[1, 1, 3]] });
      await edited(rev);
      await until(() => $('#tabs .tab.file.on').classList.contains('dirty'), 'the unsaved dot on the tab');
      tabs()[2].click();
      await until(() => S.sx === 24 && S.sz === 24, 'the 3D sample tab');
      assert(S.mode === '3d', 'the 3D sample should open in the 3D view');
      tabs()[0].click();
      await until(() => S.sx === 8 && S.sz === 1, 'back to the sprite');
      assert(S.mode === 'slice', 'the sprite should come back on the 2D canvas');
      assert(await px(1, 1) === 3, 'the sprite lost its edit while another tab was open');
      // Close the middle tab (My Robot, saved): the next one becomes active only if it was the active one.
      const before = tabs().length;
      const mid = tabs()[1];
      mid.querySelector('.x').click();
      await until(() => tabs().length === before - 1, 'the tab to close');
      assert(S.sx === 8 && !S.home, 'closing another tab changed the open file');
    });
    await test('All folders: create nested folders, move a file with Move to…, drag files and folders, breadcrumbs', async () => {
      await goHome('folders');
      assert($('#home-title').textContent.includes('All folders'), 'title');
      // No folders yet: the same large empty state as the other pages, and no files (those are on Recents).
      assert($('#home-folders-sec').hidden && $('#home-files .empty-state:not(.small) .pxa-folder') && !$('#home-files .card'), 'no folders yet should show the folder empty state, like the other pages');
      assert($('#home-count').textContent === '0 folders' && $('#home-filter').hidden, `All folders counts folders only (${$('#home-count').textContent})`);
      await sleep(300); await snap('16b-no-folders');
      // Two folders from the header button, one inside the first.
      $('#home-new-folder').click();
      await until(() => $('#name-dialog').classList.contains('open'), 'the name dialog');
      $('#name-input').value = 'Characters'; $('#name-ok').click();
      await until(() => $$('#home-folders .folder-card').length === 1, 'the Characters folder');
      $('#home-new-folder').click();
      await until(() => $('#name-dialog').classList.contains('open'), 'the name dialog');
      $('#name-input').value = 'Props'; $('#name-ok').click();
      await until(() => $$('#home-folders .folder-card').length === 2, 'the Props folder');
      assert(!$('.home-side .tree-item, #folder-tree'), 'folders should not be listed in the sidebar');
      assert(!$('#home-files .card') && !$('#home-files .empty-state') && $('#home-files-title').hidden, 'All folders should list folders only, not the files outside them');
      // The page you are on: a background, and its text and icon in the foreground colour; the others muted.
      const navOn = $('.home-nav.on'), navOff = $('.home-nav:not(.on)');
      const fg = getComputedStyle(document.body).getPropertyValue('--text').trim();
      const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
      assert(getComputedStyle(navOn).color === rgb(fg), `active sidebar text should be the foreground colour (${getComputedStyle(navOn).color})`);
      assert(getComputedStyle(navOn.querySelector('svg')).color === rgb(fg), 'active sidebar icon should be the foreground colour');
      assert(getComputedStyle(navOff).color !== rgb(fg), 'the other sidebar items should stay muted');
      assert(getComputedStyle(navOn).backgroundColor !== getComputedStyle(navOff).backgroundColor, 'active sidebar item has no background');
      const charId = home.folders.find((f) => f.name === 'Characters').id;
      $(`#home-folders .folder-card[data-folder="${charId}"]`).click();
      await until(() => home.folder === charId, 'inside Characters');
      $('#home-new-folder').click();
      await until(() => $('#name-dialog').classList.contains('open'), 'the name dialog');
      $('#name-input').value = 'Heroes'; $('#name-ok').click();
      await until(() => home.folders.some((f) => f.name === 'Heroes' && f.parent === charId), 'Heroes inside Characters');
      const heroId = home.folders.find((f) => f.name === 'Heroes').id;
      // Move the robot into Heroes through its menu.
      await goHome('recents');
      homeCard('My Robot').querySelector('.more').click();
      $('#card-menu [data-card="move"]').click();
      assert($('#move-menu').classList.contains('open'), 'Move to… menu did not open');
      const opt = $$('#move-menu .opt').find((d) => d.textContent.includes('Heroes'));
      assert(opt, 'Heroes not listed in Move to…');
      await sleep(200); // let the menu finish growing in before the picture
      await snap('17-move-menu');
      opt.click();
      await until(() => (fileById(`${CFG.folder}/My Robot.openpixel`) || {}).folder === heroId, 'the robot in Heroes');
      // Drag the Props folder into Characters (folder cards), but never into itself.
      const propsId = home.folders.find((f) => f.name === 'Props').id;
      await goHome('folders');
      const propsCard = $(`#home-folders .folder-card[data-folder="${propsId}"]`);
      assert(!dnd(propsCard, propsCard), 'a folder accepted itself');
      assert(dnd(propsCard, $(`#home-folders .folder-card[data-folder="${charId}"]`)), 'Characters did not accept the folder');
      await until(() => (folderById(propsId) || {}).parent === charId, 'Props inside Characters');
      // A sample moved into Characters shows there (with its folders, under a Files heading), and drags onto Props.
      await nativeAction('moveItem', { id: 'sample2d', folder: charId });
      await loadHome();
      $(`#home-folders .folder-card[data-folder="${charId}"]`).click();
      await until(() => home.folder === charId && homeCard('Mushroom'), 'the mushroom inside Characters');
      assert(!$('#home-files-title').hidden && $('#home-files-title').textContent === 'Files', 'a folder with folders and files should head its files');
      // Folder cards show the three newest files inside (sub-folders too) and only the name: no count, no date.
      {
        await goHome('folders');
        const card = $(`#home-folders .folder-card[data-folder="${charId}"]`);
        const tiles = card.querySelectorAll('.fprev .ft');
        assert(tiles.length === 3, `a folder card should have three preview tiles (${tiles.length})`);
        assert(card.querySelectorAll('.fprev .ft img').length === Math.min(3, latestInFolder(charId).length) && latestInFolder(charId).length >= 2,
          'the tiles should show the newest files inside, Heroes\' robot and the mushroom included');
        assert(!card.querySelector('.s') && card.querySelector('.fmeta .t').textContent === 'Characters', 'no file count or date on a folder card');
        // The … button ends where the last preview ends, and sits centred on the name row.
        const more = card.querySelector('.more').getBoundingClientRect(), last = tiles[2].getBoundingClientRect();
        const row = card.querySelector('.fmeta').getBoundingClientRect();
        assert(Math.abs(more.right - last.right) < 0.5, `the … button should end with the last preview (${more.right} vs ${last.right})`);
        assert(Math.abs((more.top + more.bottom) / 2 - (row.top + row.bottom) / 2) < 0.5, `the … button should be centred on the name row (${(more.top + more.bottom) / 2} vs ${(row.top + row.bottom) / 2})`);
        await snap('17b-folder-cards');
        $(`#home-folders .folder-card[data-folder="${charId}"]`).click();
        await until(() => home.folder === charId, 'back inside Characters');
      }
      assert(dnd(homeCard('Mushroom'), $(`#home-folders .folder-card[data-folder="${propsId}"]`)), 'Props did not accept the drop');
      await until(() => (fileById('sample2d') || {}).folder === propsId, 'the mushroom in Props');
      assert(!$('#home-files .empty-state'), 'a folder that still has folders is not empty');
      // Open Heroes through Characters: breadcrumbs show the path and lead back.
      $(`#home-folders .folder-card[data-folder="${heroId}"]`).click();
      await until(() => home.folder === heroId && homeCard('My Robot'), 'Heroes with the robot');
      const crumbs = $('#home-title').textContent;
      assert(crumbs.includes('All folders') && crumbs.includes('Characters') && crumbs.includes('Heroes'), `breadcrumbs: ${crumbs}`);
      noSpill($('.home-main'), 'folder page');
      await snap('18-folder');
      // Double-clicking a file's name renames it in place (the file on disk too), without opening it.
      {
        const robot = () => home.files.find((f) => f.name.startsWith('My Robot'));
        const card = homeCard('My Robot'), t = card.querySelector('.t');
        t.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        let field = t.querySelector('input.rename');
        assert(field && field.value === 'My Robot', 'double-clicking a file name should open a field');
        field.value = 'My Robot Two'; field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await until(() => (robot() || {}).name === 'My Robot Two' && robot().path.endsWith('/My Robot Two.openpixel') && robot().folder === heroId, 'the robot renamed (and still in Heroes)');
        assert(S.home, 'renaming should not open the file');
        await snap('18b-renamed');
        const two = homeCard('My Robot Two');
        two.querySelector('.more').click();
        assert(!$('#card-menu [data-card="rename"]').hidden, 'files offer Rename in their menu');
        $('#card-menu [data-card="rename"]').click();
        field = two.querySelector('.t input.rename');
        assert(field, 'Rename in the menu should start renaming in place');
        field.value = 'My Robot'; field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await until(() => (robot() || {}).name === 'My Robot' && robot().path.endsWith('/My Robot.openpixel'), 'the robot named back');
        // Folders: the same on their cards.
        $$('#home-title .crumb').find((b) => b.textContent === 'Characters').click();
        await until(() => home.folder === charId, 'inside Characters');
        const fname = $(`#home-folders .folder-card[data-folder="${heroId}"] .fmeta .t`);
        fname.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        field = fname.querySelector('input.rename');
        assert(field && field.value === 'Heroes', 'double-clicking a folder name should open a field');
        field.value = 'Heroines'; field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await until(() => (folderById(heroId) || {}).name === 'Heroines', 'the folder renamed');
        assert(home.folder === charId, 'renaming a folder should not open it');
        const fname2 = $(`#home-folders .folder-card[data-folder="${heroId}"] .fmeta .t`);
        fname2.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        field = fname2.querySelector('input.rename'); field.value = 'Heroes';
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await until(() => (folderById(heroId) || {}).name === 'Heroes', 'the folder named back');
        $(`#home-folders .folder-card[data-folder="${heroId}"]`).click();
        await until(() => home.folder === heroId, 'back in Heroes');
      }
      $$('#home-title .crumb').find((b) => b.textContent === 'Characters').click();
      await until(() => home.folder === charId && $$('#home-folders .folder-card').length === 2, 'Characters with Heroes and Props');
    });
    await test('Archive: archive by menu and by dragging onto Archive, restore, delete a sample forever', async () => {
      await goHome('archive');
      assert($('#home-files .empty-state .pxa-archive'), 'an empty Archive should show the archive box');
      await sleep(150); await snap('23-empty-archive');
      await goHome('recents');
      homeCard('Island').querySelector('.more').click();
      $('#card-menu [data-card="archive"]').click();
      await until(() => (fileById('sample3d') || {}).archived, 'the island archived');
      assert(!homeCard('Island'), 'archived file still in Recents');
      assert(dnd(homeCard('Mushroom'), $('.home-nav[data-home="archive"]')), 'Archive did not accept the drop');
      await until(() => (fileById('sample2d') || {}).archived, 'the mushroom archived');
      assert(!$('#archive-count') && !$('.home-nav[data-home="archive"] .count'), 'the sidebar should show no archive count');
      // The sidebar search is global: from the Archive page it finds files that aren't archived, and archived ones
      // show where they are.
      await goHome('archive');
      $('#home-search').value = 'robot'; $('#home-search').dispatchEvent(new Event('input'));
      assert(homeCard('My Robot'), 'search from the Archive should find a file that is not archived');
      $('#home-search').value = 'island'; $('#home-search').dispatchEvent(new Event('input'));
      assert(homeCard('Island') && homeCard('Island').textContent.includes('In the Archive'), 'an archived file found by search should say so');
      assert(!$('#home-files .card .loc') && $$('#home-files .card:not(.folder-card) .meta > div').every((d, i, all) => d.parentNode.children.length === 2), 'grid cards show the name and one line, no location');
      $('#home-search').value = 'heroes'; $('#home-search').dispatchEvent(new Event('input'));
      assert($$('#home-folders .folder-card').some((c) => c.textContent.includes('Heroes')), 'search from the Archive should find folders too');
      $('#home-search').value = ''; $('#home-search').dispatchEvent(new Event('input'));
      await goHome('archive');
      assert(homeCard('Island') && homeCard('Mushroom') && !$('#archive-note'), 'archive page (no information box)');
      assert(!$('#home-empty-archive').hidden, 'no Delete all permanently button');
      await snap('19-archive');
      homeCard('Mushroom').querySelector('.more').click();
      assert(!$('#card-menu [data-card="delete"]').hidden && !$('#card-menu [data-card="restore"]').hidden, 'archive menu items');
      $('#card-menu [data-card="restore"]').click();
      await until(() => !(fileById('sample2d') || {}).archived, 'the mushroom restored');
      // Files outside the Archive can be deleted permanently from their menu too, after the same confirmation.
      await goHome('recents');
      homeCard('Mushroom').querySelector('.more').click();
      const del = $('#card-menu [data-card="delete"]');
      assert(!del.hidden && del.textContent.trim() === 'Delete permanently' && del.classList.contains('danger'), 'Recents menu should offer Delete permanently');
      const menuItems = $$('#card-menu > div:not([hidden])');
      assert(menuItems[menuItems.length - 1] === del, 'Delete permanently should be the last item');
      del.click();
      await until(() => $('#confirm-dialog').classList.contains('open'), 'the confirmation');
      assert(/permanently\?$/.test($('#confirm-title').textContent) && $('#confirm-ok').textContent.trim() === 'Delete permanently', `confirmation wording: ${$('#confirm-title').textContent}`);
      $('#confirm-dialog [data-close]').click(); // cancel keeps it
      await sleep(150);
      assert(fileById('sample2d') && homeCard('Mushroom'), 'cancel deleted the mushroom');
      await goHome('archive');
      homeCard('Island').querySelector('.more').click();
      $('#card-menu [data-card="delete"]').click();
      await until(() => $('#confirm-dialog').classList.contains('open'), 'the confirmation');
      $('#confirm-dialog [data-close]').click(); // cancel keeps it
      await sleep(150);
      assert(fileById('sample3d'), 'cancel deleted it');
      homeCard('Island').querySelector('.more').click();
      $('#card-menu [data-card="delete"]').click();
      await until(() => $('#confirm-dialog').classList.contains('open'), 'the confirmation');
      $('#confirm-ok').click();
      await until(() => !fileById('sample3d'), 'the island deleted forever');
      await goHome('recents');
      assert(!homeCard('Island'), 'deleted sample came back');
      await backToEditor();
    });
    await test('New 3D file with no palette: depth asked, starts with one colour, picked colours are added; Cancel and Escape change nothing', async () => {
      const tabsBefore = $$('#tabs .tab.file').length;
      $('#tab-add').click();
      await until(() => ui.view === 'new', 'the New file page');
      // Cancel leaves everything as it was.
      $('#np-3d').click();
      await until(() => $('#newfile-dialog').classList.contains('open'), 'the New 3D file dialog');
      $('#newfile-dialog [data-close]').click();
      await sleep(100);
      assert(!$('#newfile-dialog').classList.contains('open') && ui.view === 'new' && $$('#tabs .tab.file').length === tabsBefore, 'Cancel should only close the dialog');
      $('#np-3d').click();
      await until(() => $('#newfile-dialog').classList.contains('open'), 'the New 3D file dialog');
      assert($('#newfile-title').textContent === 'New 3D file' && !$('#nf-z').closest('.stepper').hidden, '3D dialog: title and depth');
      $('.nf-presets [data-nf-size="16"]').click();
      assert(['#nf-x', '#nf-y', '#nf-z'].every((x) => $(x).value === '16'), 'the 16 preset sets all three sizes');
      $('#nf-z').value = '8'; $('#nf-z').dispatchEvent(new Event('change'));
      $('#nf-palette .dd-btn').click();
      $('#nf-palette .opt[data-value="none"]').click();
      assert(/one colour/i.test($('#nf-hint').textContent), `hint: ${$('#nf-hint').textContent}`);
      $('#nf-name').value = 'Blank block';
      $('#nf-name').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await until(() => S.sx === 16 && S.sy === 16 && S.sz === 8 && !S.home, 'a 16×16×8 model in the editor');
      await settle();
      assert(S.name === 'Blank block' && S.palette.length === 2, `no palette should start with one colour (have ${S.palette.length - 1})`);
      assert($$('#tabs .tab.file').length === tabsBefore + 1, 'the new file should open in its own tab');
      const r = await call('add_colors', { colors: ['#ff8800'] });
      await settle();
      assert(r.indexes[0] === 2 && S.palette.length === 3, 'a picked colour should be added to the palette');
      // The dialog remembers the last 3D size and palette.
      $('#tab-add').click(); await until(() => ui.view === 'new', 'the New file page');
      $('#np-3d').click(); await until(() => $('#newfile-dialog').classList.contains('open'), 'the dialog again');
      assert($('#nf-z').value === '8' && $('#nf-palette .dd-btn').textContent.includes('No palette'), 'last size and palette not remembered');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(100);
      assert(!$('#newfile-dialog').classList.contains('open'), 'Escape should close the dialog');
      closeNewPage();
      await backToEditor();
    });
    await test('layer rows space their leading icon like the home sidebar rows (inset, icon in, gap to the name)', async () => {
      const spacing = (row, iconSel, labelEl) => {
        const r = row.getBoundingClientRect(), i = row.querySelector(iconSel).getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(labelEl);
        const t = range.getBoundingClientRect(), panel = row.closest('#left, .home-side').getBoundingClientRect();
        return { inset: Math.round(r.left - panel.left), iconIn: Math.round(i.left - r.left), gap: Math.round(t.left - i.right), icon: Math.round(i.width) };
      };
      await goHome('recents');
      const nav = $('.home-nav.on');
      const side = spacing(nav, 'svg.i', [...nav.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()));
      await backToEditor();
      const row = $('#layers .layer');
      const layer = spacing(row, '.lic svg.i', row.querySelector('.lname'));
      assert(JSON.stringify(layer) === JSON.stringify(side), `layer row ${JSON.stringify(layer)} vs sidebar row ${JSON.stringify(side)}`);
    });
    await test('Home: header buttons only where they belong; filter by kind, sort, grid and list (columns sort, keyboard menu)', async () => {
      try {
        await goHome('recents');
        assert(!$('#home-open').hidden && !$('#home-create').hidden && $('#home-new-folder').hidden && $('#home-empty-archive').hidden, 'Recents: Open file and Create new only');
        await goHome('folders');
        assert($('#home-open').hidden && $('#home-create').hidden && !$('#home-new-folder').hidden, 'All folders: New folder only');
        await goHome('agents');
        assert(['#home-open', '#home-create', '#home-new-folder', '#home-empty-archive'].every((x) => $(x).hidden), 'Agents: no header buttons');
        await goHome('recents');
        const tools = $('.home-tools');
        assert(tools && $('#home-filter .dd-btn') && $('#home-sort .dd-btn') && $$('.view-seg button').length === 2, 'filter, sort and view controls');
        // filter
        $('#home-filter .dd-btn').click();
        assert(underItsButton($('#home-filter')), `the Show list should open under its button (${underItsButton.last})`);
        $('#home-filter .opt[data-value="3d"]').click();
        assert($$('#home-files .card').length && $$('#home-files .card').every((c) => c.querySelector('.kind.k3d')), '3D filter shows only 3D files');
        assert(/file/.test($('#home-count').textContent), `count: ${$('#home-count').textContent}`);
        $('#home-filter .dd-btn').click(); $('#home-filter .opt[data-value="all"]').click();
        // sort by name
        $('#home-sort .dd-btn').click(); $('#home-sort .opt[data-value="name"]').click();
        const byNameAsc = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        const names = $$('#home-files .card .t').map((t) => t.textContent);
        assert(names.join('|') === [...names].sort(byNameAsc).join('|'), `name order: ${names.join(', ')}`);
        // list view with columns; the Name header flips the order
        $('.view-seg [data-layout="list"]').click();
        assert($('.view-seg [data-layout="list"]').getAttribute('aria-checked') === 'true', 'list not marked as chosen');
        const heads = $$('#home-files .fl-head .fl-col').map((b) => b.textContent.trim());
        assert(heads.join('|') === 'Name|Last modified|Size|Location', `columns: ${heads.join(', ')}`);
        const rowNames = () => $$('#home-files .fl-item .nm').map((t) => t.textContent);
        assert(rowNames().join('|') === names.join('|'), 'list shows the same files in the same order');
        $('#home-files .fl-head .c-name').click();
        assert(rowNames().join('|') === [...names].reverse().join('|'), 'Name header did not reverse the order');
        await snap('21-home-list');
        noSpill($('.home-main'), 'list view');
        // keyboard: the menu key opens a row's menu
        const row = $('#home-files .fl-item');
        row.focus();
        row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }));
        assert($('#card-menu').classList.contains('open'), 'the menu key should open the file menu');
        closeMenus();
        // folders come first in the list on All folders
        await goHome('folders');
        assert($('#home-files .file-list .fl-item').classList.contains('folder-row'), 'folders first in the list');
        assert($('#home-folders-sec').hidden, 'no separate folder cards in list view');
      } finally {
        setHomeLayout('grid'); setHomeSort('modified'); filterMenu.set('all'); homePrefs.filter = 'all';
        restoreHomeView();
      }
    });
    await test('New file page: Recents shows the last 10 edited, search looks through all files, Browse all recent opens Recents', async () => {
      // More than 10 saved files, so the list has to stop at 10, newest first.
      const keep = S.revision;
      for (let i = 1; i <= 11; i++) await call('save_model', { path: `${CFG.folder}/recent-${String(i).padStart(2, '0')}.openpixel` });
      await until(() => S.revision >= keep && !refreshing, 'the saves');
      $('#tab-add').click();
      await until(() => ui.view === 'new' && $$('#np-recents .np-row').length === 10, 'ten recent files');
      const names = $$('#np-recents .np-row .t').map((t) => t.textContent);
      assert(names[0] === 'recent-11' && names[9] === 'recent-02', `recents order: ${names.join(', ')}`);
      assert($$('#np-recents .np-row .when').every((w) => w.textContent.trim()), 'a row without its time');
      assert(!$('#np-browse').hidden, 'Browse all recent should show once Recents holds more than 10 files');
      // Search: beyond the 10 recents, samples included.
      const search = $('#np-search');
      search.value = 'recent-01'; search.dispatchEvent(new Event('input'));
      assert($$('#np-recents .np-row').length === 1 && $('#np-recents .np-row .t').textContent === 'recent-01', 'search did not find an older file');
      assert($('#np-browse').hidden, 'Browse all recent should hide while searching');
      search.value = 'mushroom'; search.dispatchEvent(new Event('input'));
      assert($$('#np-recents .np-row').some((r) => r.dataset.id === 'sample2d'), 'search did not find the sample');
      search.value = 'zzz'; search.dispatchEvent(new Event('input'));
      assert(!$$('#np-recents .np-row').length && $('#np-recents .np-empty .pxa-search'), 'no-results message with the search buddy');
      search.value = ''; search.dispatchEvent(new Event('input'));
      await snap('20-new-page-recents');
      $('#np-browse').click();
      await until(() => ui.view === 'home' && home.view === 'recents', 'Recents on the home screen');
      assert(!ui.newOpen && !$('#tabs .tab.new-tab'), 'the New file page should close');
      await backToEditor();
    });

    // ---- layout: every panel at its smallest and largest, in both modes, and the window at its smallest
    await test('Frames fold down to their bar and open again (button and F), remembered, canvas grows', async () => {
      const saved = localStorage.getItem('openpixel.framesClosed'); // the person's own choice, put back afterwards
      setFramesOpen(true); await sleep(120);
      const stage = () => $('#stage').getBoundingClientRect().height;
      const open = stage();
      $('#frames-toggle').click();
      await sleep(120);
      assert($('#app').classList.contains('frames-closed') && $('#frames-toggle').getAttribute('aria-expanded') === 'false', 'did not fold');
      assert(getComputedStyle($('#strip')).display === 'none', 'thumbnails still showing');
      assert(stage() > open + 40, `canvas did not grow (${open} → ${stage()})`);
      assert(localStorage.getItem('openpixel.framesClosed') === '1', 'not remembered');
      assert($('#play').getBoundingClientRect().height > 0 && $('#frame-add').getBoundingClientRect().height > 0, 'bar controls hidden');
      noSpill($('#frames'), 'folded frames bar');
      await snap('16-frames-folded');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
      await sleep(120);
      assert(!$('#app').classList.contains('frames-closed') && Math.abs(stage() - open) < 2, 'F did not open the frames again');
      if (saved === '1') setFramesOpen(false);
    });
    await test('panel borders are easy to grab: left, right and bottom handles straddle their border the same way', async () => {
      const probes = {
        left: () => { const b = $('#left').getBoundingClientRect(); return [[b.right - 3, b.top + 200], [b.right + 3, b.top + 200]]; },
        right: () => { const b = $('#right').getBoundingClientRect(); return [[b.left - 3, b.top + 200], [b.left + 3, b.top + 200]]; },
        bottom: () => { const b = $('#frames').getBoundingClientRect(); return [[b.left + 200, b.top - 3], [b.left + 200, b.top + 3]]; },
      };
      for (const [which, pts] of Object.entries(probes)) {
        const handle = $(`.resizer[data-resize="${which}"]`);
        const hr = handle.getBoundingClientRect();
        assert(Math.round(which === 'bottom' ? hr.height : hr.width) === 8, `${which} handle is ${which === 'bottom' ? hr.height : hr.width}px`);
        for (const [x, y] of pts()) {
          const hit = document.elementFromPoint(x, y);
          assert(hit === handle, `${which}: the point ${Math.round(x)},${Math.round(y)} next to the border hits ${hit && (hit.id || hit.className)}, not the handle`);
        }
        assert(getComputedStyle(handle).cursor === (which === 'bottom' ? 'row-resize' : 'col-resize'), `${which} cursor`);
      }
    });
    await test('right panel at every width: pictures for review (panel-<mode>-<width>.png)', async () => {
      for (const w of [230, 264, 300, 360, 460]) {
        setSize('right', w);
        await bothModes(async (m) => { await sleep(80); await snap(`panel-${m}-${w}`); });
      }
      setSize('right', 264);
    });
    await test('right panel resizes without cutting anything off', async () => {
      for (const [x, label] of [[window.innerWidth - 230, 'min'], [window.innerWidth - 460, 'max'], [window.innerWidth - 300, 'mid']]) {
        await drag('right', x, 300);
        await bothModes(async (m) => { layoutOk(`right ${label} ${m}`); });
        await snap(`08-right-${label}`);
      }
    });
    await test('left panel resizes without cutting anything off', async () => {
      for (const [x, label] of [[180, 'min'], [440, 'max']]) {
        await drag('left', x, 300);
        layoutOk(`left ${label}`);
        await snap(`09-left-${label}`);
      }
      await drag('left', 240, 300);
    });
    await test('frames panel resizes and previews stay inside', async () => {
      await call('add_frame', {}); await call('add_frame', {}); await settle();
      for (const [h, label] of [[72, 'min'], [260, 'max'], [140, 'mid']]) {
        await drag('bottom', 400, window.innerHeight - h);
        await sleep(400);
        await until(() => $$('#strip .fr .thumb img').every((i) => i.src), 'frame previews');
        framesOk();
        await snap(`10-frames-${label}`);
      }
    });
    await test('smallest window (980×620): nothing overlaps or is cut off', async () => {
      await post({ kind: 'resizeWindow', width: 980, height: 620 });
      await sleep(300);
      await drag('right', window.innerWidth - 230, 300);
      await drag('left', 180, 300);
      await bothModes(async (m) => { layoutOk(`980×620 ${m}`); await snap(`11-small-window-${m}`); });
      await goHome();
      noSpill($('#home'), 'home screen at 980×620');
      await snap('12-small-home');
      await goHome('folders');
      noSpill($('#home'), 'folders at 980×620');
      $('#tab-add').click(); await until(() => ui.view === 'new', 'the New file page');
      noSpill($('#newpage'), 'New file page at 980×620');
      await snap('12b-small-new-page');
      closeNewPage();
      await backToEditor();
    });
    await test('large window (1680×1050)', async () => {
      await post({ kind: 'resizeWindow', width: 1680, height: 1050 });
      await sleep(300);
      await bothModes(async (m) => { layoutOk(`1680×1050 ${m}`); });
      await snap('13-large-window');
      await post({ kind: 'resizeWindow', width: 1440, height: 900 });
      await drag('left', 240, 300); await drag('right', window.innerWidth - 264, 300); await drag('bottom', 400, window.innerHeight - 104);
    });

    /* Buttons: every visible button on every page, measured. Icons and labels must sit on the button's middle
       (labels by their optical centre: halfway up the capital letters, from the text's baseline), icon-only buttons
       also across, and icons and labels come in the app's sizes. */
    const BUTTONS = 'button, .btn, .tool, .chip, .tab, .home-nav, .np-row, .tb-home, .tb-add, .tb-stars, .side-link, .crumb, .dd-btn';
    const capCanvas = document.createElement('canvas').getContext('2d');
    function capHeight(cs) {
      capCanvas.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      return capCanvas.measureText('H').actualBoundingBoxAscent;
    }
    function measureButtons(where) {
      const out = [];
      for (const b of $$(BUTTONS)) {
        const r = b.getBoundingClientRect();
        if (!r.width || !r.height || b.closest('[hidden]') || getComputedStyle(b).visibility === 'hidden') continue;
        if (b.parentElement && b.parentElement.closest(BUTTONS) && !b.matches('.x, .more, .info-btn')) continue; // measured with its parent
        const cy = r.top + r.height / 2, cx = r.left + r.width / 2;
        const icons = [...b.querySelectorAll(':scope > svg.i, :scope > .ic > svg.i, :scope > .lic > svg.i, :scope > .swap > svg.i, :scope > span > svg.i')]
          .filter((s) => s.getBoundingClientRect().width && !s.closest('.out')); // not the hidden half of a swap
        const iconInfo = icons.map((s) => { const q = s.getBoundingClientRect(); return { w: Math.round(q.width * 10) / 10, dy: Math.round((q.top + q.height / 2 - cy) * 10) / 10, dx: Math.round((q.left + q.width / 2 - cx) * 10) / 10 }; });
        // label: the first text that belongs to the button itself
        let label = null;
        const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() && !n.parentElement.closest('svg, kbd, .x, .more, [hidden]') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
        const t = walker.nextNode();
        if (t) {
          const holder = t.parentElement, cs = getComputedStyle(holder);
          // A zero-size mark on the text's baseline. Loose text in a flex button is its own anonymous item, so the
          // text is wrapped for a moment (a wrapper span takes its place) and the mark goes inside it.
          const wrap = document.createElement('span'), mark = document.createElement('span');
          mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;margin:0;padding:0';
          t.parentNode.insertBefore(wrap, t);
          wrap.appendChild(mark); wrap.appendChild(t);
          const base = mark.getBoundingClientRect().bottom;
          wrap.parentNode.insertBefore(t, wrap);
          wrap.remove();
          const optical = base - capHeight(cs) / 2;
          label = { text: t.textContent.trim().slice(0, 24), size: parseFloat(cs.fontSize), weight: cs.fontWeight, dy: Math.round((optical - cy) * 10) / 10 };
        }
        const name = (b.id ? '#' + b.id : '') + (typeof b.className === 'string' && b.className ? '.' + b.className.trim().split(/\s+/).slice(0, 3).join('.') : b.tagName.toLowerCase());
        const stacked = false;
        let labelDx = null;
        if (stacked && t) { const q = t.parentElement.getBoundingClientRect(); labelDx = Math.round((q.left + q.width / 2 - cx) * 10) / 10; }
        out.push({ where, el: name, label: label && label.text, h: Math.round(r.height * 10) / 10, w: Math.round(r.width * 10) / 10, font: label && label.size, weight: label && label.weight, textDy: label && label.dy, icons: iconInfo, inSeg: !!b.closest('.seg'), stacked, labelDx });
      }
      return out;
    }
    let audit = [];
    try {
      for (const v of ['recents', 'folders', 'archive', 'agents']) { await goHome(v); await sleep(150); audit = audit.concat(measureButtons(`home:${v}`)); }
      $('#tab-add').click(); await until(() => ui.view === 'new', 'the New file page'); await sleep(150);
      audit = audit.concat(measureButtons('new'));
      closeNewPage();
      await backToEditor();
      for (const m of ['slice', '3d']) { setMode(m); await sleep(150); audit = audit.concat(measureButtons(`editor:${m}`)); }
      setMode('slice');
    } catch (e) { audit.push({ error: String(e && e.message ? e.message : e) }); }
    const problems = [];
    for (const b of audit) {
      if (b.error) { problems.push(b.error); continue; }
      const id = `${b.where} ${b.el}${b.label ? ` "${b.label}"` : ''}`;
      if (b.stacked) {
        if (b.labelDx === null || Math.abs(b.labelDx) > 0.75) problems.push(`${id}: label ${b.labelDx}px off centre across`);
        for (const i of b.icons) {
          if (Math.abs(i.dx) > 0.75) problems.push(`${id}: icon ${i.dx}px off centre across`);
          if (Math.abs(i.w - 18) >= 0.5) problems.push(`${id}: ${i.w}px icon (18px in the rail)`);
        }
        if (b.font !== 11) problems.push(`${id}: ${b.font}px label (11px in the rail)`);
        continue;
      }
      if (b.textDy !== null && Math.abs(b.textDy) > 0.75) problems.push(`${id}: label ${b.textDy}px off centre`);
      for (const i of b.icons) {
        if (Math.abs(i.dy) > 0.75) problems.push(`${id}: icon ${i.dy}px off centre`);
        if (!b.label && b.icons.length === 1 && Math.abs(i.dx) > 0.75) problems.push(`${id}: icon ${i.dx}px off centre across`);
        const allowed = !b.label ? (b.inSeg ? [14] : [12, 16, 18]) : b.el.includes('home-nav') ? [16] : [12, 14];
        if (!allowed.some((w) => Math.abs(w - i.w) < 0.5)) problems.push(`${id}: ${i.w}px icon (${allowed.join(' or ')}px here)`);
      }
      if (b.label && b.font && ![11.5, 14].includes(b.font)) problems.push(`${id}: ${b.font}px label`);
    }
    results.push({ name: `buttons: ${audit.length} measured, icons and labels centred and sized to the scale`, ok: !problems.length,
      error: problems.slice(0, 8).join('; ') || undefined, audit });

    /* Rows of controls: buttons and inputs that sit side by side share one height and one centre line, and every
       control uses the shared corner radius and fill for its kind. */
    const CONTROL = 'button, .btn, .chip, .stepper, .dd-btn, .seg, input.field, .side-search, .np-search, .tb-home, .tb-add, .tb-stars, .tab';
    const ROWS = '.row, #frames-bar, #top .left, #top .right, #top, .home-top, .np-starts, .sec-head, #tabbar, .modal footer, .cmd';
    function measureRows(where) {
      const out = [];
      for (const row of $$(ROWS)) {
        if (!row.getBoundingClientRect().height || row.closest('[hidden]') || getComputedStyle(row).visibility === 'hidden') continue;
        const ctrls = $$(CONTROL).filter((c) => {
          if (c.closest(ROWS) !== row || !c.getBoundingClientRect().width || c.closest('[hidden]')) return false;
          const outer = c.parentElement && c.parentElement.closest(CONTROL);
          return !outer || outer.closest(ROWS) !== row; // a control's own parts (stepper ±, segment buttons) are measured with it
        });
        if (ctrls.length < 2) continue;
        const items = ctrls.map((c) => {
          const r = c.getBoundingClientRect(), cs = getComputedStyle(c);
          return { el: (c.id ? '#' + c.id : '') + '.' + (typeof c.className === 'string' ? c.className.trim().split(/\s+/).slice(0, 2).join('.') : c.tagName),
            h: Math.round(r.height * 10) / 10, cy: Math.round((r.top + r.height / 2) * 10) / 10, radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, border: cs.borderTopColor };
        });
        out.push({ where, row: (row.id ? '#' + row.id : '') + '.' + (typeof row.className === 'string' ? row.className.trim().split(/\s+/)[0] : ''), items });
      }
      return out;
    }
    // Every field and every secondary button, on every page: one fill per kind, one radius.
    const KINDS = { field: 'input.field, .stepper, .dd-btn, .seg, .side-search, .np-search', secondary: '.btn.outline, .chip:not(.on)' };
    const kinds = { field: new Map(), secondary: new Map(), radius: new Map() };
    function scanKinds(where) {
      for (const [kind, sel] of Object.entries(KINDS)) {
        for (const c of $$(sel)) {
          if (!c.getBoundingClientRect().width || c.closest('[hidden]') || getComputedStyle(c).visibility === 'hidden') continue;
          const cs = getComputedStyle(c), name = `${where} ${c.id ? '#' + c.id : c.className}`;
          if (!kinds[kind].has(cs.backgroundColor)) kinds[kind].set(cs.backgroundColor, name);
          const small = c.getBoundingClientRect().height <= 24.5 && c.matches('.icon');
          const key = `${cs.borderTopLeftRadius}${small ? ' (24px icon)' : ''}`;
          if (!kinds.radius.has(key)) kinds.radius.set(key, name);
        }
      }
    }
    let rows = [];
    try {
      for (const v of ['recents', 'folders', 'archive', 'agents']) { await goHome(v); await sleep(120); rows = rows.concat(measureRows(`home:${v}`)); scanKinds(`home:${v}`); }
      $('#tab-add').click(); await until(() => ui.view === 'new', 'the New file page'); await sleep(120);
      rows = rows.concat(measureRows('new')); scanKinds('new');
      closeNewPage();
      await backToEditor();
      for (const m of ['slice', '3d']) { setMode(m); await sleep(120); rows = rows.concat(measureRows(`editor:${m}`)); scanKinds(`editor:${m}`); }
      setMode('slice');
      openModal('#name-dialog'); await sleep(250); rows = rows.concat(measureRows('dialog')); scanKinds('dialog'); closeModals();
    } catch (e) { rows.push({ error: String(e && e.message ? e.message : e) }); }
    const rowProblems = [];
    for (const row of rows) {
      if (row.error) { rowProblems.push(row.error); continue; }
      const hs = [...new Set(row.items.map((i) => i.h))], cys = row.items.map((i) => i.cy);
      if (hs.length > 1) rowProblems.push(`${row.where} ${row.row}: mixed heights ${hs.join('/')} (${row.items.map((i) => `${i.el} ${i.h}`).join(', ')})`);
      if (Math.max(...cys) - Math.min(...cys) > 0.75) rowProblems.push(`${row.where} ${row.row}: centres differ by ${(Math.max(...cys) - Math.min(...cys)).toFixed(1)}px`);
    }
    for (const kind of ['field', 'secondary']) {
      if (kinds[kind].size > 1) rowProblems.push(`${kind}s use ${kinds[kind].size} fills: ${[...kinds[kind]].map(([bg, el]) => `${bg} (${el})`).join(', ')}`);
    }
    for (const [r, el] of kinds.radius) if (!['7px', '6px (24px icon)'].includes(r)) rowProblems.push(`radius ${r} on ${el}`);
    results.push({ name: `controls: ${rows.length} rows share one height and centre; fields and secondary buttons share one fill and radius`,
      ok: !rowProblems.length, error: rowProblems.slice(0, 6).join('; ') || undefined, rows });

    /* Accessibility (WCAG 2.1 AA), on every page: text contrast against what is really behind it (the window glass
       counts as its darkest likely colour), clickable things the keyboard can't reach, and controls without a name. */
    const GLASS = [44, 44, 46]; // the dark sidebar glass behind transparent chrome, on a typical desktop
    const rgbOf = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const over = (top, a, under) => top.map((v, i) => v * a + under[i] * (1 - a));
    function backdrop(el) {
      const layers = [];
      for (let e = el; e; e = e.parentElement) { const b = rgbOf(getComputedStyle(e).backgroundColor); if (b && b.a > 0) { layers.push(b); if (b.a >= 1) break; } }
      let c = GLASS;
      for (const l of layers.reverse()) c = over(l.c, l.a, c);
      return c;
    }
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    function scanA11y(where) {
      const out = [];
      // contrast: every element with its own visible text
      for (const el of $$('body *')) {
        if (el.closest('svg, [hidden], .tip') || !el.getClientRects().length) continue;
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        const ph = el.matches('input[placeholder]') && !el.value;
        if (!own && !ph) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || +cs.opacity === 0 || el.closest('[aria-hidden="true"]')) continue;
        if (el.closest('button:disabled, .btn:disabled')) continue; // disabled controls are exempt
        const fgc = rgbOf(ph ? getComputedStyle(el, '::placeholder').color : cs.color);
        if (!fgc) continue;
        const bg = backdrop(el), fg = over(fgc.c, fgc.a, bg);
        const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
        const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
        const r = ratio(fg, bg);
        if (r < need) out.push({ where, kind: 'contrast', el: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).split(' ')[0]}`, text: (ph ? el.placeholder : el.textContent.trim()).slice(0, 24), ratio: Math.round(r * 100) / 100, need });
      }
      // keyboard: pointer-clickable things that can't take focus
      for (const el of $$('body *')) {
        if (el.closest('[hidden]') || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
        if (getComputedStyle(el).cursor !== 'pointer' || el.closest('.menu-list, .dd-list, canvas, #palette, .resizer')) continue;
        if (el.matches('button, a[href], input, select, textarea, [tabindex], label') || el.closest('button, [tabindex], label')) continue;
        out.push({ where, kind: 'keyboard', el: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).split(' ').slice(0, 2).join('.')}`, text: el.textContent.trim().slice(0, 24) });
      }
      // names: buttons and inputs need an accessible name
      for (const el of $$('button, input, [role="button"], [role="tab"]')) {
        if (el.closest('[hidden]') || !el.getClientRects().length) continue;
        const name = (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.dataset.tip || el.getAttribute('title') || el.textContent || (el.labels && el.labels.length ? 'label' : '')).trim();
        if (!name) out.push({ where, kind: 'name', el: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).split(' ')[0]}` });
      }
      return out;
    }
    let a11y = [];
    try {
      for (const v of ['recents', 'folders', 'archive', 'agents']) { await goHome(v); await sleep(150); a11y = a11y.concat(scanA11y(`home:${v}`)); }
      $('#tab-add').click(); await until(() => ui.view === 'new', 'the New file page'); await sleep(150);
      a11y = a11y.concat(scanA11y('new'));
      closeNewPage();
      await backToEditor();
      for (const m of ['slice', '3d']) { setMode(m); await sleep(150); a11y = a11y.concat(scanA11y(`editor:${m}`)); }
      setMode('slice');
      $('[data-menu="file-menu"]').click(); await sleep(200); a11y = a11y.concat(scanA11y('file menu')); closeMenus();
      openModal('#name-dialog'); await sleep(250); a11y = a11y.concat(scanA11y('dialog')); closeModals();
    } catch (e) { a11y.push({ kind: 'error', error: String(e && e.message ? e.message : e) }); }
    results.push({ name: 'accessibility (WCAG 2.1 AA): text contrast, keyboard reach and names on every page', ok: !a11y.length,
      error: a11y.slice(0, 6).map((f) => f.kind === 'contrast' ? `${f.where} ${f.el} "${f.text}" ${f.ratio}:1 (needs ${f.need})` : `${f.where} ${f.kind}: ${f.el || f.error} ${f.text || ''}`).join('; ') || undefined, a11y });
    restoreHomeView();

    const failed = results.filter((r) => !r.ok);
    post({ kind: 'uitestDone', report: { passed: results.length - failed.length, failed: failed.length, results } });
  }
  run().catch((e) => post({ kind: 'uitestDone', report: { crashed: String(e && e.stack ? e.stack : e), results } }));
})();
