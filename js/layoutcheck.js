'use strict';
/* Post-layout check: measures every rendered sheet before export.
   - clipped content (flow overflow, elements past the content box)
   - overlapping / touching blocks
   - gap between body text and any figure / table / caption wrapper (target >= 24px)
   - gap above the footer
   Small gap problems are nudged in place (extra padding). The caller re-paginates
   when a nudge makes a page overflow. */
(function () {
  var MIN_GAP = 22;      // px; CSS aims for 26
  var HEAD_GAP = 6;      // heading / caption directly above a block
  var FOOT_GAP = 16;

  function rectOf(node, origin, s) {
    var r = node.getBoundingClientRect();
    return { top: (r.top - origin.top) / s, bottom: (r.bottom - origin.top) / s, left: (r.left - origin.left) / s, right: (r.right - origin.left) / s, h: r.height / s };
  }

  function inkRect(block, origin, s) {
    var kids = [].slice.call(block.children);
    if (!kids.length) return rectOf(block, origin, s);
    var rs = kids.map(function (k) { return rectOf(k, origin, s); });
    return {
      top: Math.min.apply(null, rs.map(function (r) { return r.top; })),
      bottom: Math.max.apply(null, rs.map(function (r) { return r.bottom; })),
      left: Math.min.apply(null, rs.map(function (r) { return r.left; })),
      right: Math.max.apply(null, rs.map(function (r) { return r.right; }))
    };
  }

  function isBlock(n) { return n && n.classList && n.classList.contains('lc-block'); }
  function isLabel(n) {
    return n && n.matches && n.matches('.flow-sec, .sec-kicker, .schedule-intro, .lead-in, .mr-sec, .mr-ttl, .mr-cap, .mr-sub, h3, h4');
  }

  function checkSheet(sheet, page, fix) {
    var issues = [];
    var flow = sheet.querySelector('.flow');
    if (!flow) return { issues: issues, nudged: 0 };
    var origin = sheet.getBoundingClientRect();
    var s = origin.width / 794 || 1;
    var fr = rectOf(flow, origin, s);
    var nudged = 0;
    if (flow.scrollHeight > flow.clientHeight + 2) issues.push({ page: page, type: 'clipped', detail: 'content runs past the bottom of the page' });
    var kids = [].slice.call(flow.children).filter(function (k) { return k.offsetHeight > 0; });
    kids.forEach(function (k, i) {
      var r = rectOf(k, origin, s);
      if (r.right > fr.right + 1.5) issues.push({ page: page, type: 'clipped', detail: (k.className || k.tagName) + ' is wider than the page' });
      if (r.left < 30) issues.push({ page: page, type: 'margin', detail: 'content within 30px of the left edge' });
      if (i > 0) {
        var p = rectOf(kids[i - 1], origin, s);
        if (r.top < p.bottom - 1) issues.push({ page: page, type: 'overlap', detail: (kids[i - 1].className || kids[i - 1].tagName) + ' overlaps ' + (k.className || k.tagName) });
      }
    });
    sheet.querySelectorAll('.flow img').forEach(function (img) {
      if (!img.naturalWidth) issues.push({ page: page, type: 'image', detail: 'a figure did not load' });
      var r = rectOf(img, origin, s);
      if (r.bottom > fr.bottom + 1 || r.right > fr.right + 1) issues.push({ page: page, type: 'clipped', detail: 'a figure is cut off' });
    });
    /* Gaps between text and every figure / table wrapper (measured on the visible content). */
    kids.forEach(function (k, i) {
      if (!isBlock(k)) return;
      var ink = inkRect(k, origin, s);
      var prev = kids[i - 1];
      var next = kids[i + 1];
      if (prev && !isBlock(prev)) {
        var pr = rectOf(prev, origin, s);
        var need = isLabel(prev) ? HEAD_GAP : MIN_GAP;
        var gap = ink.top - pr.bottom;
        if (gap < need) {
          if (fix) { k.style.paddingTop = ((parseFloat(getComputedStyle(k).paddingTop) || 0) + (need + 2 - gap)) + 'px'; nudged += 1; }
          else issues.push({ page: page, type: 'gap', detail: 'only ' + Math.round(gap) + 'px above a figure/table' });
        }
      }
      if (next && !isBlock(next)) {
        ink = inkRect(k, origin, s);
        var nr = rectOf(next, origin, s);
        var gap2 = nr.top - ink.bottom;
        if (gap2 < MIN_GAP) {
          if (fix) { k.style.paddingBottom = ((parseFloat(getComputedStyle(k).paddingBottom) || 0) + (MIN_GAP + 2 - gap2)) + 'px'; nudged += 1; }
          else issues.push({ page: page, type: 'gap', detail: 'only ' + Math.round(gap2) + 'px below a figure/table' });
        }
      }
    });
    var foot = sheet.querySelector('.sheet-foot');
    if (foot && kids.length) {
      var last = rectOf(kids[kids.length - 1], origin, s);
      var ft = rectOf(foot, origin, s);
      if (ft.top - last.bottom < FOOT_GAP) issues.push({ page: page, type: 'footer', detail: 'content too close to the footer' });
    }
    /* Orphaned sign-off: a page that holds only the sign-off card. */
    if (kids.length === 1 && kids[0].matches && kids[0].matches('.mr-sign, .signoff')) issues.push({ page: page, type: 'orphan', detail: 'sign-off is alone on its page' });
    return { issues: issues, nudged: nudged };
  }

  /* fix=true nudges gaps; then re-measures. Returns remaining issues and whether a page overflowed. */
  function audit(sheets, fix) {
    var nudged = 0;
    if (fix) sheets.forEach(function (sh, i) { nudged += checkSheet(sh, i + 1, true).nudged; });
    var issues = [];
    sheets.forEach(function (sh, i) { issues = issues.concat(checkSheet(sh, i + 1, false).issues); });
    return { issues: issues, nudged: nudged, pages: sheets.length, overflow: issues.some(function (x) { return x.type === 'clipped' || x.type === 'footer'; }) };
  }

  window.HWTLayoutCheck = { audit: audit };
})();
