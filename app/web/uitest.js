'use strict';
/* OpenPixel UI test. Runs only when the app is started with `--ui-test <folder>`: it clicks through the
   editor like a person would, resizes every panel and the window, checks that nothing spills out or gets
   cut off, saves pictures of the checkpoints and writes report.json into that folder. */
(function () {
  const CFG = window.OPENPIXEL_UITEST;
  if (!CFG) return;
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
  async function bothModes(fn) {
    for (const m of ['slice', '3d']) { setMode(m); await sleep(120); await fn(m); }
    setMode('slice'); await sleep(80);
  }

  async function run() {
    await until(() => stateReady, 'the editor to start', 15000);
    await sleep(300);

    await test('starts on the home screen with samples', async () => {
      assert(S.home && !$('#home').hidden, 'home screen not shown');
      await until(() => $$('#home-samples .card').length === 2, 'two sample cards');
      const tiles = $$('.home-actions .action-tile'), box = $('.home-actions').getBoundingClientRect();
      assert(Math.abs(tiles[tiles.length - 1].getBoundingClientRect().right - box.right) < 2, 'option tiles do not stretch the full width');
      assert($('#home-samples .card img'), 'sample cards have no preview');
      await snap('01-home');
    });
    await test('home: new 2D sprite (16×16) through the dialog and its steppers', async () => {
      $('[data-new="2d"]').click();
      assert($('#new-dialog').classList.contains('open'), 'new dialog did not open');
      $('#new-x').value = 18; $('#new-y').value = 18;
      $$('#new-dialog .stepper button[data-step="-1"]')[0].click();
      $$('#new-dialog .stepper button[data-step="-1"]')[0].click();
      $$('#new-dialog .stepper button[data-step="-1"]')[1].click();
      $$('#new-dialog .stepper button[data-step="-1"]')[1].click();
      assert($('#new-x').value === '16' && $('#new-y').value === '16', `steppers gave ${$('#new-x').value}×${$('#new-y').value}`);
      $('#new-palette .dd-btn').click();
      assert($('#new-palette').classList.contains('open'), 'palette dropdown did not open');
      $('#new-palette .opt[data-value="db32"]').click();
      $('#new-ok').click();
      await until(() => S.sx === 16 && S.sy === 16 && S.sz === 1 && !S.home, 'a 16×16 sprite in the editor');
      await settle();
      assert(S.mode === 'slice', 'sprite did not open on the 2D canvas');
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
      $('#zoom-in').click(); assert(sv.zoom > z, 'zoom in');
      $('#zoom-out').click(); $('#zoom-out').click(); assert(sv.zoom < z, 'zoom out');
      $('#zoom-fit').click(); assert(sv.zoom === z, 'fit');
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
      $('#agent-btn').click();
      await until(() => S.home && home.view === 'agents' && $$('#agents-body tr').length >= 7, 'the Agents page');
      assert($('#agent-cmd').textContent.includes('--mcp'), 'command missing');
      for (const id of ['chatgpt', 'codex', 'claude', 'claude-code', 'cursor', 'openclaw', 'hermes']) {
        const row = $(`#agents-body tr[data-agent="${id}"]`);
        assert(row, `${id} row missing`);
        assert(row.querySelector('.pill').textContent.trim(), `${id} has no status`);
        const logo = row.querySelector('.alogo svg');
        assert(logo && logo.getBoundingClientRect().width >= 16 && logo.querySelector('path'), `${id} logo missing`);
        row.querySelector('.info-btn').click();
        assert($('#agent-info').classList.contains('open'), `${id} info popup did not open`);
        assert($$('#ai-body ol.steps li').length >= 2, `${id} has no steps`);
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
      $('#agent-btn').click();
      await until(() => S.home && home.view === 'agents', 'the Agents page');
      await post({ kind: 'spawnAgent', client: 'claude-code', call: false });
      await until(async () => { await loadAgents(); return $('#agents-body tr[data-agent="claude-code"] .pill').classList.contains('live'); }, 'Claude Code to show as connected and live without a call', 8000);
      assert($('#agents-body tr[data-agent="claude-code"] .act-cell').textContent.includes('no calls yet'), 'should say no calls yet');
      await post({ kind: 'stopAgents' });
      await until(async () => { await loadAgents(); return !$('#agents-body tr[data-agent="claude-code"] .pill').classList.contains('live'); }, 'the connection to close', 8000);
    });
    await test('Agents page: a real agent connection shows as Connected, then as last connected', async () => {
      await post({ kind: 'spawnAgent', client: 'claude-code' });
      await loadAgents();
      await until(async () => { await loadAgents(); return $('#agents-body tr[data-agent="claude-code"] .pill').classList.contains('live'); }, 'Claude Code to show as connected and live', 8000);
      assert($('#agents-body tr[data-agent="claude-code"] .act-cell').textContent.includes('1 call'), 'call not counted');
      await post({ kind: 'spawnAgent', client: 'my-custom-agent' });
      await until(async () => { await loadAgents(); return $$('#agents-body tr[data-agent="other"]').length === 1; }, 'the unknown agent row', 8000);
      await snap('16-agents-connected');
      await pollAgentDot();
      assert($('#agent-btn .dot').style.background.includes('ok'), 'top bar dot not green');
      await post({ kind: 'stopAgents' });
      await until(async () => { await loadAgents(); return !$('#agents-body tr[data-agent="claude-code"] .pill').classList.contains('live'); }, 'the connection to close', 8000);
      const after = $('#agents-body tr[data-agent="claude-code"] .act-cell').textContent;
      assert(['Last used', 'Not used yet', 'not set up', 'Not installed'].some((t) => after.includes(t)), `activity after closing: ${after}`);
      // Only two statuses, and no settings-file paths in the activity column.
      for (const tr of $$('#agents-body tr')) {
        const label = tr.querySelector('.pill').textContent.trim();
        assert(['Connected', 'Disconnected', 'Not found'].includes(label) || label.startsWith('Connected ×'), `unexpected status "${label}"`);
        assert(!tr.querySelector('.asub'), 'agent description should be gone');
        const act = tr.querySelector('.act-cell').textContent;
        assert(!act.includes('.json') && !act.includes('.toml') && !act.includes('Library'), `path in activity: ${act}`);
      }
      $('#home-back').click();
    });
    await test('update button: hidden when up to date, accent button at the bottom of both sidebars when an update is found', async () => {
      const real = await nativeAction('version'); // restore whatever the real check found afterwards
      PC.updateAvailable(null);
      assert($$('.update-slot').every((s) => s.hidden), 'update button shows while up to date');
      PC.updateAvailable('99.0.0');
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const toRGB = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
      const check = (slot, panel, where) => {
        const b = slot.querySelector('.update-btn'), r = b.getBoundingClientRect(), p = panel.getBoundingClientRect();
        assert(!slot.hidden && r.height > 20, `${where}: update button not shown`);
        assert(b.textContent.includes('99.0.0'), `${where}: label is "${b.textContent}"`);
        assert(getComputedStyle(b).backgroundColor === toRGB(accent), `${where}: not the accent colour (${getComputedStyle(b).backgroundColor})`);
        assert(r.bottom <= p.bottom + 0.5 && p.bottom - r.bottom < 24 && r.left >= p.left && r.right <= p.right, `${where}: not at the bottom of the sidebar`);
      };
      check($('#editor-update'), $('#left'), 'editor');
      noSpill($('#left'), 'left panel with the update button');
      await PC.showHome();
      await sleep(300);
      check($('#home-update'), $('.home-side'), 'home');
      $('#home-back').click();
      PC.updateAvailable(real && real.available ? real.available : null);
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
      $('#file-menu .menu-list [data-action="sample2d"]').getBoundingClientRect();
      document.body.click();
      $('[data-menu="export-menu"]').click();
      assert($('#export-menu').classList.contains('open'), 'export menu');
      assert($('[data-export="svg"]') && $('[data-export="html"]'), 'SVG/HTML missing');
      assert(visible($('#export-menu .menu-list')), 'export menu is open but cannot be seen');
      await sleep(200); // let the opening animation finish before the picture
      await snap('06-export-menu');
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
      $('#home-btn').click();
      await until(() => $$('#home-recents .card').some((c) => c.textContent.includes('My Robot')), 'the saved file on the home screen');
      const c = $$('#home-recents .card').find((x) => x.textContent.includes('My Robot'));
      assert(c.querySelector('.pv img'), 'no preview');
      assert(c.textContent.includes('/') || c.textContent.includes('~'), 'no folder shown');
      await snap('07-home-recents');
      $('#home-search').value = 'zzz'; $('#home-search').dispatchEvent(new Event('input'));
      assert(!$$('#home-recents .card').length, 'search did not filter');
      $('#home-search').value = ''; $('#home-search').dispatchEvent(new Event('input'));
      await call('new_sprite', { width: 8, height: 8 });
      await until(() => !S.home && S.sx === 8, 'leaving home after a new sprite');
      $('#home-btn').click();
      await until(() => S.home && $$('#home-recents .card').length, 'home again');
      $$('#home-recents .card').find((x) => x.textContent.includes('My Robot')).click();
      await until(() => !S.home && S.sz === 6 && S.name === 'Untitled' || (!S.home && S.sz === 6), 'the saved model reopened');
    });
    await test('home: sample cards open the samples', async () => {
      $('#home-btn').click();
      await until(() => S.home, 'home');
      $('#home-samples .card[data-sample="sample3d"]').click();
      await until(() => !S.home && S.sx === 24 && S.sz === 24, 'the 3D sample');
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
      $('#home-btn').click(); await until(() => S.home, 'home');
      noSpill($('#home'), 'home screen at 980×620');
      await snap('12-small-home');
      $('#home-back').click();
    });
    await test('large window (1680×1050)', async () => {
      await post({ kind: 'resizeWindow', width: 1680, height: 1050 });
      await sleep(300);
      await bothModes(async (m) => { layoutOk(`1680×1050 ${m}`); });
      await snap('13-large-window');
      await post({ kind: 'resizeWindow', width: 1440, height: 900 });
      await drag('left', 240, 300); await drag('right', window.innerWidth - 264, 300); await drag('bottom', 400, window.innerHeight - 104);
    });

    const failed = results.filter((r) => !r.ok);
    post({ kind: 'uitestDone', report: { passed: results.length - failed.length, failed: failed.length, results } });
  }
  run().catch((e) => post({ kind: 'uitestDone', report: { crashed: String(e && e.stack ? e.stack : e), results } }));
})();
