'use strict';

/* Client-side text cleanup for OCR / typing errors.
   Touches prose, labels and dates only. Digit sequences are never changed. */

(function (root) {
  var DOMAIN = ('wwtp wwtw stp wtw sbr mbr mbbr ras was anoxic anaerobic aerobic mlss mlvss cod bod tss tds ec sar svi dws ' +
    'effluent effluents influent clarifier clarifiers bioreactor bioreactors airlift airlifts kilolitre kilolitres kl klpd ' +
    'kwh kwhrs kwhr sulphate sulphates nitrate nitrates nitrite phosphate phosphates ammonia coliform coliforms faecal ' +
    'chlorine chlorination dechlorination ph uv orp do sludge desludge desludging decant decanter screenings grit ' +
    'aeration blower blowers diffuser diffusers submersible borehole boreholes potable reticulation hwt pty ltd sans ' +
    'hydrossis biomass flocculant coagulant polyelectrolyte dosing doser macerator grinder sump sumps mixer mixers ' +
    'denitrification nitrification wastewater greywater blackwater stormwater filtrate backwash ozonation ' +
    'mg mgn mgp ml org ms kgs kg vinlab gazette biofilm lime impeller impellers valve valves actuator actuators ' +
    'flowmeter flowmeters telemetry scada plc vfd vsd rotor stator bearing bearings gearbox manhole manholes ' +
    'admin info approx ops maint annum rata hoc inter alia bona fide vice versa via etc ito ie eg excl incl vat qty ea nr lumpsum ' +
    'inlet outlet weir weirs baffle baffles lamella membrane membranes permeate retentate scum skimmer').split(/\s+/);
  var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  var MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var dict = null; // word -> level (lower = more common)
  var loading = null;

  function loadText(text) {
    dict = new Map();
    var level = 60;
    String(text).split('\n').forEach(function (line) {
      if (!line) return;
      if (line[0] === '#') { level = parseInt(line.slice(1), 10) || 60; return; }
      if (!dict.has(line)) dict.set(line, level);
    });
    DOMAIN.forEach(function (w) { dict.set(w, 5); });
    return dict;
  }

  function ready(url) {
    if (dict) return Promise.resolve(dict);
    if (!loading) {
      loading = fetch(url || new URL('vendor/wordlist-en.txt', root.location.href).toString())
        .then(function (r) { if (!r.ok) throw new Error('wordlist ' + r.status); return r.text(); })
        .then(loadText)
        .catch(function () { dict = null; loading = null; return null; });
    }
    return loading;
  }

  function known(w) {
    if (!dict) return true;
    var k = w.toLowerCase();
    if (dict.has(k)) return true;
    // simple inflections
    if (/s$/.test(k) && dict.has(k.slice(0, -1))) return true;
    if (/es$/.test(k) && dict.has(k.slice(0, -2))) return true;
    if (/ed$/.test(k) && (dict.has(k.slice(0, -2)) || dict.has(k.slice(0, -1)))) return true;
    if (/ing$/.test(k) && (dict.has(k.slice(0, -3)) || dict.has(k.slice(0, -3) + 'e'))) return true;
    if (/'s$/.test(k) && dict.has(k.slice(0, -2))) return true;
    return false;
  }

  function level(w) { return dict && dict.has(w) ? dict.get(w) : 99; }

  function matchCase(src, w) {
    if (src === src.toUpperCase() && src.length > 1) return w.toUpperCase();
    if (src[0] === src[0].toUpperCase()) return w[0].toUpperCase() + w.slice(1);
    return w;
  }

  var ALPHA = 'abcdefghijklmnopqrstuvwxyz';
  function edits1(w) {
    var out = new Set();
    for (var i = 0; i <= w.length; i++) {
      var a = w.slice(0, i), b = w.slice(i);
      if (b) out.add(a + b.slice(1));
      if (b.length > 1) out.add(a + b[1] + b[0] + b.slice(2));
      for (var j = 0; j < 26; j++) {
        var c = ALPHA[j];
        if (b) out.add(a + c + b.slice(1));
        out.add(a + c + b);
      }
    }
    out.delete(w);
    return out;
  }

  var CONFUSIONS = [[/0/g, 'o'], [/1/g, 'l'], [/I/g, 'l'], [/l/g, 'i'], [/rn/g, 'm'], [/m/g, 'rn'], [/vv/g, 'w'], [/cl/g, 'd'], [/5/g, 's']];

  function fixWord(tok, log) {
    if (!dict || tok.length < 3) return tok;
    // only lower-case words (or OCR digit/letter mixes); proper nouns and acronyms are left alone
    if (/[A-Z]/.test(tok.slice(1)) && !/^[A-Za-z]+[01I5][a-z]+$/.test(tok)) return tok;
    if (/^\d/.test(tok) || /^[0-9]+$/.test(tok)) return tok;
    var lower = tok.toLowerCase();
    if (/^[a-z']+$/.test(lower) && known(lower)) return tok;
    var capital = /^[A-Z]/.test(tok);
    // OCR letter confusions inside the word
    for (var i = 0; i < CONFUSIONS.length; i++) {
      var cand = tok.replace(CONFUSIONS[i][0], CONFUSIONS[i][1]);
      if (cand !== tok && /^[A-Za-z']+$/.test(cand) && known(cand.toLowerCase())) {
        var fixed = matchCase(tok, cand.toLowerCase());
        log.push({ from: tok, to: fixed, rule: 'OCR letters' });
        return fixed;
      }
    }
    if (!/^[a-z']+$/.test(lower) || capital || lower.length < 6) return tok;
    // conservative spell-correct: edit distance 1, single clear winner
    var best = null, bestLv = 99, ties = 0;
    edits1(lower).forEach(function (c) {
      var lv = level(c);
      if (lv >= 99) return;
      if (lv < bestLv) { best = c; bestLv = lv; ties = 0; } else if (lv === bestLv) ties += 1;
    });
    if (best && ties === 0 && bestLv <= 40) {
      var f = matchCase(tok, best);
      log.push({ from: tok, to: f, rule: 'spelling' });
      return f;
    }
    return tok;
  }

  function clean(text, log) {
    log = log || [];
    if (text == null) return text;
    var s = String(text);
    var orig = s;
    var masks = [];
    s = s.replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b|\bhttps?:\/\/\S+|\bwww\.\S+|\(mailto:[^)]*\)/g, function (m) {
      masks.push(m); return '\u0000' + (masks.length - 1) + '\u0000';
    });
    function rule(re, to, name) {
      s = s.replace(re, function () {
        var m = arguments[0];
        var r = typeof to === 'function' ? to.apply(null, arguments) : m.replace(re, to);
        if (r !== m) log.push({ from: m, to: r, rule: name });
        return r;
      });
    }
    // dates: 23-0Oct, 23-O0ct, 23-0ct
    rule(/\b(\d{1,2})[-\s]?[0O]{0,2}([0O])?(ct|Ct)\b/g, function (m, d) { return /[0O]/.test(m.slice(String(d).length)) ? d + '-Oct' : m; }, 'date');
    rule(/\b(\d{1,2})-[0O]([A-Z][a-z]{2})\b/g, function (m, d, mon) { return MON3.indexOf(mon) >= 0 ? d + '-' + mon : m; }, 'date');
    // month names
    rule(new RegExp('\\b(' + MONTHS.join('|') + ')\\b', 'g'), function (m) {
      return m === 'may' ? m : m[0].toUpperCase() + m.slice(1);
    }, 'month case');
    rule(/\b(\d{1,2})-(jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/g, function (m, d, mon) { return d + '-' + mon[0].toUpperCase() + mon.slice(1); }, 'month case');
    // punctuation
    rule(/([a-z]+)\.{2,}\s*([a-z]+)/g, function (m, a, b) { return a + '. ' + b[0].toUpperCase() + b.slice(1); }, 'punctuation');
    rule(/\b([a-z]{2,})\.([a-z]{3,})\b/g, function (m, a, b) {
      if (dict && known(a + b)) return m;
      return a + ' ' + b;
    }, 'punctuation');
    rule(/\s+([,.;:!?])(?=\s|$)/g, '$1', 'punctuation');
    rule(/([,;:!?])\1+/g, '$1', 'punctuation');
    rule(/\.{2,}(?=\s|$)/g, '.', 'punctuation');
    rule(/([a-z])([,;])(?=[A-Za-z])/g, '$1$2 ', 'punctuation');
    rule(/ {2,}/g, ' ', 'spacing');
    // words
    s = s.replace(/[A-Za-z][A-Za-z0-9']*/g, function (tok, off, all) {
      if (all[off - 1] === '\u0000') return tok;
      if (/\d/.test(tok) && !/^[A-Za-z]+[015][A-Za-z]+$/.test(tok)) return tok;
      return fixWord(tok, log);
    });
    s = s.replace(/\u0000(\d+)\u0000/g, function (m, i) { return masks[+i]; });
    // never alter digit sequences
    var dg = function (t) { return (t.match(/\d+/g) || []).join('|'); };
    if (dg(s) !== dg(orig) && dg(s).replace(/\|/g, '') !== dg(orig).replace(/\|/g, '').replace(/0(?=[^0-9]|$)/, '')) {
      // safety net: if digits changed in an unexpected way, keep original except date fixes
      if (!/\b\d{1,2}-[A-Z][a-z]{2}\b/.test(s)) return orig;
    }
    return s.trim();
  }

  root.HWTCleanup = { ready: ready, loadText: loadText, clean: clean, known: known };
})(typeof window !== 'undefined' ? window : globalThis);
