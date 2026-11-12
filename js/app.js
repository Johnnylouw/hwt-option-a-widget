'use strict';

(function () {
  var drop = document.getElementById('drop');
  var fileInput = document.getElementById('file');
  var pick = document.getElementById('pick');
  var clearBtn = document.getElementById('clear');
  var statusEl = document.getElementById('status');
  var results = document.getElementById('results');
  var hint = document.getElementById('file-hint');
  var busy = false;

  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.js', window.location.href).toString();

  if (location.protocol === 'file:') {
    hint.textContent = 'If a PDF will not open from this page, serve the folder instead: python3 -m http.server 8741';
  }

  function setStatus(text) { statusEl.textContent = text || ''; }

  function mul(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1],
      m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5]
    ];
  }

  function apply(m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }

  function rectFromMatrix(m, pageHeight) {
    var corners = [apply(m, 0, 0), apply(m, 1, 0), apply(m, 0, 1), apply(m, 1, 1)];
    var xs = corners.map(function (p) { return p[0]; });
    var ys = corners.map(function (p) { return p[1]; });
    var left = Math.min.apply(null, xs);
    var right = Math.max.apply(null, xs);
    var bottom = Math.min.apply(null, ys);
    var topPdf = Math.max.apply(null, ys);
    return {
      x: left,
      y: pageHeight - topPdf,
      w: right - left,
      h: topPdf - bottom
    };
  }

  async function imageRects(page) {
    var viewport = page.getViewport({ scale: 1 });
    var opList = await page.getOperatorList();
    var OPS = pdfjsLib.OPS;
    var imageOps = {};
    ['paintImageXObject', 'paintJpegXObject', 'paintInlineImageXObject', 'paintImageMaskXObject', 'paintImageXObjectRepeat'].forEach(function (name) {
      if (OPS[name] != null) imageOps[OPS[name]] = true;
    });
    var transform = [1, 0, 0, 1, 0, 0];
    var stack = [];
    var rects = [];
    for (var i = 0; i < opList.fnArray.length; i++) {
      var fn = opList.fnArray[i];
      var args = opList.argsArray[i] || [];
      if (fn === OPS.save) {
        stack.push(transform.slice());
      } else if (fn === OPS.restore) {
        transform = stack.pop() || [1, 0, 0, 1, 0, 0];
      } else if (fn === OPS.transform) {
        transform = mul(transform, args);
      } else if (fn === OPS.paintFormXObjectBegin) {
        stack.push(transform.slice());
        if (args[0] && args[0].length === 6) transform = mul(transform, args[0]);
      } else if (fn === OPS.paintFormXObjectEnd) {
        transform = stack.pop() || [1, 0, 0, 1, 0, 0];
      } else if (imageOps[fn]) {
        var rect = rectFromMatrix(transform, viewport.height);
        if (rect.w > 8 && rect.h > 8 && rect.w < viewport.width + 4 && rect.h < viewport.height + 4) {
          rects.push(rect);
        }
      }
    }
    var unique = [];
    rects.forEach(function (rect) {
      var dup = unique.some(function (other) {
        return Math.abs(other.x - rect.x) < 4 && Math.abs(other.y - rect.y) < 4
          && Math.abs(other.w - rect.w) < 8 && Math.abs(other.h - rect.h) < 8;
      });
      if (!dup) unique.push(rect);
    });
    return unique;
  }

  /* Small filled shapes (vector bullets). Word/LibreOffice exports often draw list bullets
     as paths instead of text, so the text layer alone loses every list marker. */
  async function vectorMarks(page) {
    var viewport = page.getViewport({ scale: 1 });
    var opList = await page.getOperatorList();
    var OPS = pdfjsLib.OPS;
    var transform = [1, 0, 0, 1, 0, 0];
    var stack = [];
    var marks = [];
    var counts = {};
    counts[OPS.moveTo] = 2; counts[OPS.lineTo] = 2; counts[OPS.curveTo] = 6;
    counts[OPS.curveTo2] = 4; counts[OPS.curveTo3] = 4; counts[OPS.closePath] = 0; counts[OPS.rectangle] = 4;
    function push(box) {
      if (!box) return;
      var a = apply(transform, box[0], box[1]);
      var b = apply(transform, box[2], box[3]);
      var x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
      var y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
      var w = x1 - x0, h = y1 - y0;
      if (w < 1.2 || h < 1.2 || w > 8.5 || h > 8.5) return;
      if (Math.max(w, h) / Math.min(w, h) > 3) return;
      marks.push({ x: x0, y: viewport.height - y1, w: w, h: h });
    }
    for (var i = 0; i < opList.fnArray.length; i++) {
      var fn = opList.fnArray[i];
      var args = opList.argsArray[i] || [];
      if (fn === OPS.save) stack.push(transform.slice());
      else if (fn === OPS.restore) transform = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) transform = mul(transform, args);
      else if (fn === OPS.paintFormXObjectBegin) {
        stack.push(transform.slice());
        if (args[0] && args[0].length === 6) transform = mul(transform, args[0]);
      } else if (fn === OPS.paintFormXObjectEnd) transform = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.constructPath) {
        var ops = args[0] || [];
        var co = args[1] || [];
        var k = 0;
        var box = null;
        for (var j = 0; j < ops.length; j++) {
          var op = ops[j];
          var n = counts[op];
          if (n == null) { box = null; break; }
          if (op === OPS.rectangle) {
            push(box); box = null;
            push([co[k], co[k + 1], co[k] + co[k + 2], co[k + 1] + co[k + 3]]);
          } else if (op === OPS.moveTo) {
            push(box);
            box = [co[k], co[k + 1], co[k], co[k + 1]];
          } else {
            for (var q = 0; q < n; q += 2) {
              if (!box) box = [co[k + q], co[k + q + 1], co[k + q], co[k + q + 1]];
              box[0] = Math.min(box[0], co[k + q]); box[1] = Math.min(box[1], co[k + q + 1]);
              box[2] = Math.max(box[2], co[k + q]); box[3] = Math.max(box[3], co[k + q + 1]);
            }
          }
          k += n;
        }
        push(box);
      }
    }
    return marks;
  }

  function cropRect(canvas, rect, scale) {
    var sx = Math.max(0, Math.floor(rect.x * scale));
    var sy = Math.max(0, Math.floor(rect.y * scale));
    var sw = Math.min(canvas.width - sx, Math.ceil(rect.w * scale));
    var sh = Math.min(canvas.height - sy, Math.ceil(rect.h * scale));
    if (sw < 8 || sh < 8) return null;
    var out = document.createElement('canvas');
    out.width = sw;
    out.height = sh;
    out.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return out;
  }

  function mostlyBlank(canvas) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width;
    var h = canvas.height;
    if (!w || !h) return true;
    var step = Math.max(2, Math.floor(Math.min(w, h) / 40));
    var data = ctx.getImageData(0, 0, w, h).data;
    var n = 0;
    var blank = 0;
    for (var y = 0; y < h; y += step) {
      for (var x = 0; x < w; x += step) {
        var i = (y * w + x) * 4;
        n += 1;
        if (data[i] > 248 && data[i + 1] > 248 && data[i + 2] > 248) blank += 1;
      }
    }
    return n > 0 && blank / n > 0.985;
  }

  function contentBands(canvas, scale, pageHeight) {
    var w = canvas.width;
    var h = canvas.height;
    var ctx = canvas.getContext('2d');
    var data = ctx.getImageData(0, 0, w, h).data;
    var stepX = 3;
    var ink = new Float32Array(h);
    for (var y = 0; y < h; y++) {
      var count = 0;
      var total = 0;
      for (var x = 0; x < w; x += stepX) {
        var i = (y * w + x) * 4;
        total += 1;
        if (data[i] < 236 || data[i + 1] < 236 || data[i + 2] < 228) count += 1;
      }
      ink[y] = total ? count / total : 0;
    }
    var bands = [];
    var start = -1;
    for (var yy = 0; yy <= h; yy++) {
      var on = yy < h && ink[yy] > 0.08;
      if (on && start < 0) start = yy;
      if (!on && start >= 0) {
        if (yy - start > 70) bands.push([start, yy]);
        start = -1;
      }
    }
    return bands.map(function (band) {
      var y0 = band[0];
      var y1 = band[1];
      var x0 = w;
      var x1 = 0;
      for (var y2 = y0; y2 < y1; y2 += 2) {
        for (var x2 = 0; x2 < w; x2 += stepX) {
          var p = (y2 * w + x2) * 4;
          if (data[p] < 236 || data[p + 1] < 236 || data[p + 2] < 228) {
            if (x2 < x0) x0 = x2;
            if (x2 > x1) x1 = x2;
          }
        }
      }
      x0 = Math.max(0, x0 - 2);
      x1 = Math.min(w - 1, x1 + 2);
      return {
        x: x0 / scale,
        y: y0 / scale,
        w: (x1 - x0) / scale,
        h: (y1 - y0) / scale,
        xPx: x0,
        yPx: y0,
        wPx: x1 - x0,
        hPx: y1 - y0
      };
    }).filter(function (rect) {
      if (rect.h < 70 || rect.w < 80) return false;
      if (rect.y < 140 && rect.h < 90) return false;
      if (rect.y > pageHeight - 60) return false;
      return true;
    });
  }

  function itemsFromPage(textContent, viewport, pageNumber) {
    var styles = textContent.styles || {};
    var items = [];
    textContent.items.forEach(function (item) {
      if (!item.str) return;
      var str = item.str.replace(/\u00ad/g, '');
      if (!str.trim()) return;
      var fontSize = Math.max(item.height || 0, Math.hypot(item.transform[2] || 0, item.transform[3] || 0) || 0) || 8;
      var h = item.height || fontSize;
      var base = viewport.height - item.transform[5];
      var style = styles[item.fontName] || {};
      var fontName = (style.fontFamily || '') + ' ' + (item.fontName || '');
      items.push({
        str: str,
        x: item.transform[4],
        y: base - h,
        base: base,
        w: item.width || 0,
        h: h,
        fontSize: fontSize,
        fontName: fontName,
        bold: /bold/i.test(fontName),
        pageNumber: pageNumber
      });
    });
    return items;
  }

  async function extractPage(page, pageNumber) {
    var viewport = page.getViewport({ scale: 1 });
    var textContent = await page.getTextContent();
    var items = itemsFromPage(textContent, viewport, pageNumber);
    var contentLines = items.filter(function (it) { return it.y < viewport.height - 54; }).length;
    var scale = 2.4;
    var renderViewport = page.getViewport({ scale: scale });
    var canvas = document.createElement('canvas');
    canvas.width = Math.ceil(renderViewport.width);
    canvas.height = Math.ceil(renderViewport.height);
    var ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;

    var rects = [];
    try { rects = await imageRects(page); } catch (err) { rects = []; }
    var images = [];
    rects.forEach(function (rect) {
      if (rect.y < 140 && rect.h < 90) return;
      if (rect.h < 70 || rect.w < 80) return;
      var crop = cropRect(canvas, rect, scale);
      if (!crop || mostlyBlank(crop)) return;
      images.push({
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        dataUrl: crop.toDataURL('image/jpeg', 0.92)
      });
    });

    if (!images.length && contentLines < 40) {
      contentBands(canvas, scale, viewport.height).forEach(function (rect) {
        var piece = document.createElement('canvas');
        piece.width = Math.max(1, Math.floor(rect.wPx));
        piece.height = Math.max(1, Math.floor(rect.hPx));
        piece.getContext('2d').drawImage(canvas, rect.xPx, rect.yPx, rect.wPx, rect.hPx, 0, 0, piece.width, piece.height);
        if (mostlyBlank(piece)) return;
        images.push({
          x: rect.x,
          y: rect.y,
          w: rect.w,
          h: rect.h,
          dataUrl: piece.toDataURL('image/jpeg', 0.92)
        });
      });
    }

    var marks = [];
    try { marks = await vectorMarks(page); } catch (err) { marks = []; }

    return {
      pageNumber: pageNumber,
      width: viewport.width,
      height: viewport.height,
      items: items,
      images: images,
      marks: marks
    };
  }

  async function readPdf(file) {
    var data = new Uint8Array(await file.arrayBuffer());
    var task = pdfjsLib.getDocument({ data: data, useSystemFonts: true });
    var pdf = await task.promise;
    var pages = [];
    for (var i = 1; i <= pdf.numPages; i++) {
      setStatus('Reading ' + file.name + ' · page ' + i + ' of ' + pdf.numPages);
      var page = await pdf.getPage(i);
      pages.push(await extractPage(page, i));
    }
    pdf.destroy();
    return pages;
  }

  function fitFrames() {
    document.querySelectorAll('.frame').forEach(function (frame) {
      var sheet = frame.querySelector('.sheet');
      if (!sheet) return;
      var avail = frame.parentElement ? frame.parentElement.clientWidth : window.innerWidth;
      var scale = Math.min(1, avail / 794);
      if (scale < 0.995) {
        sheet.style.transform = 'scale(' + scale + ')';
        sheet.style.transformOrigin = 'top left';
        frame.style.height = (1123 * scale) + 'px';
      } else {
        sheet.style.transform = '';
        frame.style.height = '';
      }
    });
  }

  function downloadName(file) {
    var base = file.name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '').trim() || 'HWT proposal';
    return base + ' - Option A.pdf';
  }

  function whoLine(model) {
    var parts = [];
    if (model.to) parts.push('To ' + model.to);
    if (model.from) parts.push('From ' + model.from);
    if (model.date) parts.push(model.date);
    return parts.join(' · ');
  }

  function docHeading(model) {
    var bits = [];
    if (model.mainTitle) bits.push(model.mainTitle);
    if (model.titleTail) bits.push(model.titleTail);
    if (bits.length) return bits.join(' ');
    return model.docTitle || 'HWT proposal';
  }

  function renderNotes(list, notes) {
    list.textContent = '';
    (notes || []).forEach(function (note) {
      var li = document.createElement('li');
      li.className = note.level === 'warn' ? 'warn' : '';
      li.textContent = note.text;
      list.appendChild(li);
    });
  }

  async function exportPdf(sheets, filename, button) {
    if (!sheets.length) return;
    var previous = button.textContent;
    button.disabled = true;
    var holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-12000px;top:0;width:794px;';
    document.body.appendChild(holder);
    try {
      var JsPDF = window.jspdf.jsPDF;
      var pdf = new JsPDF({ unit: 'mm', format: 'a4', compress: true });
      pdf.setProperties({
        title: filename.replace(/\.pdf$/i, ''),
        author: 'HWT (Pty) Ltd',
        subject: 'Option A'
      });
      for (var i = 0; i < sheets.length; i++) {
        setStatus('Preparing PDF · page ' + (i + 1) + ' of ' + sheets.length);
        var clone = sheets[i].cloneNode(true);
        clone.style.transform = 'none';
        clone.style.boxShadow = 'none';
        clone.style.margin = '0';
        holder.appendChild(clone);
        var imgs = clone.querySelectorAll('img');
        await Promise.all([].map.call(imgs, function (img) {
          if (img.complete) return Promise.resolve();
          return new Promise(function (resolve) {
            img.onload = img.onerror = resolve;
          });
        }));
        var canvas = await html2canvas(clone, {
          scale: 2.6,
          backgroundColor: '#FBF8F2',
          useCORS: true,
          logging: false,
          windowWidth: 1200
        });
        var img = canvas.toDataURL('image/jpeg', 0.94);
        if (i > 0) pdf.addPage();
        pdf.setFillColor(251, 248, 242);
        pdf.rect(0, 0, 210, 297, 'F');
        pdf.addImage(img, 'JPEG', 0, 0, 210, 297, 'p' + i, 'MEDIUM');
        holder.removeChild(clone);
      }
      pdf.save(filename);
      setStatus('Downloaded the Option A PDF.');
    } catch (err) {
      setStatus('Could not build the PDF. ' + (err && err.message ? err.message : ''));
    } finally {
      holder.remove();
      button.disabled = false;
      button.textContent = previous;
    }
  }

  function useful(model) {
    return !!(model.docTitle || (model.body && model.body.length) || (model.intro && model.intro.length)
      || model.salutation || (model.quotation && model.quotation.amount)
      || (model.schedule && ((model.schedule.groups && model.schedule.groups.length) || model.schedule.fallback))
      || (model.terms && model.terms.length) || (model.media && model.media.length)
      || (model.labs && model.labs.length) || (model.extras && model.extras.length));
  }

  function cloneModel(m) {
    return typeof structuredClone === 'function' ? structuredClone(m) : JSON.parse(JSON.stringify(m));
  }

  /* Render, then run the post-layout check. Tight gaps are nudged in place; if that (or anything
     else) leaves a page clipped, lay the document out again with roomier spacing built in. */
  async function laidOut(m, mount, renderFn) {
    mount.classList.remove('lc-strict');
    var sheets = await renderFn(m, mount);
    var check = window.HWTLayoutCheck;
    if (!check) return sheets;
    var res = check.audit(sheets, true);
    if (res.overflow || res.issues.length) {
      mount.classList.add('lc-strict');
      var again = await renderFn(m, mount);
      var res2 = check.audit(again, true);
      if (res2.issues.length <= res.issues.length) { sheets = again; res = res2; }
      else {
        mount.classList.remove('lc-strict');
        sheets = await renderFn(m, mount);
        res = check.audit(sheets, true);
      }
    }
    mount._layout = res;
    window.__lastLayout = res;
    return sheets;
  }

  function showLayout(job) {
    var notes = job.querySelector('.notes');
    var mount = job.querySelector('.sheets');
    var res = mount && mount._layout;
    if (!notes || !res) return;
    var old = notes.querySelector('.lc-note');
    if (old) old.remove();
    var li = document.createElement('li');
    li.className = 'lc-note' + (res.issues.length ? ' warn' : '');
    if (!res.issues.length) {
      li.textContent = 'Layout check: ' + res.pages + ' pages, clear gaps around every figure and table, nothing clipped or overlapping.';
    } else {
      var seen = {};
      var parts = [];
      res.issues.forEach(function (x) {
        var k = x.page + x.type;
        if (seen[k]) return;
        seen[k] = 1;
        parts.push('page ' + x.page + ': ' + x.detail);
      });
      li.textContent = 'Layout check: ' + parts.slice(0, 6).join('; ') + (parts.length > 6 ? '; …' : '') + '.';
    }
    notes.appendChild(li);
  }

  /* Review step: list suggested text fixes with checkboxes; only ticked ones are applied. */
  async function setupReview(job, file, button, rawModel, cleanFn, renderFn) {
    var mount = job.querySelector('.sheets');
    var raw = cloneModel(rawModel);
    var probe = cloneModel(raw);
    var suggestions = cleanFn(probe, null);
    var ticked = new Set(suggestions.map(function (f) { return f.key; }));
    var renderToken = 0;

    async function build() {
      var token = ++renderToken;
      var m = cloneModel(raw);
      cleanFn(m, function (fix) { return ticked.has(fix.key); });
      if (token !== renderToken) return;
      job._model = m;
      window.__lastModel = m;
      m.fixes = suggestions.map(function (f) { return { from: f.from, to: f.to, rule: f.rule, section: f.section, key: f.key, applied: ticked.has(f.key) }; });
      job._sheets = await laidOut(m, mount, renderFn);
      showLayout(job);
      fitFrames();
    }
    function doExport(btn) { return exportPdf(job._sheets, downloadName(file), btn); }

    await build();
    button.disabled = false;
    button.addEventListener('click', function () { doExport(button); });
    if (!suggestions.length) return;

    var panel = document.createElement('section');
    panel.className = 'review';
    panel.innerHTML = ''
      + '<div class="review-head">'
      + '  <div><h3>Suggested text fixes <span class="review-count"></span></h3>'
      + '  <p>Tick the fixes to apply. Unticked text stays exactly as in the source. Numbers are never changed.</p></div>'
      + '  <div class="review-actions">'
      + '    <button type="button" class="ghost sm" data-act="all">Select all</button>'
      + '    <button type="button" class="ghost sm" data-act="none">Clear all</button>'
      + '    <button type="button" class="ghost sm" data-act="keep">Keep original (no fixes)</button>'
      + '    <button type="button" class="primary sm" data-act="export">Export PDF</button>'
      + '  </div>'
      + '</div>'
      + '<ul class="review-list"></ul>';
    var list = panel.querySelector('.review-list');
    suggestions.forEach(function (f) {
      var li = document.createElement('li');
      var label = document.createElement('label');
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;
      box.dataset.key = f.key;
      label.appendChild(box);
      var body = document.createElement('span');
      body.className = 'rv-body';
      var top = document.createElement('span');
      top.className = 'rv-change';
      var b = document.createElement('del'); b.textContent = f.from;
      var arrow = document.createElement('span'); arrow.className = 'rv-arrow'; arrow.textContent = '\u2192';
      var a = document.createElement('ins'); a.textContent = f.to;
      top.appendChild(b); top.appendChild(arrow); top.appendChild(a);
      var meta = document.createElement('span');
      meta.className = 'rv-meta';
      meta.textContent = (f.section ? f.section + ' \u00b7 ' : '') + f.rule + (f.ctx ? ' \u00b7 \u201c' + f.ctx + '\u201d' : '');
      body.appendChild(top); body.appendChild(meta);
      label.appendChild(body);
      li.appendChild(label);
      list.appendChild(li);
    });
    var count = panel.querySelector('.review-count');
    function sync() {
      count.textContent = '(' + ticked.size + ' of ' + suggestions.length + ' ticked)';
      list.querySelectorAll('input').forEach(function (bx) { bx.checked = ticked.has(bx.dataset.key); bx.closest('li').classList.toggle('off', !bx.checked); });
    }
    var timer = null;
    function changed() { sync(); clearTimeout(timer); timer = setTimeout(build, 250); }
    list.addEventListener('change', function (e) {
      var bx = e.target;
      if (!bx || bx.type !== 'checkbox') return;
      if (bx.checked) ticked.add(bx.dataset.key); else ticked.delete(bx.dataset.key);
      changed();
    });
    panel.querySelector('.review-actions').addEventListener('click', async function (e) {
      var act = e.target && e.target.dataset && e.target.dataset.act;
      if (!act) return;
      if (act === 'all') { suggestions.forEach(function (f) { ticked.add(f.key); }); changed(); }
      if (act === 'none') { ticked.clear(); changed(); }
      if (act === 'keep' || act === 'export') {
        if (act === 'keep') { ticked.clear(); sync(); }
        clearTimeout(timer);
        await build();
        await doExport(e.target);
      }
    });
    sync();
    job.insertBefore(panel, mount);
    job._review = { ticked: ticked, suggestions: suggestions };
  }

  async function convertFile(file) {
    var job = document.createElement('article');
    job.className = 'job';
    job.innerHTML = ''
      + '<div class="job-bar">'
      + '  <div><p class="file-name"></p><h2></h2><p class="who"></p></div>'
      + '  <div class="chip"><span class="chip-l"></span><strong></strong><span class="chip-s">Printed figures, not recalculated.</span></div>'
      + '  <button type="button" class="primary download">Download PDF</button>'
      + '</div>'
      + '<ul class="notes"></ul>'
      + '<div class="sheets"></div>';
    results.appendChild(job);
    job.querySelector('.file-name').textContent = file.name;
    var button = job.querySelector('.download');
    button.disabled = true;
    try {
      if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
        throw new Error('This file is not a PDF.');
      }
      var kind = 'proposal';
      if (window.HWTMonthly) {
        try { kind = await window.HWTMonthly.detect(file, setStatus); } catch (detectErr) { kind = 'proposal'; }
      }
      if (kind === 'monthly') {
        var out = await window.HWTMonthly.convert(file, job.querySelector('.sheets'), setStatus);
        var mm = out.model;
        job.querySelector('h2').textContent = mm.title || 'Monthly plant report';
        job.querySelector('.who').textContent = 'Monthly operations report';
        job.querySelector('.chip-l').textContent = 'Rating';
        job.querySelector('.chip strong').textContent = mm.rating || 'Not found';
        job.querySelector('.chip-s').textContent = 'Printed figures, not recalculated.';
        renderNotes(job.querySelector('.notes'), mm.notes);
        await setupReview(job, file, button, mm,
          function (m, allow) { return window.HWTMonthly.cleanupModel(m, allow); },
          function (m, mount) { return window.HWTMonthly.render(m, mount); });
        setStatus('');
        return;
      }
      var pages = await readPdf(file);
      setStatus('Laying out ' + file.name);
      var model = window.HWTParse.parseDocument(pages);
      if (window.HWTCleanup) await window.HWTCleanup.ready();
      if (!useful(model)) {
        throw new Error('No proposal text could be read from this PDF. Nothing was invented.');
      }
      job._model = model;
      window.__lastModel = model;
      job.querySelector('h2').textContent = docHeading(model);
      job.querySelector('.who').textContent = whoLine(model);
      var chipL = job.querySelector('.chip-l');
      var chipN = job.querySelector('.chip strong');
      if (model.quotation && model.quotation.amount) {
        chipL.textContent = model.quotation.label || 'Quotation';
        chipN.textContent = model.quotation.amount;
      } else {
        chipL.textContent = 'Quotation total';
        chipN.textContent = 'Not found';
        job.querySelector('.chip-s').textContent = 'No quotation figure was printed in a way that could be mapped.';
      }
      renderNotes(job.querySelector('.notes'), model.notes);
      if (model.scheduleRows) {
        var li = document.createElement('li');
        li.textContent = model.scheduleRows + ' schedule ' + (model.scheduleRows === 1 ? 'line' : 'lines') + ' copied as printed.';
        job.querySelector('.notes').appendChild(li);
      }
      await setupReview(job, file, button, model,
        function (m, allow) { return window.HWTCleanup ? window.HWTCleanup.applyModel(m, window.HWTCleanup.walkProposal, allow) : []; },
        function (m, mount) { return window.HWTRender.renderDocument(m, mount); });
      setStatus('');
    } catch (err) {
      job.querySelector('h2').textContent = 'Could not convert';
      job.querySelector('.chip').hidden = true;
      button.hidden = true;
      var note = document.createElement('li');
      note.className = 'warn';
      note.textContent = err && err.message ? err.message : 'The PDF could not be read.';
      job.querySelector('.notes').appendChild(note);
      setStatus('');
    }
  }

  async function handleFiles(fileList) {
    var files = [].slice.call(fileList || []).filter(Boolean);
    if (files.length) document.dispatchEvent(new CustomEvent('hwt:files', { detail: files }));
    if (!files.length || busy) return;
    busy = true;
    pick.disabled = true;
    clearBtn.hidden = false;
    try {
      for (var i = 0; i < files.length; i++) {
        await convertFile(files[i]);
      }
    } finally {
      busy = false;
      pick.disabled = false;
      fileInput.value = '';
      fitFrames();
    }
  }

  pick.addEventListener('click', function (event) {
    event.stopPropagation();
    fileInput.click();
  });
  drop.addEventListener('click', function (event) {
    if (event.target === pick || event.target === clearBtn) return;
    fileInput.click();
  });
  fileInput.addEventListener('change', function () { handleFiles(fileInput.files); });
  clearBtn.addEventListener('click', function (event) {
    event.stopPropagation();
    results.textContent = '';
    clearBtn.hidden = true;
    setStatus('');
  });

  ['dragenter', 'dragover'].forEach(function (name) {
    window.addEventListener(name, function (event) { event.preventDefault(); });
    drop.addEventListener(name, function (event) {
      event.preventDefault();
      drop.classList.add('hot');
    });
  });
  ['dragleave', 'drop'].forEach(function (name) {
    drop.addEventListener(name, function (event) {
      event.preventDefault();
      drop.classList.remove('hot');
    });
  });
  drop.addEventListener('drop', function (event) {
    handleFiles(event.dataTransfer.files);
  });
  window.addEventListener('resize', fitFrames);

  document.fonts.ready.then(function () {
    return Promise.all([
      document.fonts.load('400 16px "Source Sans 3"'),
      document.fonts.load('600 16px "Source Sans 3"'),
      document.fonts.load('700 16px "Source Sans 3"'),
      document.fonts.load('italic 400 16px "Source Sans 3"')
    ]);
  }).catch(function () {});
})();
