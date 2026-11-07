'use strict';

(function () {
  var SHEET_H = 1123;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null && text !== '') node.textContent = text;
    return node;
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
      if (model.to || model.from || model.email || model.date) {
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

  function coverNodes(model) {
    var nodes = [];
    if (model.salutation) {
      var sal = el('p', 'salute', model.salutation);
      sal.dataset.field = 'salutation';
      nodes.push(sal);
    }
    model.intro.forEach(function (text) { nodes.push(el('p', 'lede', text)); });
    model.body.forEach(function (block) {
      if (block.type === 'p') nodes.push(el('p', 'body-p', block.text));
      else {
        var ul = el('ul', 'clean');
        block.items.forEach(function (item) { ul.appendChild(liEl(item)); });
        nodes.push(ul);
      }
    });
    if (model.budgetHeading || model.quotation || (model.budgetNotes && model.budgetNotes.length)) {
      var budget = el('div', 'budget');
      var left = el('div');
      if (model.budgetHeading) left.appendChild(el('h3', '', model.budgetHeading));
      (model.budgetNotes || []).forEach(function (text) {
        left.appendChild(el('p', 'note', text));
      });
      budget.appendChild(left);
      if (model.quotation && model.quotation.amount) budget.appendChild(quoteCard(model));
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

  function placeNode(flow, node) {
    if (node.tagName === 'TR') {
      var table = flow.querySelector('table.schedule');
      if (!table) {
        table = scheduleTable();
        flow.appendChild(table);
      }
      table.querySelector('tbody').appendChild(node);
      ensureCat(node);
    } else {
      flow.appendChild(node);
    }
  }

  function detachNode(node) {
    if (node.parentElement) node.parentElement.removeChild(node);
  }

  function dropEmptyTable(flow) {
    var table = flow.querySelector('table.schedule');
    if (table && !table.querySelector('tbody tr')) table.remove();
  }

  function paginate(mount, model, opts, nodes) {
    var sheets = [];
    function addSheet(continued) {
      var sheet = makeSheet(model, {
        cover: !!opts.cover && !continued,
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
    nodes.forEach(function (node) {
      placeNode(flow, node);
      if (!overflows(flow)) return;
      detachNode(node);
      var prev = null;
      if (node.classList && node.classList.contains('lab-item')) {
        var last = flow.lastElementChild;
        if (last && last.classList.contains('lab-code')) {
          prev = last;
          detachNode(prev);
        }
      }
      dropEmptyTable(flow);
      if (!flow.childNodes.length && !prev) {
        placeNode(flow, node);
        return;
      }
      sheet = addSheet(true);
      flow = sheet.querySelector('.flow');
      if (prev) placeNode(flow, prev);
      if (node.tagName === 'TR' && node.classList.contains('data')) {
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
      card.appendChild(img);
      if (fig.caption) {
        var cap = el('figcaption', 'cap');
        cap.appendChild(el('span', 'caret'));
        cap.appendChild(document.createTextNode(fig.caption));
        card.appendChild(cap);
      }
      return card;
    });
  }

  function termNodes(model) {
    return model.terms.map(function (term) {
      if (term.raw) return el('pre', 'raw', term.value);
      var row = el('div', 'term');
      row.appendChild(el('div', 'term-label', term.label));
      var value = el('div', 'term-value', term.value);
      row.dataset.label = term.label;
      row.appendChild(value);
      return row;
    });
  }

  function labNodes(model) {
    var nodes = [];
    model.labs.forEach(function (group) {
      if (group.code) nodes.push(el('div', 'lab-code', group.code));
      else nodes.push(el('div', 'lab-code', 'Sampling list'));
      group.items.forEach(function (item) {
        var row = el('div', 'lab-item', item);
        row.dataset.lab = item;
        nodes.push(row);
      });
    });
    return nodes;
  }

  function extraNodes(extra) {
    return extra.paragraphs.map(function (text) { return el('p', 'extra-p', text); });
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
    var cover = paginate(mount, model, { cover: true }, coverNodes(model));
    sheets.push.apply(sheets, cover);
    var sectionIndex = 1;
    var extras = model.extras.slice();
    model.flow.forEach(function (token) {
      if (token.indexOf('extra:') === 0) {
        var title = token.slice(6);
        var extra = extras.shift() || { title: title, paragraphs: [] };
        var nodes = extraNodes(extra);
        var built = paginate(mount, model, {
          kicker: 'Notes',
          number: String(sectionIndex).padStart(2, '0'),
          title: extra.title || title
        }, nodes);
        if (built.length) sectionIndex += 1;
        sheets.push.apply(sheets, built);
        return;
      }
      var spec = sectionSpec(model, token, sectionIndex);
      if (!spec || !spec.nodes.length) return;
      var built = paginate(mount, model, spec, spec.nodes);
      sheets.push.apply(sheets, built);
      sectionIndex += 1;
    });
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
