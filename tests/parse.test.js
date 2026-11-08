// Run: node tests/parse.test.js  (no deps; parse.js stays browser-only)
const fs = require('fs'), path = require('path'), assert = require('assert');
global.window = {};
eval(fs.readFileSync(path.join(__dirname, '../js/parse.js'), 'utf8'));
const T = window.HWTParse._test;
const fx = require('./fixture-process-list.json');
const W = (t) => t.split(/\s+/).length;
function mkLines(texts, opts) {
  return texts.map((t, i) => {
    const bullet = /^•/.test(t);
    const x = bullet ? 60 : 72;
    const w = Math.min(460, t.length * 3.9);
    return { text: t, x: 60, base: 100 + i * 12, fontSize: 9, items: [{ x: x, w: w, str: t }] };
  });
}
// 1) Line-by-line source (bullets + one wrapped line) -> one item per bullet
const blocks = T.buildBlocks([{ text: 'Process description', x: 40, base: 80, fontSize: 9, items: [{ x: 40, w: 90, str: 'Process description' }] }].concat(mkLines(fx.lines)));
const ul = blocks.find((b) => b.type === 'ul');
assert(ul, 'list built');
const items = ul.items.map((i) => i.text);
console.log('lines ->', items);
assert.strictEqual(items.length, 11);
items.forEach((t) => { assert(/^[A-Z]/.test(t), 'sentence case: ' + t); assert(/\.$/.test(t), 'full stop: ' + t); assert(W(t) <= 40); });
// 2) Already-merged blob -> capped split
const parts = T.splitLong(fx.blob).map(T.tidyItem);
console.log('blob ->', parts);
assert(parts.length >= 4);
parts.forEach((t) => assert(W(t) <= 40, 'cap: ' + t));
assert.strictEqual(parts.join(' ').replace(/[.,]/g, '').toLowerCase().replace(/\s+/g, ' '), fx.blob.replace(/[.,]/g, '').toLowerCase());
// 3) markers
['• a', '- a', '– a', '1. a', '2) a', 'a) a', '(b) a', 'iv. a'].forEach((m) => assert.strictEqual(T.stripBullet(m), 'a', m));
console.log('OK');
// 4) Single x-column (bullets at body margin) still splits
const flat = fx.lines.map((t, i) => ({ text: t, x: 60, base: 100 + i * 12, fontSize: 9, items: [{ x: 60, w: 400, str: t }] }));
const fb = T.buildBlocks(flat).find((b) => b.type === 'ul');
assert(fb && fb.items.length === 11, 'flat list split: ' + (fb && fb.items.length));
console.log('OK flat');

// 5) Indented sub-items nest; a wrapped lowercase line stays on its parent. Numbers untouched.
function asLines(rows) {
  return rows.map(function (row) {
    return {
      text: row.map(function (p) { return p.str; }).join(' '),
      x: row[0].x,
      base: row.base,
      fontSize: 9,
      items: row.map(function (p) { return { x: p.x, w: p.w, str: p.str }; })
    };
  });
}
const nested = asLines([
  Object.assign([{ str: '1.', x: 78, w: 12 }, { str: 'Abstraction from borehole', x: 92, w: 180 }], { base: 100 }),
  Object.assign([{ str: '3.', x: 78, w: 12 }, { str: 'Activated Filter Media in the', x: 92, w: 400 }], { base: 112 }),
  Object.assign([{ str: 'ground', x: 92, w: 36 }, { str: 'water', x: 130, w: 36 }], { base: 124 }),
  Object.assign([{ str: '8.', x: 78, w: 12 }, { str: 'Continuous measurement of', x: 92, w: 170 }], { base: 136 }),
  Object.assign([{ str: 'flow', x: 116, w: 24 }], { base: 148 }),
  Object.assign([{ str: 'energy', x: 116, w: 36 }], { base: 160 }),
  Object.assign([{ str: '9.', x: 78, w: 12 }, { str: 'Storage of treated water', x: 92, w: 160 }], { base: 172 }),
  Object.assign([{ str: '4.', x: 76, w: 12 }, { str: 'Process maintenance including;', x: 90, w: 180 }], { base: 200 }),
  Object.assign([{ str: 'Continuous alarm and motor monitoring', x: 114, w: 200 }], { base: 212 })
]);
const nb = T.buildBlocks(nested).filter(function (b) { return b.type === 'ul'; });
const flatItems = [].concat.apply([], nb.map(function (b) { return b.items; }));
const measure = flatItems.find(function (it) { return /measurement/.test(it.text); });
assert(measure && measure.children.length === 2, 'flow/energy nested');
assert.strictEqual(measure.children[0], 'Flow.');
assert.strictEqual(measure.children[1], 'Energy.');
const act = flatItems.find(function (it) { return /Activated/.test(it.text); });
assert(act && /ground water/.test(act.text) && !act.children.length, 'wrap stays on parent');
const maint = flatItems.find(function (it) { return /maintenance/.test(it.text); });
assert(maint && maint.children.length === 1 && /Continuous alarm/.test(maint.children[0]), 'maintenance child');
console.log('OK nest');

