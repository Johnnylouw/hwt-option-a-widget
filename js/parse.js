'use strict';

/* Parse wkhtmltopdf HWT letters into a structured model.
   Amounts are copied as printed. Nothing in here multiplies qty by rate. */

(function () {
  function isUpper(text) {
    const letters = String(text).replace(/[^A-Za-z]/g, '');
    return letters.length >= 4 && letters === letters.toUpperCase();
  }

  function cleanJoin(text) {
    return String(text).replace(/\s+/g, ' ').trim();
  }

  function joinParts(items) {
    const sorted = items.slice().sort(function (a, b) { return a.x - b.x; });
    let out = '';
    let prev = null;
    sorted.forEach(function (it) {
      const str = it.str || '';
      if (!str) return;
      if (prev == null) {
        out = str;
      } else if (/\s$/.test(prev.str) || /^\s/.test(str)) {
        out += str;
      } else {
        const gap = it.x - (prev.x + (prev.w || 0));
        const thresh = Math.max(0.9, (prev.fontSize || 8) * 0.15);
        out += (gap > thresh ? ' ' : '') + str;
      }
      prev = it;
    });
    return cleanJoin(out);
  }

  function clusterLines(items) {
    const sorted = items.slice().sort(function (a, b) {
      return a.base - b.base || a.x - b.x;
    });
    const lines = [];
    sorted.forEach(function (it) {
      const last = lines[lines.length - 1];
      const tol = Math.max(2.2, Math.min(it.fontSize || 8, last ? last.fontSize : 8) * 0.45);
      if (last && Math.abs(it.base - last.base) <= tol) {
        last.items.push(it);
        last.base = (last.base * (last.items.length - 1) + it.base) / last.items.length;
      } else {
        lines.push({
          base: it.base,
          y: it.y,
          h: it.h || it.fontSize || 8,
          fontSize: it.fontSize || 8,
          items: [it],
          pageNumber: it.pageNumber
        });
      }
    });
    lines.forEach(function (line) {
      line.items.sort(function (a, b) { return a.x - b.x; });
      line.x = line.items[0].x;
      line.y = Math.min.apply(null, line.items.map(function (it) { return it.y; }));
      line.h = Math.max.apply(null, line.items.map(function (it) { return it.h || it.fontSize || 8; }));
      line.fontSize = Math.max.apply(null, line.items.map(function (it) { return it.fontSize || 8; }));
      line.bold = line.items.some(function (it) { return it.bold; });
      line.text = joinParts(line.items);
      line.pageNumber = line.items[0].pageNumber;
    });
    return lines.filter(function (line) { return line.text; });
  }

  function knownHeading(text) {
    const t = cleanJoin(text).replace(/:$/, '').toUpperCase();
    if (t === 'MEDIA' || t === 'FIGURES' || t === 'IMAGES') return 'media';
    if (t === 'SCHEDULE OF QUANTITIES' || t === 'SCHEDULE OF RATES' || t === 'PRICED SCHEDULE') return 'schedule';
    if (t === 'GENERAL TERMS AND CONDITIONS' || t === 'TERMS AND CONDITIONS') return 'terms';
    if (t === 'LABORATORY SAMPLING' || t === 'LABORATORY ANALYSIS' || t === 'SAMPLING SCHEDULE') return 'lab';
    return null;
  }

  function headingOf(line) {
    const known = knownHeading(line.text);
    if (known) return known;
    if (line.y < 76 && isUpper(line.text) && line.text.length > 10 && line.text.length < 70) {
      return 'extra';
    }
    return null;
  }

  function isFigurePage(page) {
    if (!page.images.length) return false;
    const lines = page.lines.filter(function (l) { return !knownHeading(l.text); });
    if (lines.length > 8) return false;
    if (lines.some(function (l) { return l.text.length > 90; })) return false;
    if (lines.some(function (l) { return /^(Dear|To)\b/.test(l.text) || /quotation/i.test(l.text); })) return false;
    return true;
  }

  function prepare(page, notes) {
    const items = (page.items || []).map(function (it) {
      return Object.assign({ pageNumber: page.pageNumber }, it);
    });
    const height = page.height || 842;
    const bodyItems = items.filter(function (it) {
      // Running footer sits on a baseline about 48pt above the page bottom.
      if (it.base >= height - 48) return false;
      return true;
    });
    let lines = clusterLines(bodyItems);
    lines = lines.filter(function (line) {
      if (line.base >= height - 48) return false;
      if (/page\s+\d+\s+of\s+\d+/i.test(line.text)) return false;
      return true;
    });
    const anchor = lines.find(function (l) {
      return l.y < 280 && (l.text === 'To' || /^To\b/.test(l.text) || /^Dear\b/.test(l.text));
    });
    if (anchor) lines = lines.filter(function (l) { return l.y >= anchor.y - 4; });

    const images = (page.images || []).filter(function (im) {
      if (im.w < 70 || im.h < 70) return false;
      if (im.y < 140 && im.h < 90) return false;
      return true;
    }).map(function (im) {
      return Object.assign({ pageNumber: page.pageNumber }, im);
    });

    if (!lines.length && !images.length) {
      notes.push({
        level: 'info',
        text: 'Source page ' + page.pageNumber + ' only had a footer, so it was left out.'
      });
      return null;
    }
    return {
      pageNumber: page.pageNumber,
      width: page.width,
      height: height,
      items: bodyItems,
      lines: lines,
      images: images
    };
  }

  function splitSections(prepared) {
    const sections = [];
    function open(kind, title) {
      const last = sections[sections.length - 1];
      if (last && last.kind === kind && (kind !== 'extra' || last.title === (title || ''))) return last;
      const sec = { kind: kind, title: title || '', lines: [], images: [], items: [] };
      sections.push(sec);
      return sec;
    }
    open('letter', '');
    prepared.forEach(function (page) {
      if (isFigurePage(page)) {
        const sec = open('media', '');
        page.lines.forEach(function (line) {
          if (!knownHeading(line.text)) sec.lines.push(line);
        });
        sec.images.push.apply(sec.images, page.images);
        sec.items.push.apply(sec.items, page.items);
        return;
      }
      let sec = sections[sections.length - 1];
      page.lines.forEach(function (line) {
        const kind = headingOf(line);
        if (kind) {
          sec = open(kind, kind === 'extra' ? line.text : '');
          return;
        }
        sec.lines.push(line);
      });
      if (page.images.length) {
        const dest = sec.kind === 'media' ? sec : open('media', '');
        dest.images.push.apply(dest.images, page.images);
      }
      sec.items.push.apply(sec.items, page.items);
    });
    return sections;
  }

  function findPhrase(blob, re) {
    const m = blob.match(re);
    return m ? m[0] : null;
  }

  function splitTitle(title) {
    const t = cleanJoin(title);
    const bracket = t.match(/^(.*?)(\s*\[[^\]]+\].*)$/);
    let head = t;
    let tail = '';
    if (bracket && bracket[1].trim()) {
      head = bracket[1].trim();
      tail = bracket[2].trim();
    }
    const anchors = [
      'WASTE WATER TREATMENT WORKS',
      'WASTEWATER TREATMENT WORKS',
      'WATER TREATMENT WORKS',
      'EFFLUENT TREATMENT WORKS',
      'SEWAGE TREATMENT WORKS',
      'WATER TREATMENT PLANT',
      'TREATMENT WORKS'
    ];
    const upper = head.toUpperCase();
    for (let i = 0; i < anchors.length; i++) {
      const at = upper.indexOf(anchors[i]);
      if (at >= 0) {
        return {
          eyebrow: head.slice(0, at).trim(),
          main: head.slice(at, at + anchors[i].length).trim(),
          tail: tail
        };
      }
    }
    const words = head.split(/\s+/);
    if (words.length >= 6) {
      return { eyebrow: words.slice(0, 2).join(' '), main: words.slice(2).join(' '), tail: tail };
    }
    return { eyebrow: '', main: head, tail: tail };
  }

  function isBudgetHeading(text) {
    if (!isUpper(text) || text.length > 90) return false;
    const u = text.toUpperCase();
    if (/\b(BUDGET|ANNUAL FEE)\b/.test(u)) return true;
    if (/^QUOTATION\b/.test(u) && text.length < 48) return true;
    return false;
  }

  function pickTitles(lines) {
    const upper = lines.filter(function (l) {
      return isUpper(l.text) && l.text.length > 12 && !knownHeading(l.text);
    });
    const budget = upper.find(function (l) { return isBudgetHeading(l.text); }) || null;
    const rest = upper.filter(function (l) { return l !== budget; });
    rest.sort(function (a, b) { return b.text.length - a.text.length; });
    const titleLine = rest[0] || null;
    const proposalLine = rest.find(function (l) {
      return l !== titleLine && /PROPOSAL/.test(l.text.toUpperCase()) && !isBudgetHeading(l.text);
    }) || null;
    return { titleLine: titleLine, proposalLine: proposalLine, budgetLine: budget };
  }

  function valueAfterLabel(items, label) {
    const labs = items.filter(function (it) {
      return it.str.trim() === label && it.y > 120 && it.y < 280;
    });
    if (!labs.length) return '';
    const lab = labs[0];
    const stop = { To: 1, From: 1, Email: 1, Date: 1 };
    const same = items.filter(function (it) {
      return Math.abs(it.base - lab.base) < 3 && it.x > lab.x + 1;
    }).sort(function (a, b) { return a.x - b.x; });
    const parts = [];
    for (let i = 0; i < same.length; i++) {
      const token = same[i].str.trim();
      if (stop[token] && same[i].x > lab.x + 8) break;
      parts.push(same[i]);
    }
    return joinParts(parts);
  }

  function parseMeta(items, lines) {
    const meta = {
      to: valueAfterLabel(items, 'To'),
      from: valueAfterLabel(items, 'From'),
      email: valueAfterLabel(items, 'Email'),
      date: valueAfterLabel(items, 'Date')
    };
    lines.forEach(function (line) {
      if (line.y > 280) return;
      if (!meta.to) {
        const m = line.text.match(/\bTo\s+(.+?)(?:\s+From\s+|$)/i);
        if (m) meta.to = cleanJoin(m[1]);
      }
      if (!meta.from) {
        const m = line.text.match(/\bFrom\s+(.+?)(?:\s+Date\s+|$)/i);
        if (m) meta.from = cleanJoin(m[1]);
      }
      if (!meta.email) {
        const m = line.text.match(/\bEmail\s+(\S+@\S+)/i);
        if (m) meta.email = m[1].replace(/[;,]+$/, '');
      }
      if (!meta.date) {
        const m = line.text.match(/\bDate\s+(.+)$/i);
        if (m) meta.date = cleanJoin(m[1]);
      }
    });
    return meta;
  }

  const MARKER_RE = /^\s*(?:[•·▪‣◦●○■□►▸➢✓\uf0b7\uf0a7]|[-–—*](?=\s)|\(?(?:\d{1,2}|[a-zA-Z]|[ivxIVX]{1,4})[.)](?=\s))\s*/;

  function hasMarker(text) {
    return MARKER_RE.test(String(text));
  }

  function stripBullet(text) {
    return String(text).replace(MARKER_RE, '').replace(/^_+|_+$/g, '').trim();
  }

  function lineRight(line) {
    if (!line || !line.items || !line.items.length) return null;
    return Math.max.apply(null, line.items.map(function (it) { return it.x + (it.w || 0); }));
  }

  /* Sentence case + terminal full stop for list items. */
  function tidyItem(text) {
    let t = cleanJoin(String(text).replace(/^_+|_+$/g, ''));
    if (!t) return t;
    t = t.charAt(0).toUpperCase() + t.slice(1);
    if (!/[.!?:;)]$/.test(t)) t += '.';
    else if (/[;,]$/.test(t)) t = t.slice(0, -1) + '.';
    return t;
  }

  const MAX_WORDS = 40;
  const CLAUSE_CUES = /\s(?=(?:two|three|four|five|six|one|biological|removal|treatment|disinfection|flow and|re-use|reuse|safe|dust|water quality|grinder|the treated|all|it is|this|these)\b)/gi;

  function wordCount(t) { return String(t).trim().split(/\s+/).filter(Boolean).length; }

  /* Split an over-long bullet on sensible clause boundaries, nearest to the middle. */
  function splitLong(text) {
    const t = cleanJoin(text);
    if (wordCount(t) <= MAX_WORDS) return [t];
    const words = t.split(' ');
    const mid = t.length / 2;
    const tiers = [/[;.](?=\s)/g, /,(?=\s)/g, CLAUSE_CUES, /\s(?=(?:and|which|where|while|whereafter|from where)\s)/gi];
    for (let k = 0; k < tiers.length; k++) {
      const re = new RegExp(tiers[k].source, tiers[k].flags);
      let best = -1, dist = Infinity, m;
      while ((m = re.exec(t))) {
        const at = m.index + (/[;.,]/.test(m[0]) ? 1 : 0);
        const a = t.slice(0, at), b = t.slice(at);
        if (wordCount(a) < 4 || wordCount(b) < 4) continue;
        const d = Math.abs(at - mid);
        if (d < dist) { dist = d; best = at; }
        if (m[0] === '') re.lastIndex++;
      }
      if (best > 0) {
        return splitLong(t.slice(0, best).replace(/[;,]$/, '')).concat(splitLong(t.slice(best)));
      }
    }
    const half = Math.ceil(words.length / 2);
    return [words.slice(0, half).join(' '), words.slice(half).join(' ')];
  }

  function finishItems(list) {
    const out = [];
    list.forEach(function (item) {
      const kids = [];
      item.children.forEach(function (c) { splitLong(c).forEach(function (x) { kids.push(tidyItem(x)); }); });
      const parts = splitLong(item.text).map(tidyItem);
      parts.forEach(function (text, i) {
        out.push({ text: text, children: i === parts.length - 1 ? kids : [] });
      });
    });
    return out;
  }

  function clusterX(xs) {
    const sorted = xs.slice().sort(function (a, b) { return a - b; });
    const groups = [];
    sorted.forEach(function (x) {
      const g = groups[groups.length - 1];
      if (!g || x - g.max > 8) groups.push({ x: x, max: x, n: 1, sum: x });
      else {
        g.n += 1;
        g.sum += x;
        g.max = x;
        g.x = g.sum / g.n;
      }
    });
    return groups;
  }

  function buildBlocks(lines) {
    if (!lines.length) return [];
    const clusters = clusterX(lines.map(function (l) { return l.x; }));
    function kind(line) {
      if (clusters.length < 2) return 'p';
      let best = 0;
      let dist = Infinity;
      clusters.forEach(function (c, i) {
        const d = Math.abs(line.x - c.x);
        if (d < dist) { dist = d; best = i; }
      });
      if (clusters.length === 2) return best === 0 ? 'p' : 'li';
      if (best === 0) return 'p';
      if (best === clusters.length - 1) return 'nested';
      return 'li';
    }
    const kinds = lines.map(kind);
    const blocks = [];
    let list = null;
    function close() {
      if (list) {
        blocks.push({ type: 'ul', items: finishItems(list) });
        list = null;
      }
    }
    function tight(i) {
      if (i === 0) return false;
      const dy = lines[i].base - lines[i - 1].base;
      const size = lines[i].fontSize || 9;
      return dy < Math.min(16, Math.max(12, size * 1.5));
    }
    const rights = lines.map(lineRight).filter(function (r) { return r != null; });
    const maxRight = rights.length ? Math.max.apply(null, rights) : null;
    function wrapped(j) {
      const r = lineRight(lines[j]);
      if (r == null || maxRight == null) return true;
      const left = Math.min.apply(null, lines.map(function (l) { return l.x; }));
      return (r - left) >= 0.82 * (maxRight - left);
    }
    /* A wrapped line runs to (near) the right margin; a short line ended its item. */
    function continues(i, text) {
      if (i === 0) return false;
      if (hasMarker(lines[i].text)) return false;
      if (!tight(i)) return false;
      if (!/^[a-z(]/.test(text)) return false;
      const prev = lines[i - 1];
      if (/[.!?;:]$/.test(prev.text.trim())) return false;
      const r = lineRight(prev);
      if (r == null || maxRight == null) return true;
      const left = Math.min.apply(null, lines.map(function (l) { return l.x; }));
      return (r - left) >= 0.82 * (maxRight - left);
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const k = kinds[i];
      if (k === 'nested') {
        const text = stripBullet(line.text);
        if (!list) list = [];
        if (!list.length) list.push({ text: text, children: [] });
        else if (continues(i, text) && list[list.length - 1].children.length) {
          const ch = list[list.length - 1].children;
          ch[ch.length - 1] += ' ' + text;
        } else list[list.length - 1].children.push(text);
        continue;
      }
      if (k === 'li') {
        const text = stripBullet(line.text);
        if (!list) list = [];
        if (list.length && continues(i, text)) list[list.length - 1].text += ' ' + text;
        else list.push({ text: text, children: [] });
        continue;
      }
      if (hasMarker(line.text)) {
        if (!list) list = [];
        list.push({ text: stripBullet(line.text), children: [] });
        continue;
      }
      const text = line.text.trim();
      const words = text.split(/\s+/).length;
      const short = words <= 6 && !/[.;:!?]$/.test(text);
      const next = kinds[i + 1];
      const prev = i > 0 ? kinds[i - 1] : null;
      if (short && next && next !== 'p' && prev && prev !== 'p') {
        if (!list) list = [];
        list.push({ text: text, children: [] });
        continue;
      }
      if (list && continues(i, text)) {
        list[list.length - 1].text += ' ' + text;
        continue;
      }
      close();
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'p' && tight(i) && !/[.!?:]$/.test(lines[i - 1].text.trim()) && !(/^[A-Z]/.test(text) && !wrapped(i - 1))) last.text += ' ' + text;
      else blocks.push({ type: 'p', text: text });
    }
    close();
    return blocks;
  }

  function extractQuotation(lines) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/quotation/i.test(line.text)) continue;
      const m = line.text.match(/^(.*?)\s+(\d[\d\s]*\d|\d)(?:\s*)$/);
      if (m && /quotation/i.test(m[1]) && /\d/.test(m[2])) {
        return { label: cleanJoin(m[1]), amount: m[2].trim(), line: line, source: 'quotation' };
      }
      const nums = line.items.filter(function (it) { return /\d/.test(it.str); });
      if (nums.length) {
        const amountItem = nums[nums.length - 1];
        const labelItems = line.items.filter(function (it) { return it.x + it.w <= amountItem.x + 1; });
        return {
          label: joinParts(labelItems) || 'Quotation',
          amount: amountItem.str.trim(),
          line: line,
          source: 'quotation'
        };
      }
    }
    return null;
  }

  function parseLetter(sections, notes) {
    const letter = sections.find(function (s) { return s.kind === 'letter'; }) || { lines: [], items: [] };
    const lines = letter.lines.filter(function (l) { return !knownHeading(l.text); });
    const titles = pickTitles(lines);
    const meta = parseMeta(letter.items, lines);
    const sal = lines.find(function (l) { return /^(Dear|Good day|Hello|Hi)\b/.test(l.text); }) || null;
    const titleIdx = titles.titleLine ? lines.indexOf(titles.titleLine) : -1;
    const proposalIdx = titles.proposalLine ? lines.indexOf(titles.proposalLine) : -1;
    const budgetIdx = titles.budgetLine ? lines.indexOf(titles.budgetLine) : -1;
    const salIdx = sal ? lines.indexOf(sal) : -1;

    const intro = [];
    const bodyLines = [];
    lines.forEach(function (line, idx) {
      if (line === titles.titleLine || line === titles.proposalLine || line === titles.budgetLine || line === sal) return;
      if (/^(To|From|Email|Date)\b/.test(line.text) && line.y < 270) return;
      if (salIdx >= 0 && idx > salIdx && (titleIdx < 0 || idx < titleIdx) && idx < (budgetIdx < 0 ? 9999 : budgetIdx)) {
        intro.push(line.text);
        return;
      }
      const start = Math.max(titleIdx, proposalIdx);
      if (start >= 0 && idx <= start) return;
      if (budgetIdx >= 0 && idx >= budgetIdx) return;
      if (titleIdx < 0 && salIdx >= 0 && idx <= salIdx) return;
      bodyLines.push(line);
    });

    const introParas = [];
    intro.forEach(function (text, i) {
      const prevLine = i > 0 ? lines.find(function (l) { return l.text === intro[i - 1]; }) : null;
      const line = lines.find(function (l) { return l.text === text; });
      const dy = prevLine && line ? line.base - prevLine.base : 99;
      if (introParas.length && dy < 14) introParas[introParas.length - 1] += ' ' + text;
      else introParas.push(text);
    });

    const quotation = extractQuotation(lines);
    const noteLines = [];
    if (budgetIdx >= 0) {
      lines.slice(budgetIdx + 1).forEach(function (line) {
        if (quotation && line === quotation.line) return;
        if (/^(To|From|Email|Date)\b/.test(line.text)) return;
        noteLines.push(line);
      });
    }
    const budgetNotes = [];
    noteLines.forEach(function (line, i) {
      const dy = i > 0 ? line.base - noteLines[i - 1].base : 99;
      if (budgetNotes.length && dy < 14) budgetNotes[budgetNotes.length - 1] += ' ' + line.text;
      else budgetNotes.push(line.text);
    });

    if (!meta.to || !meta.from) {
      notes.push({
        level: 'warn',
        text: 'The To / From block could not be read in full. Only the names that were printed as clear labels are shown.'
      });
    }
    if (!sal) {
      notes.push({ level: 'info', text: 'No salutation line (Dear …) was found.' });
    }

    const docTitle = titles.titleLine ? titles.titleLine.text : '';
    const parts = docTitle ? splitTitle(docTitle) : { eyebrow: '', main: '', tail: '' };
    return {
      docTitle: docTitle,
      eyebrow: parts.eyebrow,
      mainTitle: parts.main,
      titleTail: parts.tail,
      proposalType: titles.proposalLine ? titles.proposalLine.text : '',
      to: meta.to,
      from: meta.from,
      email: meta.email,
      date: meta.date,
      salutation: sal ? sal.text : '',
      intro: introParas,
      body: buildBlocks(bodyLines),
      budgetHeading: titles.budgetLine ? titles.budgetLine.text : '',
      budgetNotes: budgetNotes,
      quotation: quotation
    };
  }

  const HEADER_DEFS = [
    ['category', /^category$/i],
    ['item', /^item$/i],
    ['description', /^description$/i],
    ['units', /^units?$/i],
    ['qty', /^(qty|quantity)$/i],
    ['rate', /^rate$/i],
    ['amount', /^(amount|total)$/i]
  ];

  function rowsOf(items) {
    const sorted = items.slice().sort(function (a, b) { return a.base - b.base || a.x - b.x; });
    const rows = [];
    sorted.forEach(function (it) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(it.base - last.base) <= 2.6) last.items.push(it);
      else rows.push({ base: it.base, items: [it] });
    });
    rows.forEach(function (row) {
      row.items.sort(function (a, b) { return a.x - b.x; });
      row.text = joinParts(row.items);
    });
    return rows;
  }

  function detectHeaders(rows) {
    for (let i = 0; i < rows.length; i++) {
      const found = [];
      HEADER_DEFS.forEach(function (def) {
        const hit = rows[i].items.find(function (it) { return def[1].test(it.str.trim()); });
        if (hit) found.push({ key: def[0], x: hit.x });
      });
      const keys = found.map(function (f) { return f.key; });
      if (keys.indexOf('amount') >= 0 && (keys.indexOf('description') >= 0 || keys.indexOf('item') >= 0) && found.length >= 4) {
        found.sort(function (a, b) { return a.x - b.x; });
        return found;
      }
    }
    return null;
  }

  function columnOf(x, headers) {
    let key = headers[0].key;
    for (let i = 0; i < headers.length; i++) {
      const slack = i === 0 ? 40 : 12;
      if (x >= headers[i].x - slack) key = headers[i].key;
    }
    return key;
  }

  function cellsFrom(row, headers) {
    const buckets = {};
    row.items.forEach(function (it) {
      const key = columnOf(it.x, headers);
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(it);
    });
    const cells = {};
    Object.keys(buckets).forEach(function (key) {
      cells[key] = joinParts(buckets[key]);
    });
    return cells;
  }

  function isBlankRow(cells) {
    return !cells.item && !cells.description && !cells.units && !cells.qty && !cells.rate && !cells.amount && !cells.category;
  }

  function parseSchedule(sections, notes) {
    const chunks = sections.filter(function (s) { return s.kind === 'schedule'; });
    if (!chunks.length) return null;
    const pages = [];
    chunks.forEach(function (sec) {
      const byPage = {};
      sec.items.forEach(function (it) {
        const n = it.pageNumber || 0;
        if (!byPage[n]) byPage[n] = [];
        byPage[n].push(it);
      });
      Object.keys(byPage).sort(function (a, b) { return a - b; }).forEach(function (n) {
        pages.push(byPage[n]);
      });
    });

    let headers = null;
    const raw = [];
    const groups = [];
    let group = null;
    let total = null;

    function startGroup(category) {
      group = { category: category || '', rows: [], subtotal: null };
      groups.push(group);
      return group;
    }

    pages.forEach(function (items) {
      const rows = rowsOf(items);
      rows.forEach(function (row) { if (row.text) raw.push(row.text); });
      const found = detectHeaders(rows);
      if (found) headers = found;
      if (!headers) return;
      rows.forEach(function (row) {
        const headish = row.items.some(function (it) { return /^category$/i.test(it.str.trim()); })
          && row.items.some(function (it) { return /^amount$|^total$/i.test(it.str.trim()); });
        if (headish) return;
        if (knownHeading(row.text)) return;
        const cells = cellsFrom(row, headers);
        if (isBlankRow(cells)) return;
        const blob = row.text;
        const structural = !cells.item && !cells.description && !cells.category;
        if (structural && /sub-?\s*total/i.test(blob)) {
          if (!group) startGroup('');
          const nums = row.items.filter(function (it) { return /\d/.test(it.str); });
          group.subtotal = {
            label: cleanJoin(blob.replace(/\d[\d\s.,]*$/, '').trim()) || 'Sub-total:',
            amount: nums.length ? nums[nums.length - 1].str.trim() : (cells.amount || '')
          };
          group = null;
          return;
        }
        if (structural && /\b(schedule|grand total|quotation total)\b/i.test(blob) && /\d/.test(blob)) {
          const nums = row.items.filter(function (it) { return /\d/.test(it.str); });
          const label = cleanJoin(row.items.filter(function (it) { return !/\d/.test(it.str); }).map(function (it) { return it.str; }).join(' '));
          total = { label: label || 'Schedule', amount: nums.length ? nums[nums.length - 1].str.trim() : (cells.amount || '') };
          return;
        }
        if (!cells.qty && !cells.rate && !cells.amount && !cells.units && group && group.rows.length) {
          const prev = group.rows[group.rows.length - 1];
          if (cells.item) prev.item = cleanJoin(prev.item + ' ' + cells.item);
          if (cells.description) prev.description = cleanJoin(prev.description + ' ' + cells.description);
          if (cells.category && /^\(/.test(cells.category)) {
            group.category = cleanJoin(group.category + ' ' + cells.category);
          }
          return;
        }
        let cat = cells.category || '';
        if (cat && /^\(/.test(cat) && group) {
          group.category = cleanJoin(group.category + ' ' + cat);
          cat = '';
        } else if (cat) {
          if (!group || group.subtotal || cleanJoin(group.category) !== cleanJoin(cat)) startGroup(cat);
        } else if (!group) {
          startGroup('');
        }
        group.rows.push({
          item: cells.item || '',
          description: cells.description || '',
          units: cells.units || '',
          qty: cells.qty || '',
          rate: cells.rate || '',
          amount: cells.amount || ''
        });
      });
    });

    const schedule = { groups: groups.filter(function (g) { return g.rows.length || g.subtotal; }), total: total, raw: raw };
    const priced = schedule.groups.reduce(function (n, g) { return n + g.rows.length; }, 0);
    if (!headers || !priced) {
      notes.push({
        level: 'warn',
        text: 'The schedule of quantities was not in a recognised column layout. The extracted lines are shown as printed, and no amounts were calculated.'
      });
      schedule.groups = [];
      schedule.fallback = true;
    } else {
      const missing = [];
      schedule.groups.forEach(function (g) {
        g.rows.forEach(function (r) {
          if (!r.amount) missing.push(r.item || r.description || 'a line');
        });
      });
      if (missing.length) {
        notes.push({
          level: 'warn',
          text: 'No printed amount was found for ' + missing.slice(0, 3).join(', ') + '. Those cells were left blank rather than calculated.'
        });
      }
    }
    return schedule;
  }

  function isTermLabel(text) {
    const t = text.trim();
    if (t.length < 3 || t.length > 42) return false;
    if (/[.!?]$/.test(t)) return false;
    const letters = t.replace(/[^A-Za-z]/g, '');
    if (letters.length < 4) return false;
    if (letters !== letters.toUpperCase()) return false;
    if (/^(NOT APPLICABLE|SEE ABOVE|INCLUDED|EXCLUDED|BY OTHERS|TO BE ADVISED|AS PER SCHEDULE|N\/A)$/i.test(t)) return false;
    return true;
  }

  function parseTerms(sections, notes) {
    const lines = [];
    sections.forEach(function (s) {
      if (s.kind === 'terms') lines.push.apply(lines, s.lines);
    });
    if (!sections.some(function (s) { return s.kind === 'terms'; })) return [];
    const terms = [];
    let current = null;
    lines.forEach(function (line) {
      if (isTermLabel(line.text)) {
        current = { label: line.text.trim(), value: '' };
        terms.push(current);
        return;
      }
      if (!current) {
        current = { label: '', value: line.text.trim() };
        terms.push(current);
        return;
      }
      current.value = cleanJoin((current.value ? current.value + ' ' : '') + line.text);
    });
    const labelled = terms.filter(function (t) { return t.label; });
    if (!labelled.length && lines.length) {
      notes.push({
        level: 'warn',
        text: 'Terms and conditions could not be split into labelled rows, so the wording is shown as extracted.'
      });
      return [{ label: '', value: lines.map(function (l) { return l.text; }).join('\n'), raw: true }];
    }
    return terms;
  }

  function isLabCode(text) {
    const t = text.trim();
    if (t.length < 4 || t.length > 42) return false;
    if (/[a-z]/.test(t)) return false;
    if (!/\d/.test(t)) return false;
    return true;
  }

  function parseLabs(sections, notes) {
    const lines = [];
    sections.forEach(function (s) {
      if (s.kind === 'lab') lines.push.apply(lines, s.lines);
    });
    if (!sections.some(function (s) { return s.kind === 'lab'; })) return [];
    const groups = [];
    let current = null;
    function ensure(code) {
      current = { code: code || '', items: [] };
      groups.push(current);
      return current;
    }
    lines.forEach(function (line) {
      const text = line.text.trim();
      if (!text) return;
      if (isLabCode(text)) {
        ensure(text);
        return;
      }
      if (!current) ensure('');
      const own = /\(|@|\*$| - |^pH\b/i.test(text) || /^[A-Z]/.test(text);
      if (current.items.length && !own && /^[a-z]/.test(text)) {
        current.items[current.items.length - 1] += ' ' + text;
      } else current.items.push(text);
    });
    const count = groups.reduce(function (n, g) { return n + g.items.length; }, 0);
    if (!count && lines.length) {
      notes.push({
        level: 'warn',
        text: 'Laboratory sampling text could not be split into a code and a list, so it is shown as extracted.'
      });
      return [{ code: '', items: lines.map(function (l) { return l.text; }), raw: true }];
    }
    return groups;
  }

  function parseExtras(sections) {
    return sections.filter(function (s) { return s.kind === 'extra'; }).map(function (s) {
      const paragraphs = [];
      s.lines.forEach(function (line, i) {
        const dy = i > 0 ? line.base - s.lines[i - 1].base : 99;
        if (paragraphs.length && dy < 14 && !/^[A-Z][A-Z0-9 /-]{3,}$/.test(line.text)) {
          paragraphs[paragraphs.length - 1] += ' ' + line.text;
        } else paragraphs.push(line.text);
      });
      return { title: s.title || 'NOTES', paragraphs: paragraphs };
    }).filter(function (e) { return e.paragraphs.length; });
  }

  function pairMedia(sections, notes) {
    const images = [];
    sections.forEach(function (s) {
      if (s.kind !== 'media') return;
      const lines = s.lines.filter(function (l) { return !knownHeading(l.text); });
      const used = {};
      const figs = s.images.slice().sort(function (a, b) {
        return a.pageNumber - b.pageNumber || a.y - b.y || a.x - b.x;
      });
      figs.forEach(function (im) {
        const candidates = [];
        lines.forEach(function (l, idx) {
          if (used[idx]) return;
          if (l.pageNumber !== im.pageNumber) return;
          const below = l.y >= im.y + im.h - 4 && l.y <= im.y + im.h + 22;
          if (below) candidates.push({ l: l, idx: idx });
        });
        candidates.sort(function (a, b) { return a.l.y - b.l.y; });
        candidates.forEach(function (c) { used[c.idx] = true; });
        const caption = cleanJoin(candidates.map(function (c) { return c.l.text; }).join(' '));
        if (!caption) {
          notes.push({
            level: 'info',
            text: 'A figure on source page ' + im.pageNumber + ' had no caption in the text layer.'
          });
        }
        images.push({
          dataUrl: im.dataUrl,
          caption: caption,
          w: im.w,
          h: im.h,
          pageNumber: im.pageNumber
        });
      });
    });
    const sawMedia = sections.some(function (s) { return s.kind === 'media'; });
    if (sawMedia && !images.length) {
      notes.push({
        level: 'warn',
        text: 'A media page was found, but no figures could be cropped from it. Nothing was drawn in their place.'
      });
    }
    return images;
  }

  function printedNumber(value) {
    if (!value) return null;
    let t = String(value).trim().replace(/\s/g, '').replace(/^R/i, '').replace(/^ZAR/i, '');
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
    else t = t.replace(/,/g, '');
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  function joinSentences(parts) {
    const clean = parts.filter(Boolean);
    if (!clean.length) return '';
    let s = clean[0];
    for (let i = 1; i < clean.length; i++) {
      if (!/[.!?]$/.test(s)) s += '.';
      s += ' ' + clean[i];
    }
    return s;
  }

  function parseDocument(pages) {
    const notes = [];
    const prepared = (pages || []).map(function (p) { return prepare(p, notes); }).filter(Boolean);
    const anyText = (pages || []).some(function (p) {
      return (p.items || []).some(function (it) { return it.str && it.str.trim(); });
    });
    if (!anyText) {
      notes.push({
        level: 'warn',
        text: 'No text layer was found. Pages with figures are included as images only, and no totals were invented.'
      });
    }
    const sections = splitSections(prepared);
    const letter = parseLetter(sections, notes);
    const blob = (pages || []).map(function (p) {
      return (p.items || []).map(function (it) { return it.str; }).join(' ');
    }).join('\n');
    const bee = findPhrase(blob, /Level\s+\d+\s+Contributor\s+to\s+B-BBEE/i);
    const currencyNote = findPhrase(blob, /Prices quoted are in SA Rand\.?/i);
    const vatNote = findPhrase(blob, /Quoted prices exclude VAT\.?/i);

    const schedule = parseSchedule(sections, notes);
    let quotation = letter.quotation;
    if (!quotation && schedule && schedule.total && schedule.total.amount) {
      quotation = {
        label: 'Quotation (excluding VAT)',
        amount: schedule.total.amount,
        source: 'schedule',
        line: null
      };
      notes.push({
        level: 'info',
        text: 'No separate quotation line was printed. The total shown is the schedule line “' + schedule.total.label + ' ' + schedule.total.amount + '”.'
      });
    }
    if (quotation && quotation.source === 'quotation' && schedule && schedule.total && schedule.total.amount) {
      const a = printedNumber(quotation.amount);
      const b = printedNumber(schedule.total.amount);
      if (a != null && b != null && a !== b) {
        notes.push({
          level: 'warn',
          text: 'The quotation line reads ' + quotation.amount + ' and the schedule total reads ' + schedule.total.amount + '. Both are shown as printed.'
        });
      }
    }

    const media = pairMedia(sections, notes);
    const terms = parseTerms(sections, notes);
    const labs = parseLabs(sections, notes);
    const extras = parseExtras(sections);
    if (extras.length) {
      notes.push({
        level: 'info',
        text: 'Some text did not match a standard section and is included under its printed heading.'
      });
    }

    if (!letter.docTitle) {
      const allLines = [];
      sections.forEach(function (s) { allLines.push.apply(allLines, s.lines); });
      const picked = pickTitles(allLines);
      if (picked.titleLine) {
        const parts = splitTitle(picked.titleLine.text);
        letter.docTitle = picked.titleLine.text;
        letter.eyebrow = parts.eyebrow;
        letter.mainTitle = parts.main;
        letter.titleTail = parts.tail;
      } else if (anyText) {
        notes.push({
          level: 'warn',
          text: 'The document title could not be mapped. The letterhead is shown without an invented project name.'
        });
      }
    }

    const flow = [];
    let seenMedia = false;
    sections.forEach(function (s) {
      if (s.kind === 'letter') return;
      if (s.kind === 'media') {
        if (!seenMedia && media.length) flow.push('media');
        seenMedia = true;
        return;
      }
      if (s.kind === 'schedule' && schedule) {
        if (flow.indexOf('schedule') < 0) flow.push('schedule');
        return;
      }
      if (s.kind === 'terms' && terms.length) {
        if (flow.indexOf('terms') < 0) flow.push('terms');
        return;
      }
      if (s.kind === 'lab' && labs.length) {
        if (flow.indexOf('lab') < 0) flow.push('lab');
        return;
      }
      if (s.kind === 'extra') flow.push('extra:' + s.title);
    });

    const scheduleRows = schedule ? schedule.groups.reduce(function (n, g) { return n + g.rows.length; }, 0) : 0;
    return {
      bee: bee,
      docTitle: letter.docTitle,
      eyebrow: letter.eyebrow,
      mainTitle: letter.mainTitle,
      titleTail: letter.titleTail,
      proposalType: letter.proposalType,
      to: letter.to,
      from: letter.from,
      email: letter.email,
      date: letter.date,
      salutation: letter.salutation,
      intro: letter.intro,
      body: letter.body,
      budgetHeading: letter.budgetHeading,
      budgetNotes: letter.budgetNotes,
      quotation: quotation,
      currencyNote: currencyNote,
      vatNote: vatNote,
      scheduleIntro: joinSentences([currencyNote, vatNote]),
      media: media,
      schedule: schedule,
      terms: terms,
      labs: labs,
      extras: extras,
      flow: flow,
      notes: notes,
      scheduleRows: scheduleRows
    };
  }

  window.HWTParse = { parseDocument: parseDocument, splitTitle: splitTitle,
    _test: { buildBlocks: buildBlocks, splitLong: splitLong, tidyItem: tidyItem, stripBullet: stripBullet } };
})();
