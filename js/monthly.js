'use strict';

/* HWT monthly plant report (WWTP / STP operations report) -> warm Option A.
   Everything runs in the browser. Text comes from the PDF text layer when it is
   readable, otherwise from on-device OCR (tesseract.js, vendored). Figures are
   copied as read, never recalculated. */

(function () {
  var OCR_SCALE = 300 / 72;

  var MONTHLY_RE = /(\b(?:WWTP|STP|WTW|WWTW)\b[^\n]{0,40}\breport\b)|operational report|summary of analysis|meter flows|measured flow|monthly (?:operations? )?report|operational comments|process comments|plant report/ig;
  var PROPOSAL_RE = /\bDear\b|\bproposal\b|\bquotation\b|schedule of quantities|terms and conditions/ig;
  var COMMON = /\b(the|and|of|to|for|was|is|in|with|on|from|plant|water|report|treated|treatment|limits?|flow|total|average|pump|sample|samples)\b/gi;

  function abs(p) { return new URL(p, window.location.href).toString(); }
  function clean(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }

  /* ---------------- OCR ---------------- */
  var workerPromise = null;
  function getWorker() {
    if (!workerPromise) {
      if (!window.Tesseract) return Promise.reject(new Error('OCR engine missing.'));
      workerPromise = window.Tesseract.createWorker('eng', 1, {
        workerPath: abs('vendor/tesseract/worker.min.js'),
        corePath: abs('vendor/tesseract/'),
        langPath: abs('vendor/tesseract'),
        gzip: true,
        workerBlobURL: false,
        logger: function () {}
      }).then(function (w) {
        return w.setParameters({ preserve_interword_spaces: '1' }).then(function () { return w; });
      });
    }
    return workerPromise;
  }

  async function renderCanvas(page, scale) {
    var vp = page.getViewport({ scale: scale });
    var canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    var ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return canvas;
  }

  function linesFromOcr(data, scale) {
    function box(b) { return { x0: b.x0 / scale, y0: b.y0 / scale, x1: b.x1 / scale, y1: b.y1 / scale }; }
    return (data.lines || []).map(function (l) {
      var o = box(l.bbox);
      o.text = clean(l.text);
      o.words = (l.words || []).map(function (w) { var b = box(w.bbox); b.t = w.text; return b; });
      return o;
    }).filter(function (l) { return l.text; });
  }

  async function ocrCanvas(canvas, scale, params) {
    var worker = await getWorker();
    if (params) await worker.setParameters(params);
    var res = await worker.recognize(canvas);
    if (params) await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '3' });
    return res.data;
  }

  /* Text-layer lines (when the PDF text is readable). */
  function linesFromText(tc, vp) {
    var items = tc.items.filter(function (it) { return it.str && it.str.trim(); }).map(function (it) {
      var h = it.height || Math.hypot(it.transform[2], it.transform[3]) || 8;
      var base = vp.height - it.transform[5];
      return { t: it.str, x0: it.transform[4], x1: it.transform[4] + (it.width || 0), y0: base - h, y1: base };
    });
    items.sort(function (a, b) { return a.y1 - b.y1 || a.x0 - b.x0; });
    var lines = [];
    items.forEach(function (w) {
      var last = lines[lines.length - 1];
      if (last && Math.abs(last.y1 - w.y1) < 2.5) last.words.push(w);
      else lines.push({ words: [w] });
    });
    return lines.map(function (l) {
      l.words.sort(function (a, b) { return a.x0 - b.x0; });
      var words = [];
      l.words.forEach(function (w) {
        String(w.t).split(/(\s+)/).reduce(function (x, part) {
          var cw = (w.x1 - w.x0) / Math.max(1, w.t.length);
          if (part.trim()) words.push({ t: part, x0: x, x1: x + cw * part.length, y0: w.y0, y1: w.y1 });
          return x + cw * part.length;
        }, w.x0);
      });
      return {
        words: words,
        text: clean(words.map(function (w) { return w.t; }).join(' ')),
        x0: Math.min.apply(null, words.map(function (w) { return w.x0; })),
        x1: Math.max.apply(null, words.map(function (w) { return w.x1; })),
        y0: Math.min.apply(null, words.map(function (w) { return w.y0; })),
        y1: Math.max.apply(null, words.map(function (w) { return w.y1; }))
      };
    }).filter(function (l) { return l.text; });
  }

  function readable(text) {
    var t = String(text || '');
    if (t.replace(/\s/g, '').length < 40) return false;
    var hits = (t.match(COMMON) || []).length;
    var letters = (t.match(/[A-Za-z]/g) || []).length;
    return hits >= 6 && letters / t.replace(/\s/g, '').length > 0.55;
  }

  function classify(text) {
    var m = (String(text).match(MONTHLY_RE) || []).length;
    var p = (String(text).match(PROPOSAL_RE) || []).length;
    if (m >= 2 && m >= p) return 'monthly';
    if (m >= 1 && p === 0) return 'monthly';
    return 'proposal';
  }

  async function openPdf(file) {
    var data = new Uint8Array(await file.arrayBuffer());
    return pdfjsLib.getDocument({ data: data, useSystemFonts: true }).promise;
  }

  /* Decide proposal vs monthly report. Proposals keep the original path untouched. */
  async function detect(file, setStatus) {
    var pdf = await openPdf(file);
    try {
      var page = await pdf.getPage(1);
      var tc = await page.getTextContent();
      var text = tc.items.map(function (it) { return it.str; }).join(' ');
      if (readable(text)) return classify(text);
      if (setStatus) setStatus('Text layer unreadable, checking page 1 with on-device OCR…');
      var canvas = await renderCanvas(page, 2);
      var data = await ocrCanvas(canvas, 2);
      return classify(data.text || '');
    } finally {
      pdf.destroy();
    }
  }

  /* ---------------- images (charts) ---------------- */
  function mul(m, n) {
    return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  }
  async function imageRects(page) {
    var vp = page.getViewport({ scale: 1 });
    var ops = await page.getOperatorList();
    var O = pdfjsLib.OPS;
    var paint = {};
    ['paintImageXObject', 'paintJpegXObject', 'paintInlineImageXObject', 'paintImageXObjectRepeat'].forEach(function (n) {
      if (O[n] != null) paint[O[n]] = true;
    });
    var t = [1, 0, 0, 1, 0, 0];
    var st = [];
    var out = [];
    for (var i = 0; i < ops.fnArray.length; i++) {
      var f = ops.fnArray[i];
      var a = ops.argsArray[i] || [];
      if (f === O.save) st.push(t.slice());
      else if (f === O.restore) t = st.pop() || [1, 0, 0, 1, 0, 0];
      else if (f === O.transform) t = mul(t, a);
      else if (f === O.paintFormXObjectBegin) { st.push(t.slice()); if (a[0] && a[0].length === 6) t = mul(t, a[0]); }
      else if (f === O.paintFormXObjectEnd) t = st.pop() || [1, 0, 0, 1, 0, 0];
      else if (paint[f]) {
        var xs = [t[4], t[0] + t[4], t[2] + t[4], t[0] + t[2] + t[4]];
        var ys = [t[5], t[1] + t[5], t[3] + t[5], t[1] + t[3] + t[5]];
        var r = { x: Math.min.apply(null, xs), y: vp.height - Math.max.apply(null, ys) };
        r.w = Math.max.apply(null, xs) - r.x;
        r.h = Math.max.apply(null, ys) - Math.min.apply(null, ys);
        if (r.w > 80 && r.h > 50) out.push(r);
      }
    }
    return out.filter(function (r, i) {
      return !out.slice(0, i).some(function (o) { return Math.abs(o.x - r.x) < 4 && Math.abs(o.y - r.y) < 4; });
    });
  }

  function cropCanvas(canvas, r, scale, pageW) {
    var x = Math.max(0, r.x), y = Math.max(0, r.y);
    var w = Math.min(pageW, r.x + r.w) - x, h = r.h;
    var c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    c.getContext('2d').drawImage(canvas, x * scale, y * scale, c.width, c.height, 0, 0, c.width, c.height);
    return c;
  }

  /* Trim near-white margins so charts sit cleanly on cream paper. */
  function trimWhite(c) {
    var ctx = c.getContext('2d');
    var d = ctx.getImageData(0, 0, c.width, c.height).data;
    var x0 = c.width, x1 = 0, y0 = c.height, y1 = 0;
    for (var y = 0; y < c.height; y += 2) {
      for (var x = 0; x < c.width; x += 2) {
        var i = (y * c.width + x) * 4;
        if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 <= x0 || y1 <= y0) return c;
    var pad = 6;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(c.width, x1 + pad); y1 = Math.min(c.height, y1 + pad);
    var o = document.createElement('canvas');
    o.width = x1 - x0; o.height = y1 - y0;
    o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
    return o;
  }

  /* ---------------- parsing (pure; unit-tested in node) ---------------- */
  var GAP = 9; // pt between words that starts a new cell

  function cellsOf(line) {
    var cells = [];
    line.words.forEach(function (w) {
      var c = cells[cells.length - 1];
      if (c && w.x0 - c.x1 < GAP) { c.text += ' ' + w.t; c.x1 = w.x1; c.y0 = Math.min(c.y0, w.y0); c.y1 = Math.max(c.y1, w.y1); }
      else cells.push({ text: w.t, x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1, page: w.page });
    });
    cells.forEach(function (c) { c.text = clean(c.text); });
    return cells.filter(function (c) { return c.text; });
  }

  function isGlyph(tok) {
    if (/^[.,:;'"`\-–—_()|\/\\]+$/.test(tok)) return false;
    return /^[^A-Za-z0-9(]{1,3}$/.test(tok) || /^[eoO©®@]{1,2}$/.test(tok) || /^[@®©●•][A-Za-z]?$/.test(tok);
  }

  function fixUnits(t) {
    return t
      .replace(/^mg([NP]?)\/[Il!|1]$/, 'mg$1/l')
      .replace(/^ms\/m$/, 'mS/m')
      .replace(/^°c$/, '°C')
      .replace(/^Co[Dd]\b/, 'COD');
  }

  function splitHeading(text) {
    var m = /^(\d{1,2})\s+(.*)$/.exec(text);
    var num = m ? m[1] : '';
    var rest = m ? m[2] : text;
    var parts = rest.split(/\s+[-–—]\s+/);
    if (parts.length > 1) return { number: num, kicker: parts[0], title: parts.slice(1).join(' – ') };
    return { number: num, kicker: '', title: rest };
  }

  function inside(line, r) {
    var cx = (line.x0 + line.x1) / 2, cy = (line.y0 + line.y1) / 2;
    return cx > r.x - 2 && cx < r.x + r.w + 2 && cy > r.y - 2 && cy < r.y + r.h + 2;
  }

  function columnSplit(lines0, pageW) {
    var best = null;
    var lines = lines0.map(function (l) {
      var ws = l.words.filter(function (w) { return !/^[A-Za-z|!.,'`~_]$/.test(w.t); });
      return ws.length ? Object.assign({}, l, { words: ws }) : null;
    }).filter(Boolean);
    for (var x = pageW * 0.38; x < pageW * 0.7; x += 2) {
      var blocked = 0, both = 0, leftWords = 0, leftCells = 0, rightCells = 0, rightOnly = 0, leftOnly = 0;
      lines.forEach(function (l) {
        if (l.words.some(function (w) { return w.x0 < x && w.x1 > x; })) blocked += 1;
        var L = l.words.filter(function (w) { return w.x1 <= x; });
        var R = l.words.filter(function (w) { return w.x0 >= x; });
        if (L.length && !R.length) leftOnly += 1;
        if (R.length && !L.length) rightOnly += 1;
        if (L.length && R.length) { both += 1; leftWords += L.length; leftCells += cellsOf({ words: L }).length; rightCells += cellsOf({ words: R }).length; }
      });
      if (blocked === 0 && both >= 1 && both + rightOnly >= 3 && rightOnly >= 1 && leftOnly >= 1 && leftWords / both >= 4 && leftCells / both <= 1.3 && rightCells / both <= 3) {
        if (!best || both > best.both) best = { x: x, both: both };
      }
    }
    if (!best) return null;
    var left = [], right = [];
    lines.forEach(function (l) {
      var L = l.words.filter(function (w) { return w.x1 <= best.x; });
      var R = l.words.filter(function (w) { return w.x0 >= best.x; });
      function mk(ws) {
        return { words: ws, text: clean(ws.map(function (w) { return w.t; }).join(' ')),
          x0: ws[0].x0, x1: ws[ws.length - 1].x1,
          y0: Math.min.apply(null, ws.map(function (w) { return w.y0; })),
          y1: Math.max.apply(null, ws.map(function (w) { return w.y1; })) };
      }
      if (L.length) left.push(mk(L));
      if (R.length) right.push(mk(R));
    });
    return [left, right];
  }

  function buildTable(rows) {
    var cellRows = rows.map(cellsOf);
    var first = cellRows[0];
    var digitsIn = function (cs) { return cs.filter(function (c) { return /\d/.test(c.text); }).length; };
    var header = null;
    if (cellRows.length > 1 && first.length >= 3 && digitsIn(first) === 0) header = first;
    var anchors;
    if (header) anchors = header.map(function (c) { return c.x0; });
    else {
      var xs = [];
      cellRows.forEach(function (cs) { cs.forEach(function (c) { xs.push(c.x0); }); });
      xs.sort(function (a, b) { return a - b; });
      anchors = [];
      xs.forEach(function (x) { if (!anchors.length || x - anchors[anchors.length - 1] > 30) anchors.push(x); });
    }
    function col(c) {
      var k = 0;
      for (var i = 0; i < anchors.length; i++) if (c.x0 >= anchors[i] - 14) k = i;
      return k;
    }
    var body = (header ? cellRows.slice(1) : cellRows).map(function (cs) {
      var row = anchors.map(function () { return ''; });
      var boxes = anchors.map(function () { return null; });
      cs.forEach(function (c) {
        var k = col(c);
        row[k] = row[k] ? row[k] + ' ' + c.text : c.text;
        boxes[k] = boxes[k] ? { page: boxes[k].page, x0: boxes[k].x0, y0: Math.min(boxes[k].y0, c.y0), x1: c.x1, y1: Math.max(boxes[k].y1, c.y1) } : c;
      });
      return { cells: row.map(fixUnits), boxes: boxes };
    });
    return {
      type: 'table',
      header: header ? header.map(function (c) { return c.text; }) : null,
      rows: body.map(function (r) { return r.cells; }),
      boxes: body.map(function (r) { return r.boxes; }),
      anchors: anchors
    };
  }

  function stripIcon(t) {
    var s = clean(t);
    var m = /mailto:([^)\s]+)/.exec(s);
    if (m) return m[1];
    var hwt = s.indexOf('HWT');
    if (hwt > 0 && hwt <= 2) return s.slice(hwt);
    return s.replace(/^(?:[^A-Za-z0-9]+|[A-Za-z&]{1}\s+)/, '').trim();
  }

  function sectionBlocks(lines, images, headX, pageW) {
    var blocks = [];
    var split = columnSplit(lines, pageW);
    var groups = split ? split : [lines];
    groups.forEach(function (group, gi) {
      var tableRows = [];
      var items = null;
      function flushTable() {
        if (!tableRows.length) return;
        if (tableRows.length === 1 && cellsOf(tableRows[0]).length < 2) { blocks.push({ type: 'p', text: tableRows[0].text }); }
        else blocks.push(buildTable(tableRows));
        tableRows = [];
      }
      function flushItems() { if (items && items.length) blocks.push({ type: 'items', items: items }); items = null; }
      var prev = null;
      group.forEach(function (l) {
        var text = l.text;
        var cells = cellsOf(l);
        var rating = /^Rating\s+([0-9]{1,3}\s?[A-Z]?)$/.exec(text.replace(/\s+/g, ' '));
        if (rating) { flushTable(); flushItems(); blocks.push({ type: 'rating', label: 'Rating', value: rating[1].replace(/\s/g, '') }); prev = l; return; }
        if (/^Table\s+\d+\s*[:\-–]/i.test(text) && cells.length === 1) { flushTable(); flushItems(); blocks.push({ type: 'tableTitle', text: text }); prev = l; return; }
        if (/^\*/.test(text)) { flushTable(); flushItems(); blocks.push({ type: 'footnote', text: text }); prev = l; return; }
        var looksRow = cells.length >= 2 && !(cells.length === 2 && cells[0].text.split(' ').length >= 7);
        if (looksRow) { flushItems(); tableRows.push(l); prev = l; return; }
        flushTable();
        var h = Math.max(4, l.y1 - l.y0);
        var tight = prev && (l.y0 - prev.y1) < 0.6 * h;
        var dated = /^\d{1,2}[-\s][A-Z][a-z]{2}\b/.test(text);
        var indented = l.x0 >= headX + 7 || gi > 0;
        if (indented) {
          if (!items) items = [];
          if (items.length && tight && !dated) items[items.length - 1] += ' ' + text;
          else items.push(text);
        } else {
          flushItems();
          var last = blocks[blocks.length - 1];
          if (last && last.type === 'p' && tight) last.text += ' ' + text;
          else blocks.push({ type: 'p', text: text });
        }
        prev = l;
      });
      flushTable();
      flushItems();
    });
    return blocks;
  }

  /* pages: [{page,width,height,lines:[...], images:[{x,y,w,h,dataUrl}]}] -> model */
  function buildModel(pages) {
    var model = { title: '', company: [], sections: [], kpis: [], rating: '', notes: [] };
    var p1 = pages[0];
    var allHeads = [];
    pages.forEach(function (pg) {
      var signing = false;
      pg.lines.forEach(function (l) {
        var first = (l.words[0] && l.words[0].t) || '';
        l.page = pg.page;
        l.kind = 'body';
        var single = cellsOf(l).length === 1;
        if (signing) { l.kind = 'sign'; return; }
        if (/^written by\b/i.test(l.text)) { l.kind = 'subhead'; signing = true; return; }
        if (l.x0 < 24 && l.words.length > 1 && isGlyph(first)) {
          l.kind = 'head';
          var rest = l.words.slice(1);
          while (rest.length > 1 && isGlyph(rest[0].t)) rest = rest.slice(1);
          l.headText = clean(rest.map(function (w) { return w.t; }).join(' '));
          allHeads.push(l);
        } else if (l.x0 < 24 && single && /^\(/.test(l.text)) l.kind = 'caption';
        else if (l.x0 < 24 && single && l.words.length <= 8 && !/[.]$/.test(l.text)) l.kind = 'subhead';
        if (/^Page \d+ of \d+$/i.test(l.text)) l.kind = 'skip';
      });
    });
    var firstHead = p1.lines.filter(function (l) { return l.kind === 'head'; })[0];
    var headTop = firstHead ? firstHead.y0 : 80;
    var top = p1.lines.filter(function (l) { return l.y1 <= headTop + 1; });
    top.forEach(function (l) { l.kind = 'skip'; });
    var titleLine = top.slice().sort(function (a, b) { return a.y0 - b.y0 || a.x0 - b.x0; }).find(function (l) { return l.x0 < p1.width / 2; });
    if (titleLine) {
      var ws = [];
      titleLine.words.some(function (w, i) {
        if (i && w.x0 - titleLine.words[i - 1].x1 > 30) return true;
        ws.push(w.t); return false;
      });
      model.title = clean(ws.join(' '));
    }
    top.forEach(function (l) {
      var right = l.words.filter(function (w) { return w.x0 > p1.width * 0.5; });
      var t = clean(right.map(function (w) { return w.t; }).join(' '));
      if (/[A-Za-z0-9]{3}/.test(t)) model.company.push(t);
    });

    var sec = null;
    function open(head) {
      var h = splitHeading(head.headText);
      sec = { number: h.number, kicker: h.kicker, title: h.title, parts: [] };
      model.sections.push(sec);
    }
    var headX = firstHead ? firstHead.x0 : 16;
    pages.forEach(function (pg) {
      var imgs = (pg.images || []).slice();
      var stream = pg.lines.filter(function (l) {
        if (l.kind === 'skip') return false;
        return !imgs.some(function (r) { return inside(l, r); });
      }).map(function (l) { return { y: l.y0, line: l }; });
      imgs.forEach(function (r) { stream.push({ y: r.y, image: r }); });
      stream.sort(function (a, b) { return a.y - b.y; });
      var bodyRun = [];
      function flushBody() {
        if (!bodyRun.length) return;
        if (!sec) open({ headText: model.title || 'Report' });
        sec.parts.push.apply(sec.parts, sectionBlocks(bodyRun, [], headX, pg.width));
        bodyRun = [];
      }
      stream.forEach(function (s) {
        if (s.image) {
          flushBody();
          if (!sec) open({ headText: 'Figures' });
          sec.parts.push({ type: 'image', dataUrl: s.image.dataUrl, w: s.image.w, h: s.image.h });
          return;
        }
        var l = s.line;
        if (l.kind === 'sign') { flushBody(); if (!sec) open({ headText: 'Report' }); sec.parts.push({ type: 'p', text: l.text, sign: true }); return; }
        if (l.kind === 'head') { flushBody(); open(l); return; }
        if (l.kind === 'caption') { flushBody(); if (!sec) open({ headText: 'Report' }); sec.parts.push({ type: 'caption', text: l.text.replace(/^\(|\)$/g, '') }); return; }
        if (l.kind === 'subhead') {
          flushBody();
          if (!sec) open({ headText: 'Report' });
          sec.parts.push({ type: /^written by/i.test(l.text) ? 'signoffStart' : 'subhead', text: l.text });
          return;
        }
        bodyRun.push(l);
      });
      flushBody();
    });

    // sign-off: everything after "Written by:" becomes a sign-off card
    model.sections.forEach(function (s) {
      var at = s.parts.findIndex(function (p) { return p.type === 'signoffStart'; });
      if (at < 0) return;
      var lines = [];
      s.parts.slice(at + 1).forEach(function (p) {
        if (p.type === 'p' || p.type === 'subhead') lines.push(p.text);
        if (p.type === 'items') lines.push.apply(lines, p.items);
      });
      // OCR often reads the name as a subhead and the rest as one paragraph
      var flat = [];
      lines.forEach(function (t) { flat.push(t); });
      s.parts = s.parts.slice(0, at);
      s.parts.push({ type: 'signoff', label: 'Written by', lines: flat.map(stripIcon).filter(Boolean) });
    });

    // KPIs (copied strings only)
    var prose = [];
    model.sections.forEach(function (s) {
      s.parts.forEach(function (p) {
        if (p.type === 'p') prose.push(p.text);
        if (p.type === 'items') prose.push.apply(prose, p.items);
        if (p.type === 'rating') model.rating = p.value;
      });
    });
    var all = prose.join('\n');
    function kpi(label, re, unitIdx, valIdx) {
      var m = re.exec(all);
      if (m) model.kpis.push({ label: label, value: m[valIdx || 1], unit: unitIdx ? m[unitIdx] : '' });
    }
    if (model.rating) model.kpis.push({ label: 'Rating', value: model.rating, unit: 'this month' });
    model.sections.forEach(function (s) {
      s.parts.forEach(function (p) {
        if (p.type !== 'table') return;
        p.rows.forEach(function (r) {
          if (/total after treatment/i.test(r[0]) && r[r.length - 1]) model.kpis.push({ label: 'Total treated', value: r[r.length - 1], unit: 'kilolitres' });
        });
      });
    });
    kpi('Average daily', /Average water treated for [^\n]*? was ([\d.,]+)\s*(kilolitres per day|kl\/d(?:ay)?|m3\/d(?:ay)?)/i, 2);
    kpi('Peak daily', /Peak daily water treated was ([\d.,]+)\s*(kilolitres per day|kl\/d(?:ay)?|m3\/d(?:ay)?)/i, 2);
    kpi('Power usage', /Power usage for [^\n]*? was ([\d.,]+)\s*(kWh\w*)/i, 2);
    kpi('Site visits', /visited by [^\n]*? (\d+) times/i);
    model.kpis = model.kpis.slice(0, 5);
    return model;
  }


  /* Text cleanup (typos / OCR). Numeric cells are never touched. */
  var HWT_PM = ['HWT Process Maintenance (Pty) Ltd', 'Reg 2017/388687/07', 'PO Box 28 \u2022 Lynedoch \u2022 7603 \u2022 South Africa'];
  function cleanupModel(model) {
    var C = (typeof window !== 'undefined' && window.HWTCleanup) || null;
    var log = [];
    if (model.company.some(function (t) { return /HWT\s+Process\s+Maint/i.test(t) || /Lynedoch/i.test(t); })) {
      model.company = HWT_PM.slice();
    }
    if (!C) return log;
    function c(t) { return C.clean(t, log); }
    model.title = c(model.title);
    model.sections.forEach(function (s) {
      s.kicker = c(s.kicker);
      s.title = c(s.title);
      s.parts.forEach(function (p) {
        if (p.text != null && p.type !== 'rating') p.text = c(p.text);
        if (p.items) p.items = p.items.map(c);
        if (p.header) p.header = p.header.map(c);
        if (p.rows) p.rows = p.rows.map(function (r) {
          return r.map(function (cell, i) { return i > 0 && /^[\d.,\s\-\u2013<>%()]+$/.test(cell) ? cell : c(cell); });
        });
      });
    });
    return log;
  }

  /* ---------------- numeric re-read of table cells ---------------- */
  async function refineCells(model, canvases) {
    var jobs = [];
    model.sections.forEach(function (s) {
      s.parts.forEach(function (p) {
        if (p.type !== 'table' || !p.boxes) return;
        p.rows.forEach(function (row, ri) {
          row.forEach(function (cell, ci) {
            var b = p.boxes[ri][ci];
            if (!b || ci === 0 || !/\d/.test(cell) || /[A-Za-z]{2,}/.test(cell) || !canvases[b.page]) return;
            jobs.push({ table: p, ri: ri, ci: ci, box: b, canvas: canvases[b.page] });
          });
        });
      });
    });
    var worker = await getWorker();
    await worker.setParameters({ tessedit_char_whitelist: '0123456789.,-–/()% <>', tessedit_pageseg_mode: '7' });
    try {
      for (var i = 0; i < jobs.length; i++) {
        var j = jobs[i];
        var pad = 2.5;
        var x = Math.max(0, (j.box.x0 - pad) * OCR_SCALE), y = Math.max(0, (j.box.y0 - pad) * OCR_SCALE);
        var w = (j.box.x1 - j.box.x0 + pad * 2) * OCR_SCALE, h = (j.box.y1 - j.box.y0 + pad * 2) * OCR_SCALE;
        var c = document.createElement('canvas');
        c.width = Math.round(w * 2); c.height = Math.round(h * 2);
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(j.canvas, x, y, w, h, 0, 0, c.width, c.height);
        var res = await worker.recognize(c);
        var t = clean(res.data.text).replace(/\s*[-–]\s*/g, ' - ');
        var orig = j.table.rows[j.ri][j.ci];
        var od = orig.replace(/\D/g, ''), nd = t.replace(/\D/g, '');
        if (t && nd && nd === od && t !== orig) j.table.rows[j.ri][j.ci] = t;
        else if (t && nd && Math.abs(nd.length - od.length) <= 1 && /[.,]/.test(t) && !/[.,]/.test(orig)) j.table.rows[j.ri][j.ci] = t;
      }
    } finally {
      await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '3' });
    }
  }

  /* ---------------- render ---------------- */
  var SHEET_H = 1123;
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null && text !== '') n.textContent = text;
    return n;
  }

  function footer(model) {
    var f = el('footer', 'sheet-foot');
    var co = el('div', 'foot-co');
    co.appendChild(el('strong', '', model.company[0] || 'HWT (Pty) Ltd'));
    co.appendChild(document.createTextNode('Water & Effluent Treatment Engineering' + (model.company.length > 1 ? ' • ' + model.company.slice(1).join(' • ') : '')));
    f.appendChild(co);
    f.appendChild(el('div', 'page-no', ''));
    return f;
  }

  function makeSheet(model, cover) {
    var sheet = el('article', 'sheet mr-sheet' + (cover ? ' cover' : ''));
    var head = el('div', 'sheet-head');
    if (cover) {
      var top = el('div', 'cover-top');
      var logo = el('img', 'logo'); logo.src = 'assets/hwt-logo.png'; logo.alt = 'HWT Water Treatment';
      top.appendChild(logo);
      var co = el('div', 'co');
      co.appendChild(el('div', 'eyebrow', 'WATER & EFFLUENT TREATMENT ENGINEERING'));
      (model.company.length ? model.company : ['HWT (Pty) Ltd']).forEach(function (t, i) { co.appendChild(el('div', i ? '' : 'co-name', t)); });
      top.appendChild(co);
      head.appendChild(top);
      var band = el('div', 'band');
      band.appendChild(el('div', 'eyebrow', 'Operational report'));
      band.appendChild(el('h2', '', model.title || 'Monthly plant report'));
      var subs = [];
      model.sections.forEach(function (s) { if (s.title && subs.indexOf(s.title) < 0 && subs.length < 4) subs.push(s.title); });
      if (subs.length) band.appendChild(el('div', 'tail mr-tail', subs.join(' • ')));
      head.appendChild(band);
      if (model.kpis.length) {
        var k = el('div', 'mr-kpis');
        model.kpis.forEach(function (x) {
          var card = el('div', 'mr-kpi' + (x.label === 'Rating' ? ' hero' : ''));
          card.appendChild(el('div', 'mr-kpi-l', x.label));
          card.appendChild(el('div', 'mr-kpi-v', x.value));
          if (x.unit) card.appendChild(el('div', 'mr-kpi-u', x.unit));
          k.appendChild(card);
        });
        head.appendChild(k);
      }
    } else {
      var inner = el('div', 'inner-top');
      var mark = el('img', 'logo sm'); mark.src = 'assets/hwt-logo.png'; mark.alt = '';
      inner.appendChild(mark);
      var run = el('div', 'run');
      run.appendChild(el('div', 'run-kicker', 'Operational report'));
      run.appendChild(el('div', 'run-title', model.title));
      inner.appendChild(run);
      head.appendChild(inner);
      head.appendChild(el('div', 'rule'));
    }
    sheet.appendChild(head);
    sheet.appendChild(el('div', 'flow'));
    sheet.appendChild(footer(model));
    return sheet;
  }

  function statusClass(text, headerText) {
    if (!/comment|compliance|status|result/i.test(headerText || '') || !text) return '';
    if (/within|compl(?:y|ies|iant)|\bok\b|pass|good/i.test(text)) return 'mr-ok';
    return 'mr-flag';
  }

  function tableNode(p) {
    var wrap = el('div', 'mr-table-wrap');
    var t = el('table', 'mr-table' + (p.header ? '' : ' kv'));
    if (p.header) {
      var thead = el('thead'), tr = el('tr');
      p.header.forEach(function (h) { tr.appendChild(el('th', '', h)); });
      thead.appendChild(tr); t.appendChild(thead);
    }
    var tb = el('tbody');
    p.rows.forEach(function (r) {
      var tr = el('tr');
      if (/^total/i.test(r[0])) tr.className = 'total';
      r.forEach(function (c, i) {
        var td = el('td', i > 0 && /^[\d.,\s\-–<>%()]+$|^Not req|^[\d.,]+\s*-\s*[\d.,]+$/i.test(c) ? 'num' : '');
        var cls = statusClass(c, p.header && p.header[i]);
        if (cls) td.appendChild(el('span', 'mr-chip ' + cls, c)); else td.textContent = c;
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    return wrap;
  }

  function nodesFor(model) {
    var nodes = [];
    model.sections.forEach(function (s, si) {
      var h = el('div', 'mr-sec');
      if (s.kicker) h.appendChild(el('p', 'sec-kicker', s.kicker));
      var title = el('h3', 'mr-sec-title');
      if (s.number) title.appendChild(el('span', 'num', s.number));
      title.appendChild(document.createTextNode(s.title));
      h.appendChild(title);
      h._keep = true;
      nodes.push(h);
      var pendingTitle = null;
      s.parts.forEach(function (p) {
        var n = null;
        if (p.type === 'caption') { n = el('p', 'mr-cap', p.text); n._keep = true; }
        else if (p.type === 'subhead') { n = el('h4', 'mr-sub', p.text); n._keep = true; }
        else if (p.type === 'p') n = el('p', 'mr-p', p.text);
        else if (p.type === 'items') { n = el('ul', 'clean mr-items'); p.items.forEach(function (t) { n.appendChild(el('li', '', t)); }); }
        else if (p.type === 'tableTitle') { n = el('p', 'mr-ttl', p.text); n._keep = true; }
        else if (p.type === 'footnote') n = el('p', 'mr-foot', p.text);
        else if (p.type === 'table') n = tableNode(p);
        else if (p.type === 'rating') {
          n = el('div', 'mr-rating');
          var card = el('div', 'quote-card');
          card.appendChild(el('div', 'ql', 'Overall'));
          card.appendChild(el('div', 'qa', p.label + ' ' + p.value));
          n.appendChild(card);
        } else if (p.type === 'image') {
          n = el('figure', 'mr-fig');
          var img = el('img'); img.src = p.dataUrl; img.alt = '';
          n.appendChild(img);
        } else if (p.type === 'signoff') {
          n = el('div', 'mr-sign');
          n.appendChild(el('div', 'mr-sign-l', p.label));
          p.lines.forEach(function (t, i) { n.appendChild(el('div', i ? 'mr-sign-x' : 'mr-sign-n', t)); });
        }
        if (n) nodes.push(n);
      });
    });
    return nodes;
  }

  function sizeFlow(sheet) {
    var flow = sheet.querySelector('.flow');
    var head = sheet.querySelector('.sheet-head');
    var cs = getComputedStyle(sheet);
    var max = SHEET_H - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0) - (head ? head.offsetHeight : 0) - 8;
    flow.style.maxHeight = Math.max(160, max) + 'px';
    flow.style.overflow = 'hidden';
    return flow;
  }
  function over(flow) { return flow.scrollHeight > flow.clientHeight + 2; }

  function splitTail(node, flow) {
    // move rows/items from node into a continuation clone until it fits
    var isTable = node.querySelector && node.querySelector('tbody');
    var list = isTable ? node.querySelector('tbody') : (node.tagName === 'UL' ? node : null);
    if (!list) return null;
    var clone = node.cloneNode(true);
    var cl = isTable ? clone.querySelector('tbody') : clone;
    cl.textContent = '';
    while (over(flow) && list.children.length > 2) cl.insertBefore(list.lastElementChild, cl.firstChild);
    if (over(flow) || !cl.children.length) return null;
    return clone;
  }

  async function render(model, mount) {
    mount.textContent = '';
    var sheets = [];
    function add(cover) {
      var s = makeSheet(model, cover);
      var frame = el('div', 'frame');
      frame.appendChild(s);
      mount.appendChild(frame);
      sizeFlow(s);
      sheets.push(s);
      return s.querySelector('.flow');
    }
    var flow = add(true);
    var nodes = nodesFor(model);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      flow.appendChild(n);
      if (n.tagName === 'FIGURE') {
        var img = n.querySelector('img');
        if (!img.complete) await new Promise(function (r) { img.onload = img.onerror = r; });
      }
      if (!over(flow)) continue;
      var rest = splitTail(n, flow);
      var carry = [];
      if (!rest) {
        flow.removeChild(n);
        // keep headings/captions with what follows
        while (flow.lastElementChild && flow.lastElementChild._keep) carry.unshift(flow.removeChild(flow.lastElementChild));
        if (!flow.children.length && !carry.length) { flow.appendChild(n); continue; }
        flow = add(false);
        carry.forEach(function (c) { flow.appendChild(c); });
        nodes.splice(i + 1, 0, n);
        if (flow.children.length === 0) continue;
        continue;
      }
      flow = add(false);
      nodes.splice(i + 1, 0, rest);
    }
    sheets.forEach(function (s, i) { s.querySelector('.page-no').textContent = 'Page ' + (i + 1) + ' of ' + sheets.length; });
    return sheets;
  }

  /* ---------------- convert ---------------- */
  async function convert(file, mount, setStatus) {
    var pdf = await openPdf(file);
    var pages = [];
    var canvases = {};
    var usedOcr = false;
    try {
      for (var i = 1; i <= pdf.numPages; i++) {
        var page = await pdf.getPage(i);
        var vp = page.getViewport({ scale: 1 });
        setStatus('Reading ' + file.name + ' · page ' + i + ' of ' + pdf.numPages);
        var canvas = await renderCanvas(page, OCR_SCALE);
        canvases[i] = canvas;
        var tc = await page.getTextContent();
        var lines;
        if (readable(tc.items.map(function (it) { return it.str; }).join(' '))) lines = linesFromText(tc, vp);
        else {
          usedOcr = true;
          setStatus('Reading ' + file.name + ' · on-device OCR, page ' + i + ' of ' + pdf.numPages);
          lines = linesFromOcr(await ocrCanvas(canvas, OCR_SCALE), OCR_SCALE);
        }
        var rects = [];
        try { rects = await imageRects(page); } catch (e) { rects = []; }
        var images = rects.map(function (r) {
          var c = trimWhite(cropCanvas(canvas, r, OCR_SCALE, vp.width));
          return { x: r.x, y: r.y, w: r.w, h: r.h, dataUrl: c.toDataURL('image/jpeg', 0.9) };
        });
        lines.forEach(function (l) { l.words.forEach(function (w) { w.page = i; }); });
        pages.push({ page: i, width: vp.width, height: vp.height, lines: lines, images: images });
      }
      setStatus('Laying out ' + file.name);
      var model = buildModel(pages);
      if (usedOcr) {
        setStatus('Double-checking table figures…');
        await refineCells(model, canvases);
        model.notes.push({ text: 'Read with on-device OCR (this PDF has no usable text layer). Table figures were double-checked automatically; a quick glance against the source is still worthwhile.' });
      }
      if (window.HWTCleanup) await window.HWTCleanup.ready();
      var fixes = cleanupModel(model);
      model.fixes = fixes;
      if (fixes.length) model.notes.push({ text: fixes.length + ' text fix' + (fixes.length === 1 ? '' : 'es') + ' applied (typos / OCR), e.g. ' + fixes.slice(0, 4).map(function (f) { return '\u201c' + f.from + '\u201d \u2192 \u201c' + f.to + '\u201d'; }).join(', ') + '. Numbers were not changed.' });
      var imgCount = pages.reduce(function (a, p) { return a + p.images.length; }, 0);
      if (imgCount) model.notes.push({ text: imgCount + ' chart' + (imgCount === 1 ? '' : 's') + ' copied from the source as images.' });
      model.notes.push({ text: 'Monthly report detected. Values are copied as printed, never recalculated.' });
      var sheets = await render(model, mount);
      return { model: model, sheets: sheets };
    } finally {
      pdf.destroy();
    }
  }

  window.HWTMonthly = {
    detect: detect,
    convert: convert,
    _test: { cleanupModel: cleanupModel, buildModel: buildModel, classify: classify, readable: readable, cellsOf: cellsOf, splitHeading: splitHeading }
  };
})();