// 6) Term clauses stay separate; a wrapped sentence stays one clause. Digits survive.
const clauses = T.clauseItems([
  { text: 'It is assumed that a 380 volt power source will be supplied by others to the treatment plant', x: 61 },
  { text: 'Equipment transport costs to Johannesburg are included in this proposal.', x: 61 },
  { text: 'Raw water and treated water storage tanks are not provided', x: 61 }
]);
assert.strictEqual(clauses.length, 3, 'exclusions split');
assert.ok(clauses[0].indexOf('380') >= 0);
const one = T.clauseItems([
  { text: 'HWT (Pty) Ltd reserves the right to manufacture to the company standard which is generally in accordance with the', x: 61 },
  { text: 'Metal and Engineering Association of SA.', x: 61 }
]);
assert.strictEqual(one.length, 1, 'wrapped guarantee/general stays one');
assert.ok(/Metal and Engineering/.test(one[0]));
const wide = T.clauseItems([
  { text: 'It is assumed that a 380 volt power source will be supplied by others to the treatment plant', x: 61, items: [{ x: 61, w: 460, str: 'It is assumed that a 380 volt power source will be supplied by others to the treatment plant' }] },
  { text: 'Equipment transport costs to Johannesburg are included in this proposal.', x: 61, items: [{ x: 61, w: 420, str: 'Equipment transport costs to Johannesburg are included in this proposal.' }] }
]);
assert.strictEqual(wide.length, 2, 'long neighbouring clauses stay separate');
assert.ok(wide[0].indexOf('380') >= 0);
console.log('OK clauses');
assert.strictEqual(T.tidyItem('pH adjustment and softening'), 'pH adjustment and softening.');

// 7) Column-aligned blocks become tables; printed figures are copied, not summed.
function cells(list, base) {
  return {
    text: list.map(function (c) { return c.t; }).join(' '),
    x: list[0].x,
    base: base,
    fontSize: 6,
    items: list.map(function (c) { return { x: c.x, w: c.w || Math.max(12, c.t.length * 3.4), str: c.t }; })
  };
}
const tableLines = [
  cells([{ t: 'CATEGORY', x: 66 }, { t: 'ITEM', x: 188 }, { t: 'DESCRIPTION', x: 311 }, { t: 'QUANTITY', x: 448 }], 90),
  cells([{ t: 'METRICS', x: 66 }, { t: 'Daily flow', x: 188 }, { t: '3.6 (kl/d)', x: 311 }], 103),
  cells([{ t: 'Annual flow', x: 188 }, { t: '0.854 (Ml/a)', x: 311 }], 116),
  cells([{ t: 'ELECTRICAL', x: 66 }], 140),
  cells([{ t: 'Starter', x: 188 }, { t: 'Overload and contactor', x: 311 }, { t: '7', x: 448 }], 153),
  cells([{ t: 'CHEMICAL', x: 66 }, { t: 'UNIT PROCESS', x: 160 }, { t: 'VESSEL', x: 279 }, { t: 'QTY', x: 351 }, { t: 'UNITS', x: 384 }, { t: 'VALUE', x: 422 }, { t: 'ZAR/kl', x: 466, w: 22 }, { t: 'AMOUNT', x: 499, w: 30 }], 200),
  cells([{ t: 'Hydrated lime', x: 66 }, { t: 'pH Stabilization lime', x: 160 }, { t: '25 kg bag', x: 279 }, { t: '326', x: 353 }, { t: 'mg/kl', x: 386 }, { t: '350', x: 427 }, { t: '3.50', x: 474, w: 18 }, { t: '81,441', x: 507, w: 28 }], 213),
  cells([{ t: 'Sodium Hypochlorite (Dis)', x: 66 }, { t: 'Disinfection Liquid chlorine', x: 160 }, { t: '25 litre polycan', x: 279 }, { t: '88', x: 354 }, { t: 'ml/kl', x: 387 }, { t: '95', x: 429 }, { t: '1.31', x: 474 }, { t: '30,505', x: 507 }], 226),
  cells([{ t: 'Annual Sub-total:', x: 314, w: 60 }, { t: '151,736', x: 386, w: 28 }], 239)
];
const segs = T.segmentLines(tableLines);
const tables = segs.filter(function (b) { return b.type === 'table'; });
assert.strictEqual(tables.length, 2, 'two tables');
assert.deepStrictEqual(tables[0].header, ['CATEGORY', 'ITEM', 'DESCRIPTION', 'QUANTITY']);
assert.strictEqual(tables[0].rows[0].cells[2], '3.6 (kl/d)');
assert.strictEqual(tables[0].rows[1].cells[2], '0.854 (Ml/a)');
assert.strictEqual(tables[0].rows[3].cells[3], '7');
assert.strictEqual(tables[1].header[6], 'ZAR/kl');
assert.strictEqual(tables[1].header[7], 'AMOUNT');
assert.strictEqual(tables[1].rows[0].cells[3], '326');
assert.strictEqual(tables[1].rows[0].cells[6], '3.50');
assert.strictEqual(tables[1].rows[0].cells[7], '81,441');
const sum = tables[1].rows[tables[1].rows.length - 1];
assert.ok(sum.summary && sum.raw.indexOf('151,736') >= 0, 'printed subtotal kept');
console.log('OK tables');
