'use strict';

(function () {
  var SHEET_H = 1123;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null && text !== '') node.textContent = text;
    return node;
  }

  /* Figures and tables sit inside a padded wrapper (.lc-block) so the gap to body text survives
     margin collapsing and flush-cropped images never touch the text. */
  function wrapBlock(kind, child) {
    var w = el('div', 'lc-block ' + kind);
    if (child) w.appendChild(child);
    return w;
  }

  function footer() {
    var foot = el('footer', 'sheet-foot');
    var co = el('div', 'foot-co');
    co.appendChild(el('strong', '', 'HWT (Pty) Ltd'));
    co.appendChild(document.createTextNode('Unit 8B, Dynagel Road, Mall Interchange, Somerset West, 7110 • Tel 021 881 3014'));
    foot.appendChild(co);
    foot.appendChild(el('div', 'page-no', ''));
    return foot;
  }

  function companyBlock(model) {
    var co = el('div', 'co');
    co.appendChild(el('div', 'eyebrow', 'WATER & EFFLUENT TREATMENT ENGINEERING'));
    co.appendChild(el('div', 'co-name', 'HWT (Pty) Ltd'));
    co.appendChild(el('div', '', 'Unit 8B, Dynagel Road, Mall Interchange'));
    co.appendChild(el('div', '', 'Somerset West, 7110'));
    co.appendChild(el('div', '', 'Tel 021 881 3014'));
    if (model.bee) co.appendChild(el('div', 'bee', model.bee));
    return co;
  }

  function running(model) {
    var run = el('div', 'run');
    var kick = model.proposalType || model.eyebrow || 'HWT';
    run.appendChild(el('div', 'run-kicker', kick));
    if (model.docTitle) run.appendChild(el('div', 'run-title', model.docTitle));
    return run;
  }

  function sheetHead(model, opts) {
    var head = el('div', 'sheet-head');
    if (opts.cover) {
      var top = el('div', 'cover-top');
      var logo = el('img', 'logo');
      logo.src = 'assets/hwt-logo.png';
      logo.alt = 'HWT Water Treatment';
      top.appendChild(logo);
      top.appendChild(companyBlock(model));
      head.appendChild(top);
      var band = el('div', 'band');
      if (model.eyebrow) band.appendChild(el('div', 'eyebrow', model.eyebrow));
      var h = el('h2', '', model.mainTitle || model.docTitle || '');
      if ((model.mainTitle || '').length > 42) h.style.fontSize = '22px';
      if (h.textContent) band.appendChild(h);
      if (model.titleTail) band.appendChild(el('div', 'tail', model.titleTail));
      if (model.proposalType) band.appendChild(el('div', 'ptype', model.proposalType));
      if (band.childNodes.length) head.appendChild(band);
      if (!opts.hero && (model.to || model.from || model.email || model.date)) {
        var meta = el('div', 'meta');
        function row(label, value, field) {
          if (!value) return;
          var p = el('p');
          var s = el('span', '', label);
          p.appendChild(s);
          p.appendChild(document.createTextNode(' ' + value));
          if (field) p.dataset.field = field;
          meta.appendChild(p);
        }
        row('To', model.to, 'to');
        row('From', model.from, 'from');
        row('Email', model.email, 'email');
        row('Date', model.date, 'date');
        head.appendChild(meta);
      }
      return head;
    }
    var inner = el('div', 'inner-top');
    var mark = el('img', 'logo sm');
    mark.src = 'assets/hwt-logo.png';
    mark.alt = '';
    inner.appendChild(mark);
    inner.appendChild(running(model));
    head.appendChild(inner);
    head.appendChild(el('div', 'rule'));
    if (opts.kicker || opts.title) {
      if (opts.kicker) head.appendChild(el('p', 'sec-kicker', opts.kicker));
      var title = el('h2', 'sec-title');
      if (opts.number) title.appendChild(el('span', 'num', opts.number));
      title.appendChild(document.createTextNode(opts.title || ''));
      if (opts.continued) title.appendChild(el('span', 'continued', '  continued'));
      head.appendChild(title);
      head.appendChild(el('div', 'rule'));
    }
    return head;
  }

  function makeSheet(model, opts) {
    var sheet = el('article', 'sheet' + (opts.cover ? ' cover' : ''));
    sheet.appendChild(sheetHead(model, opts));
    sheet.appendChild(el('div', 'flow'));
    sheet.appendChild(footer());
    return sheet;
  }

  function sizeFlow(sheet) {
    var flow = sheet.querySelector('.flow');
    var head = sheet.querySelector('.sheet-head');
    var cs = getComputedStyle(sheet);
    var padT = parseFloat(cs.paddingTop) || 0;
    var padB = parseFloat(cs.paddingBottom) || 0;
    var headH = head ? head.offsetHeight : 0;
    var max = SHEET_H - padT - padB - headH - 8;
    flow.style.maxHeight = Math.max(160, max) + 'px';
    flow.style.overflow = 'hidden';
    return flow;
  }

  function overflows(flow) {
    return flow.scrollHeight > flow.clientHeight + 2;
  }

  function liEl(item) {
    var li = el('li');
    li.appendChild(document.createTextNode(item.text));
    if (item.children && item.children.length) {
      var ul = el('ul');
      item.children.forEach(function (child) {
        ul.appendChild(el('li', '', child));
      });
      li.appendChild(ul);
    }
    return li;
  }

  function quoteCard(model) {
    var card = el('aside', 'quote-card');
    var q = model.quotation;
    card.appendChild(el('div', 'ql', q.label || 'Quotation (excluding VAT)'));
    var amount = el('div', 'qa', q.amount || '');
    amount.dataset.field = 'quote';
    card.appendChild(amount);
    if (model.currencyNote) card.appendChild(el('div', 'qn', model.currencyNote.replace(/\.$/, '')));
    return card;
  }

  function blockEl(block, paraClass) {
    if (block.type === 'p') return el('p', paraClass || 'body-p', block.text);
    var ul = el('ul', 'clean');
    (block.items || []).forEach(function (item) { ul.appendChild(liEl(item)); });
    return ul;
  }

  var SMALL_WORDS = /^(a|an|and|as|at|by|for|in|of|on|or|the|to|with|per|via)$/i;
  /* ALL-CAPS headings read as Title Case; acronyms of 2-3 letters (STP, DWS, PLC) stay upper. */
  function titleCase(text) {
    var t = String(text || '').trim();
    var letters = t.replace(/[^A-Za-z]/g, '');
    if (!letters || letters !== letters.toUpperCase()) return t;
    return t.split(/(\s+)/).map(function (w, i) {
      if (/^\s+$/.test(w)) return w;
      var bare = w.replace(/[^A-Za-z]/g, '');
      if (i > 0 && SMALL_WORDS.test(bare)) return w.toLowerCase();
      if (bare.length <= 3 && !SMALL_WORDS.test(bare) && !/^(ALL|ONE|TWO|NEW|USE|NOT|OUR|BUT|ARE|ITS|HAS|WAS|OFF|OUT|BIG)$/.test(bare)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join('');
  }

  /* A process list with sub-points reads as numbered steps (Option A reference layout). */
  function stepsEl(block) {
    var ol = el('ol', 'steps');
    (block.items || []).forEach(function (item, i) {
      var li = el('li');
      li.appendChild(el('span', 'step-n', String(i + 1)));
      var body = el('div', 'step-b');
      body.appendChild(el('div', 'step-t', item.text));
      if (item.children && item.children.length) {
        var ul = el('ul', 'step-sub');
        item.children.forEach(function (c) { ul.appendChild(el('li', '', c)); });
        body.appendChild(ul);
      }
      li.appendChild(body);
      ol.appendChild(li);
    });
    return ol;
  }

  function isSteps(block) {
    return block.type === 'ul' && (block.items || []).length >= 2
      && (block.items || []).some(function (it) { return it.children && it.children.length; });
  }

  function heroFigure(model) {
    var best = null;
    var bestScore = -1;
    (model.media || []).forEach(function (fig, i) {
      var cap = fig.caption || '';
      if (/flow\s*chart|diagram|schematic|layout|monitor|screen|graph|chart|drawing|p&id/i.test(cap)) return;
      var ratio = fig.w && fig.h ? fig.w / fig.h : 1.4;
      if (ratio < 0.9 || ratio > 2.6) return;
      var score = (cap.match(/plant|container|treatment|render|3d|installation|works|system|unit/gi) || []).length;
      if (score > bestScore) { best = fig; bestScore = score; }
    });
    return best;
  }

  function findText(model, re) {
    var texts = [];
    (model.body || []).forEach(function (b) {
      if (b.type === 'p') texts.push(b.text);
      (b.items || []).forEach(function (it) { texts.push(it.text); (it.children || []).forEach(function (c) { texts.push(c); }); });
    });
    for (var i = 0; i < texts.length; i++) {
      var m = String(texts[i]).match(re);
      if (m) return m;
    }
    return null;
  }

  /* Key facts are short phrases copied as printed; a tile only appears when its phrase is found. */
  function keyFacts(model) {
    var facts = [];
    var flow = findText(model, /design\s+(?:flow|capacity)\s*(?:is|of|:|=)?\s*([\d.,]+\s*(?:m³\/d(?:ay)?|m3\/d(?:ay)?|kl\/d(?:ay)?|klpd|kl|m³|l\/d(?:ay)?|MLD))/i);
    if (flow) facts.push({ value: flow[1].trim(), label: 'Design flow' });
    var limit = findText(model, /compliant\s+with\s+(?:the\s+)?([A-Z][A-Za-z0-9 :\-]{2,40}?(?:Limits?|Standards?|Guidelines?|SANS\s*[\d:\-]+))\b/);
    if (limit) facts.push({ value: limit[1].trim(), label: 'Water quality' });
    (model.terms || []).some(function (t) {
      if (!/deliver|completion|lead\s*time/i.test(t.label || '')) return false;
      var txt = t.value || (t.items || []).join(' ');
      var m = txt.match(/(\d+\s*(?:-\s*\d+\s*)?(?:weeks?|days?|months?))/i);
      if (!m) return false;
      var label = /factory completion period/i.test(txt) ? 'Factory completion period' : titleCase(t.label);
      facts.push({ value: m[1], label: label });
      return true;
    });
    return facts;
  }

  function coverHeroNodes(model, hero) {
    var nodes = [];
    var fig = el('figure', 'hero');
    var img = el('img');
    img.src = hero.dataUrl;
    img.alt = '';
    sizeImg(img, hero, 640, 380);
    fig.appendChild(img);
    nodes.push(wrapBlock('fig-wrap hero-wrap', fig));
    var tiles = el('div', 'tiles');
    function tile(label, value, sub, field) {
      if (!value) return;
      var t = el('div', 'tile');
      t.appendChild(el('div', 'tl', label));
      var v = el('div', 'tv', value);
      if (field) v.dataset.field = field;
      t.appendChild(v);
      if (sub) t.appendChild(el('div', 'ts', sub));
      tiles.appendChild(t);
    }
    tile('To', model.to, model.email, 'to');
    tile('From', model.from, '', 'from');
    tile('Date', model.date, '', 'date');
    if (model.quotation && model.quotation.amount) tile(model.quotation.label || 'Quotation (excluding VAT)', model.quotation.amount, '', 'quote');
    if (tiles.childNodes.length) nodes.push(tiles);
    var facts = keyFacts(model);
    if (facts.length) {
      var row = el('div', 'facts');
      facts.forEach(function (f, i) {
        var box = el('div', 'fact f' + (i % 4));
        box.appendChild(el('div', 'fv', f.value));
        box.appendChild(el('div', 'fl', f.label));
        row.appendChild(box);
      });
      nodes.push(row);
    }
    return nodes;
  }

  /* Letter page after a hero cover: numbered Proposal and Budget sections. */
  function letterNodes(model, counter) {
    var nodes = [];
    if (model.salutation) {
      var sal = el('p', 'salute', model.salutation);
      sal.dataset.field = 'salutation';
      nodes.push(sal);
    }
    model.intro.forEach(function (text) { nodes.push(el('p', 'lede', text)); });
    if (model.body.length) {
      var head = flowHeading('Proposal', counter.next(), titleCase(model.proposalType || 'Proposal'));
      nodes.push(head);
      model.body.forEach(function (block, i) {
        var nextIsList = model.body[i + 1] && model.body[i + 1].type === 'ul';
        var node = isSteps(block) ? wrapBlock('steps-wrap', stepsEl(block)) : blockEl(block, 'body-p');
        if (block.type === 'p' && nextIsList && /:$/.test(block.text.trim())) {
          node.className = 'body-p lead-in';
          node._keep = true;
        }
        nodes.push(node);
      });
    }
    var budgetBlocks = model.budgetBody || [];
    var notes = model.budgetNotes || [];
    var hasBudget = !!(model.budgetHeading || (model.quotation && model.quotation.amount) || budgetBlocks.length || notes.length);
    if (hasBudget) {
      nodes.push(flowHeading('Price', counter.next(), titleCase(model.budgetHeading || 'Budget Proposal')));
      var budget = el('div', 'budget open');
      var left = el('div', 'budget-main');
      if (budgetBlocks.length) {
        budgetBlocks.forEach(function (block) {
          if (block.type === 'ul') {
            var ol = el('ol', 'nums');
            block.items.forEach(function (item) { ol.appendChild(liEl(item)); });
            left.appendChild(ol);
          } else left.appendChild(el('p', 'note', block.text));
        });
      } else {
        notes.forEach(function (text) { left.appendChild(el('p', 'note', text)); });
      }
      if (left.childNodes.length) budget.appendChild(left);
      else budget.classList.add('solo');
      if (model.quotation && model.quotation.amount) budget.appendChild(quoteCard(model));
      budget._withPrev = true;
      nodes.push(budget);
    }
    return nodes;
  }

  function sizeImg(img, fig, maxW, maxH) {
    var w = fig.w || 4;
    var h = fig.h || 3;
    var dh = Math.min(maxH, maxW * h / w);
    var dw = dh * w / h;
    img.style.width = Math.round(dw) + 'px';
    img.style.height = Math.round(dh) + 'px';
    img.style.maxWidth = 'none';
    img.style.maxHeight = 'none';
    img.style.objectFit = 'contain';
  }

  function coverNodes(model) {
    var nodes = [];
    if (model.salutation) {
      var sal = el('p', 'salute', model.salutation);
      sal.dataset.field = 'salutation';
      nodes.push(sal);
    }
    model.intro.forEach(function (text) { nodes.push(el('p', 'lede', text)); });
    model.body.forEach(function (block) { nodes.push(blockEl(block, 'body-p')); });
    var budgetBlocks = model.budgetBody || [];
    var notes = model.budgetNotes || [];
    var hasBudget = !!(model.budgetHeading || (model.quotation && model.quotation.amount) || budgetBlocks.length || notes.length);
    if (hasBudget) {
      var budget = el('div', 'budget');
      var left = el('div', 'budget-main');
      if (model.budgetHeading) left.appendChild(el('h3', '', model.budgetHeading));
      if (budgetBlocks.length) {
        budgetBlocks.forEach(function (block) { left.appendChild(blockEl(block, 'note')); });
      } else {
        notes.forEach(function (text) { left.appendChild(el('p', 'note', text)); });
      }
      if (left.childNodes.length) budget.appendChild(left);
      else budget.classList.add('solo');
      if (model.quotation && model.quotation.amount) budget.appendChild(quoteCard(model));
      /* A lone total must stay with the paragraph that introduces it. */
      if (!left.childNodes.length) budget._withPrev = true;
      nodes.push(budget);
    }
    return nodes;
  }

  function fillCat(td, cat) {
    td.textContent = '';
    var match = String(cat || '').match(/^(.*?)\s+(\([^)]+\))$/);
    if (match) {
      td.appendChild(document.createTextNode(match[1]));
      td.appendChild(document.createElement('br'));
      td.appendChild(document.createTextNode(match[2]));
    } else td.textContent = cat || '';
    td.dataset.filled = '1';
  }

  function ensureCat(tr) {
    var td = tr.querySelector('td.cat');
    if (!td || td.dataset.filled === '1') return;
    var body = tr.parentElement;
    if (!body) return;
    var first = body.querySelector('tr.data');
    if (first === tr) fillCat(td, tr.dataset.cat || '');
  }

  function scheduleTable() {
    var table = el('table', 'schedule');
    var colgroup = document.createElement('colgroup');
    [14, 22, 28, 8, 7, 10, 11].forEach(function (w) {
      var col = document.createElement('col');
      col.style.width = w + '%';
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    [
      ['Category', ''],
      ['Item', ''],
      ['Description', ''],
      ['Units', 'mid'],
      ['Qty', 'mid'],
      ['Rate', 'num'],
      ['Amount', 'num']
    ].forEach(function (pair) {
      hr.appendChild(el('th', pair[1], pair[0].toUpperCase()));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    table.appendChild(document.createElement('tbody'));
    return table;
  }

  function dataRow(group, row, showCat) {
    var tr = document.createElement('tr');
    tr.className = 'data';
    tr.dataset.cat = group.category || '';
    tr.dataset.item = row.item || '';
    tr.dataset.description = row.description || '';
    tr.dataset.units = row.units || '';
    tr.dataset.qty = row.qty || '';
    tr.dataset.rate = row.rate || '';
    tr.dataset.amount = row.amount || '';
    var cat = el('td', 'cat');
    if (showCat) fillCat(cat, group.category || '');
    tr.appendChild(cat);
    tr.appendChild(el('td', 'item', row.item || ''));
    tr.appendChild(el('td', '', row.description || ''));
    tr.appendChild(el('td', 'mid', row.units || ''));
    tr.appendChild(el('td', 'mid', row.qty || ''));
    tr.appendChild(el('td', 'num', row.rate || ''));
    tr.appendChild(el('td', 'num', row.amount || ''));
    return tr;
  }

  function labelRow(className, label, amount) {
    var tr = document.createElement('tr');
    tr.className = className;
    var td = el('td', '', label);
    td.colSpan = 6;
    tr.appendChild(td);
    var amt = el('td', 'num', amount);
    tr.appendChild(amt);
    if (className === 'grand') amt.dataset.field = 'schedule-total';
    if (className === 'subtotal') tr.dataset.subtotal = amount || '';
    return tr;
  }

  function scheduleNodes(model) {
    var nodes = [];
    if (model.scheduleIntro) nodes.push(el('p', 'schedule-intro', model.scheduleIntro));
    var schedule = model.schedule;
    if (!schedule) return nodes;
    if (schedule.fallback) {
      nodes.push(el('pre', 'raw', (schedule.raw || []).join('\n')));
      return nodes;
    }
    schedule.groups.forEach(function (group) {
      group.rows.forEach(function (row, idx) {
        var tr = dataRow(group, row, idx === 0);
        tr.dataset.block = 'row';
        nodes.push(tr);
      });
      if (group.subtotal) {
        nodes.push(labelRow('subtotal', group.subtotal.label || 'Sub-total:', group.subtotal.amount || ''));
      }
    });
    if (schedule.total && schedule.total.amount) {
      nodes.push(labelRow('grand', schedule.total.label || 'Schedule', schedule.total.amount));
    }
    return nodes;
  }

  function dataTable(header, nums) {
    var table = el('table', 'data-table' + ((header || []).length >= 7 ? ' dense' : ''));
    table.dataset.header = JSON.stringify(header || []);
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    (header || []).forEach(function (h, i) {
      hr.appendChild(el('th', nums && nums.charAt(i) === '1' ? 'num' : '', h));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    table.appendChild(document.createElement('tbody'));
    return table;
  }

  function placeNode(flow, node) {
    if (node.tagName === 'TR' && node.dataset.table === 'data') {
      var tables = flow.querySelectorAll('table.data-table');
      var table = tables.length ? tables[tables.length - 1] : null;
      var header = node.dataset.header || '[]';
      if (!table || node.dataset.restart === '1' || table.dataset.header !== header) {
        var parsed = [];
        try { parsed = JSON.parse(header); } catch (err) { parsed = []; }
        table = dataTable(parsed, node.dataset.nums || '');
        flow.appendChild(wrapBlock('tbl-wrap', table));
      }
      table.querySelector('tbody').appendChild(node);
      return;
    }
    if (node.tagName === 'TR') {
      var schedule = flow.querySelector('table.schedule');
      if (!schedule) {
        schedule = scheduleTable();
        flow.appendChild(wrapBlock('tbl-wrap', schedule));
      }
      schedule.querySelector('tbody').appendChild(node);
      ensureCat(node);
    } else {
      flow.appendChild(node);
    }
  }

  function detachNode(node) {
    if (node.parentElement) node.parentElement.removeChild(node);
  }

  function dropEmptyTable(flow) {
    flow.querySelectorAll('table.schedule, table.data-table').forEach(function (table) {
      if (table.querySelector('tbody tr')) return;
      var w = table.parentElement;
      if (w && w.classList.contains('tbl-wrap')) w.remove(); else table.remove();
    });
  }

  function detachKeep(flow) {
    var carry = [];
    while (flow.lastElementChild && flow.lastElementChild._keep) {
      carry.unshift(flow.lastElementChild);
      detachNode(flow.lastElementChild);
    }
    return carry;
  }

  function paginate(mount, model, opts, nodes) {
    var sheets = [];
    function addSheet(continued) {
      var sheet = makeSheet(model, {
        cover: !!opts.cover && !continued,
        hero: !!opts.hero,
        kicker: opts.kicker,
        number: opts.number,
        title: opts.title,
        continued: continued
      });
      var frame = el('div', 'frame');
      frame.appendChild(sheet);
      mount.appendChild(frame);
      sizeFlow(sheet);
      sheets.push(sheet);
      return sheet;
    }
    if (!nodes.length) return sheets;
    var sheet = addSheet(false);
    var flow = sheet.querySelector('.flow');
    function isRow(n) { return n && n.tagName === 'TR'; }
    function isDataRow(n) {
      return isRow(n) && (n.classList.contains('data') || (n.dataset.table === 'data' && !n.classList.contains('sum')));
    }
    function sameTable(a, b) {
      return (a.dataset.table || '') === (b.dataset.table || '') && (a.dataset.header || '') === (b.dataset.header || '');
    }
    nodes.forEach(function (node, idx) {
      placeNode(flow, node);
      if (!overflows(flow)) return;
      detachNode(node);
      /* Table splits: never leave 1-2 rows at the foot of a page (orphan) or carry fewer
         than 3 rows onto the next page (widow). */
      var rows = [];
      if (isRow(node)) {
        var wrap = flow.lastElementChild;
        var tb = wrap && wrap.classList && wrap.classList.contains('tbl-wrap') ? wrap.querySelector('tbody') : null;
        if (tb) {
          var here = tb.children.length;
          /* Count real line items (not sub-total / total rows) going to the next page. */
          var ahead = isDataRow(node) ? 1 : 0;
          for (var k = idx + 1; k < nodes.length && isRow(nodes[k]) && nodes[k].dataset.restart !== '1' && sameTable(nodes[k], node); k++) {
            if (isDataRow(nodes[k])) ahead += 1;
          }
          if (here < 3) rows = [].slice.call(tb.children);
          else if (ahead < 2) {
            var kids = [].slice.call(tb.children);
            var need = 2 - ahead;
            while (need > 0 && kids.length > 3) {
              var last = kids.pop();
              rows.unshift(last);
              if (isDataRow(last)) need -= 1;
            }
          }
          rows.forEach(detachNode);
          if (rows.length) {
            var td0 = rows[0].querySelector('td.cat');
            if (td0 && rows[0].classList.contains('data')) { td0.textContent = ''; td0.dataset.filled = ''; }
          }
        }
      }
      dropEmptyTable(flow);
      var carry = detachKeep(flow).concat(rows);
      if (node._withPrev && flow.lastElementChild) {
        var prev = flow.lastElementChild;
        if (prev.offsetHeight && prev.offsetHeight < flow.clientHeight * 0.7) {
          carry.unshift(prev);
          detachNode(prev);
        }
      }
      dropEmptyTable(flow);
      if (!flow.childNodes.length && !carry.length) {
        placeNode(flow, node);
        return;
      }
      if (!flow.children.length && carry.length) {
        /* Moving everything would leave an empty page: keep what was here, move only this node. */
        carry.forEach(function (c) { placeNode(flow, c); });
        carry = [];
      }
      sheet = addSheet(true);
      flow = sheet.querySelector('.flow');
      carry.forEach(function (c) { placeNode(flow, c); });
      if (node.tagName === 'TR' && node.classList.contains('data') && !rows.length) {
        var td = node.querySelector('td.cat');
        if (td) { td.textContent = ''; td.dataset.filled = ''; }
      }
      placeNode(flow, node);
    });
    return sheets;
  }

  function mediaNodes(model) {
    return model.media.map(function (fig) {
      var card = el('figure', 'media-card');
      var img = el('img');
      img.src = fig.dataUrl;
      img.alt = '';
      /* Fixed box from the cropped figure's aspect ratio, so pagination measures real heights
         before the image has decoded (otherwise later figures overflow and get clipped). */
      sizeImg(img, fig, 656, 290);
      card.appendChild(img);
      if (fig.caption) {
        var cap = el('figcaption', 'cap');
        cap.appendChild(el('span', 'caret'));
        cap.appendChild(document.createTextNode(fig.caption));
        card.appendChild(cap);
      }
      return wrapBlock('fig-wrap', card);
    });
  }

  function termNodes(model) {
    return model.terms.map(function (term) {
      if (term.raw) return el('pre', 'raw', term.value);
      var row = el('div', 'term');
      row.appendChild(el('div', 'term-label', term.label));
      var value = el('div', 'term-value');
      row.dataset.label = term.label;
      var items = term.items || [];
      if (items.length > 1) {
        var ul = el('ul', 'clean term-list');
        items.forEach(function (item) { ul.appendChild(el('li', '', item)); });
        value.appendChild(ul);
      } else {
        value.textContent = items.length ? items[0] : (term.value || '');
      }
      row.appendChild(value);
      return row;
    });
  }

  function labNodes(model) {
    var nodes = [];
    model.labs.forEach(function (group) {
      var code = el('div', 'lab-code', group.code || 'Sampling list');
      code._keep = true;
      nodes.push(code);
      group.items.forEach(function (item) {
        var row = el('div', 'lab-item', item);
        row.dataset.lab = item;
        nodes.push(row);
      });
    });
    return nodes;
  }

  function numericCols(rows, width) {
    var flags = [];
    for (var i = 0; i < width; i++) {
      var n = 0;
      var d = 0;
      rows.forEach(function (r) {
        if (r.summary) return;
        var c = ((r.cells || [])[i] || '').trim();
        if (!c) return;
        d += 1;
        if (/^[\d,.\s]+$/.test(c)) n += 1;
      });
      flags.push(d > 0 && n / d >= 0.6);
    }
    return flags;
  }

  function summaryParts(row) {
    var joined = row.raw || (row.cells || []).filter(Boolean).join(' ');
    var m = String(joined).match(/^(.*?\D)\s*(\d[\d,]*\d|\d)\s*$/);
    if (!m) return { label: joined, amount: '' };
    return { label: m[1].trim(), amount: m[2] };
  }

  function tableRowNodes(block) {
    var header = block.header || [];
    var rows = block.rows || [];
    var nums = numericCols(rows, header.length);
    var numStr = nums.map(function (v) { return v ? '1' : '0'; }).join('');
    var headerJson = JSON.stringify(header);
    return rows.map(function (r, idx) {
      var tr = document.createElement('tr');
      tr.dataset.table = 'data';
      tr.dataset.header = headerJson;
      tr.dataset.nums = numStr;
      if (idx === 0) tr.dataset.restart = '1';
      if (r.summary) {
        tr.className = 'sum';
        var parts = summaryParts(r);
        var label = el('td', '', parts.label);
        label.colSpan = parts.amount && header.length > 1 ? header.length - 1 : header.length;
        tr.appendChild(label);
        if (parts.amount && header.length > 1) tr.appendChild(el('td', 'num', parts.amount));
        return tr;
      }
      header.forEach(function (_, i) {
        var text = (r.cells || [])[i] || '';
        tr.appendChild(el('td', nums[i] && text ? 'num' : '', text));
      });
      return tr;
    });
  }

  function extraNodes(extra) {
    if (extra.blocks && extra.blocks.length) {
      var nodes = [];
      extra.blocks.forEach(function (b, i) {
        if (b.type === 'table') nodes.push.apply(nodes, tableRowNodes(b));
        else if (i > 0 && extra.blocks[i - 1].type === 'table' && /[A-Za-z].*:\s*\d/.test(b.text)) {
          /* "Installed Power (...): 13 (kW)" under a table reads as a highlighted total. */
          nodes.push(el('p', 'extra-p callout', b.text));
        } else nodes.push(el('p', 'extra-p', b.text));
      });
      return nodes;
    }
    return (extra.paragraphs || []).map(function (text) { return el('p', 'extra-p', text); });
  }

  function flowHeading(kicker, number, title) {
    var box = el('div', 'flow-sec');
    box._keep = true;
    if (kicker) box.appendChild(el('p', 'sec-kicker', kicker));
    var h = el('h3', 'flow-sec-title');
    if (number) h.appendChild(el('span', 'num', number));
    h.appendChild(document.createTextNode(title || ''));
    box.appendChild(h);
    return box;
  }

  /* Place nodes on an existing sheet. If any of them overflow, put the nodes back and report failure. */
  function tryAppend(sheet, nodes) {
    var flow = sheet.querySelector('.flow');
    var marker = document.createComment('append');
    flow.appendChild(marker);
    var ok = true;
    nodes.forEach(function (node) {
      if (!ok) return;
      placeNode(flow, node);
      if (overflows(flow)) ok = false;
    });
    var kids = [].slice.call(flow.childNodes);
    var start = kids.indexOf(marker);
    if (!ok) {
      for (var i = kids.length - 1; i > start; i--) {
        var node = kids[i];
        if (node.tagName === 'TABLE' || (node.classList && node.classList.contains('tbl-wrap'))) {
          [].slice.call(node.querySelectorAll('tbody tr')).forEach(function (tr) { detachNode(tr); });
        }
        detachNode(node);
      }
    }
    if (marker.parentNode) marker.parentNode.removeChild(marker);
    dropEmptyTable(flow);
    return ok;
  }

  function sectionSpec(model, kind, index) {
    var number = String(index).padStart(2, '0');
    if (kind === 'media') {
      return { kicker: model.eyebrow || 'Figures', number: number, title: 'Media', nodes: mediaNodes(model) };
    }
    if (kind === 'schedule') {
      return {
        kicker: model.budgetHeading || 'Quotation',
        number: number,
        title: 'Schedule of Quantities',
        nodes: scheduleNodes(model)
      };
    }
    if (kind === 'terms') {
      return { kicker: 'Commercial', number: number, title: 'General Terms and Conditions', nodes: termNodes(model) };
    }
    if (kind === 'lab') {
      return { kicker: 'Analysis', number: number, title: 'Laboratory Sampling', nodes: labNodes(model) };
    }
    return null;
  }

  async function decodeImages(root) {
    var imgs = root.querySelectorAll('img');
    var waits = [];
    imgs.forEach(function (img) {
      if (img.complete && img.naturalWidth) return;
      waits.push(new Promise(function (resolve) {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      }));
    });
    if (waits.length) await Promise.all(waits);
  }

  async function renderDocument(model, mount) {
    mount.textContent = '';
    var sheets = [];
    var sectionIndex = 1;
    var hero = heroFigure(model);
    if (hero) {
      sheets.push.apply(sheets, paginate(mount, model, { cover: true, hero: true }, coverHeroNodes(model, hero)));
      var counter = { next: function () { var n = String(sectionIndex).padStart(2, '0'); sectionIndex += 1; return n; } };
      sheets.push.apply(sheets, paginate(mount, model, {}, letterNodes(model, counter)));
    } else {
      sheets.push.apply(sheets, paginate(mount, model, { cover: true }, coverNodes(model)));
    }
    var extras = model.extras.slice();
    var extraBuf = [];
    function takeExtra(token) {
      var title = token.slice(6);
      var extra = extras.shift() || { title: title, paragraphs: [] };
      var number = String(sectionIndex).padStart(2, '0');
      sectionIndex += 1;
      return { title: titleCase(extra.title || title), number: number, nodes: extraNodes(extra) };
    }
    function paginateExtra(entry) {
      if (!entry.nodes.length) return;
      var built = paginate(mount, model, {
        kicker: 'Notes',
        number: entry.number,
        title: entry.title
      }, entry.nodes);
      sheets.push.apply(sheets, built);
    }
    /* Short note sections share a page when the next one fits, so a table is not followed by a blank region. */
    function flushExtras() {
      if (!extraBuf.length) return;
      paginateExtra(extraBuf[0]);
      for (var i = 1; i < extraBuf.length; i++) {
        var entry = extraBuf[i];
        var pack = [flowHeading('Notes', entry.number, entry.title)].concat(entry.nodes);
        var host = sheets[sheets.length - 1];
        if (host && entry.nodes.length && tryAppend(host, pack)) continue;
        paginateExtra(entry);
      }
      extraBuf = [];
    }
    model.flow.forEach(function (token) {
      if (token.indexOf('extra:') === 0) {
        extraBuf.push(takeExtra(token));
        return;
      }
      flushExtras();
      var spec = sectionSpec(model, token, sectionIndex);
      if (!spec || !spec.nodes.length) return;
      var built = paginate(mount, model, spec, spec.nodes);
      sheets.push.apply(sheets, built);
      sectionIndex += 1;
    });
    flushExtras();
    var total = sheets.length;
    sheets.forEach(function (sheet, i) {
      var slot = sheet.querySelector('.page-no');
      if (slot) slot.textContent = 'Page ' + (i + 1) + ' of ' + total;
    });
    await decodeImages(mount);
    return sheets;
  }

  window.HWTRender = { renderDocument: renderDocument };
})();
