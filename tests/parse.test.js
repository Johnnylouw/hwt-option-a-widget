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
