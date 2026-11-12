// Run: node tests/layout.test.js  (vector bullets, mixed-case tables, clause splits)
const fs = require('fs'), path = require('path'), assert = require('assert');
global.window = {};
eval(fs.readFileSync(path.join(__dirname, '../js/parse.js'), 'utf8'));
const T = window.HWTParse._test;
function L(text, x, base, size) {
  size = size || 7.2;
  const parts = text.split(/(\s{3,})/).filter((p) => p.trim());
  let cx = x; const items = [];
  text.split(/\s{3,}/).forEach((str) => { items.push({ str, x: cx, w: str.length * 3.4, base, fontSize: size }); cx += str.length * 3.4 + 20; });
  return { text: items.map((i) => i.str).join(' '), x, base, y: base - size, fontSize: size, items, pageNumber: 1 };
}
// 1) Drawn bullets (no glyph in the text layer) become nested list items
const lines = [
  L('Treatment Processes:', 67, 335),
  L('sewage is pumped to the plant from a sump (2.4 meters in', 91, 353),
  L('depth)', 91, 363),
  L('biological treatment takes place in two containers', 91, 373),
  L('treatment processes include removal of organic material', 115, 383),
  L('disinfection of treated effluent', 115, 392),
  L('water quality is compliant with the DWS General Limit', 91, 451),
  L('DWS is the South African Department of Water and Sanitation.', 115, 461),
  L('This is a fully automated system.', 67, 479)
];
const marks = [353, 373, 383, 392, 451, 461].map((b, i) => ({ x: [86, 86, 110, 110, 86, 110][i], y: b - 5, w: 3, h: 3 }));
T.attachVectorBullets(lines, marks);
const blocks = T.buildBlocks(lines);
const ul = blocks.find((b) => b.type === 'ul');
assert(ul, 'list from vector bullets');
assert.strictEqual(ul.items.length, 3, JSON.stringify(ul.items));
assert(/depth\)/.test(ul.items[0].text), 'wrap joined');
assert.strictEqual(ul.items[1].children.length, 2, 'two separate sub-points: ' + JSON.stringify(ul.items[1].children));
assert.strictEqual(ul.items[2].children.length, 1);
assert.strictEqual(blocks[blocks.length - 1].type, 'p');
// 2) Mixed-case header table (motor schedule) is read as a table; Installed Power stays prose
const motor = [
  L('6015c 30klpd Lesotho hwtContainer (Rev 1)', 61, 100),
  L('Motor   Description   kW   FLC   Qty   Duty   Starters   kWhrs/d', 61, 120),
  L('Bioreactor Feed Flow   FEKA FXV 20.15   1.7   4.1   1   2   2   1.7', 61, 135),
  L('SBR Drain Flow   JET 200 T   2   4.8   1   1   1   5.7', 61, 150),
  L('Installed Power (380V, 50Hz): 13 (kW), 31.7 (amps)', 61, 175)
];
const seg = T.segmentLines(motor);
const tbl = seg.find((b) => b.type === 'table');
assert(tbl, 'motor table found');
assert.strictEqual(tbl.rows.length, 2);
assert(/Installed Power/.test(seg[seg.length - 1].text));
// 3) A line starting with a figure after a short line is its own clause
const terms = [L('Ground preparation is not included', 61, 136), L('2 bar, 15mm fresh water supply', 61, 147),
  L('It is assumed that a 380 volt power source will be supplied by others to the treatment', 61, 158), L('plant.', 61, 168)];
const parts = T.clauseItems(terms);
assert.strictEqual(parts.length, 3, JSON.stringify(parts));
// 4) "Budget proposal" in body type is the budget heading
assert(T.isBudgetHeading({ text: 'Budget proposal', fontSize: 7.2, bold: false }));
assert(!T.isBudgetHeading({ text: 'The budget proposal includes', fontSize: 7.2, bold: false }));
console.log('layout tests ok');
