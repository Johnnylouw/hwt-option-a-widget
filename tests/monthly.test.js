// Run: node tests/monthly.test.js — parses OCR lines from the Spier Oct 2026 sample (no browser).
const fs = require('fs'), path = require('path'), assert = require('assert');
global.window = {};
eval(fs.readFileSync(path.join(__dirname, '../js/monthly.js'), 'utf8'));
const T = window.HWTMonthly._test;
const pages = require('./fixture-monthly-ocr.json');
pages.forEach((p) => { p.lines.forEach((l) => l.words.forEach((w) => { w.page = p.page; })); p.images = (p.images || []).map((r) => Object.assign({ dataUrl: 'x' }, r)); });
const m = T.buildModel(pages);
assert.strictEqual(m.title, 'Spier WWTP report 2026-10 (Oct)');
assert.strictEqual(m.rating, '99A');
const tables = [].concat(...m.sections.map((s) => s.parts.filter((p) => p.type === 'table')));
const analysis = tables.find((t) => t.header && t.header[0] === 'Parameter');
assert(analysis && analysis.header.length === 7 && analysis.rows.length === 16, "analysis table 7 cols x 16 rows");
const motors = tables.find((t) => t.rows.some((r) => r[0] === 'Feed pump 1'));
assert(motors && motors.rows.length === 7, 'motor hours table split from comments column');
assert.strictEqual(m.sections.reduce((n, s) => n + s.parts.filter((p) => p.type === 'image').length, 0), 5);
const sign = [].concat(...m.sections.map((s) => s.parts)).find((p) => p.type === 'signoff');
assert.deepStrictEqual(sign.lines, ['Andrew Hulsman', 'Process Engineer', 'HWT (Pty) Ltd', 'hwt@iafrica.com']);
assert.strictEqual(T.classify('Spier WWTP report 2026-10 Operational Report - Meter Flows'), 'monthly');
assert.strictEqual(T.classify('Dear Ms Easthorpe Many thanks for your enquiry TREATMENT PROPOSAL'), 'proposal');
console.log('OK monthly');
// cleanup pass on the sample
eval(fs.readFileSync(path.join(__dirname, '../js/cleanup.js'), 'utf8'));
window.location = { href: 'http://localhost/' };
window.HWTCleanup.loadText(fs.readFileSync(path.join(__dirname, '../vendor/wordlist-en.txt'), 'utf8'));
const fixes = T.cleanupModel(m);
assert.deepStrictEqual(m.company, ['HWT Process Maintenance (Pty) Ltd', 'Reg 2017/388687/07', 'PO Box 28 • Lynedoch • 7603 • South Africa']);
const allText = JSON.stringify(m.sections);
assert(allText.includes('23-Oct: Checked') && !allText.includes('23-0Oct'));
assert(allText.includes('(October, 2026)') && allText.includes('Topped up anoxic'));
assert(analysis.rows.some((r) => r[3] === '66714.2'));
fixes.forEach((f) => console.log('  fix:', f.rule, JSON.stringify(f.from), '->', JSON.stringify(f.to)));
console.log('OK monthly cleanup');
// review step: apply only a subset of suggestions
{
  const fresh = () => { const pg = JSON.parse(JSON.stringify(require('./fixture-monthly-ocr.json'))); pg.forEach((p) => { p.lines.forEach((l) => l.words.forEach((w) => { w.page = p.page; })); p.images = (p.images || []).map((r) => Object.assign({ dataUrl: 'x' }, r)); }); return T.buildModel(pg); };
  const sugg = T.cleanupModel(fresh(), null);
  const dateFix = sugg.find((f) => f.from === '23-0Oct');
  const company = sugg.find((f) => f.rule === 'company block');
  assert(dateFix && company && sugg.every((f) => f.key), 'keys present');
  const keys = new Set(sugg.map((f) => f.key)); keys.delete(dateFix.key); keys.delete(company.key);
  const m2 = fresh();
  const log2 = T.cleanupModel(m2, (f) => keys.has(f.key));
  const txt = JSON.stringify(m2.sections);
  assert(txt.includes('23-0Oct: Checked'), 'unticked date fix keeps original text verbatim');
  assert(txt.includes('(October, 2026)') && txt.includes('Topped up anoxic'), 'ticked fixes applied');
  assert(!m2.company.includes('Reg 2017/388687/07'), 'unticked company block keeps OCR header');
  assert.deepStrictEqual(log2.map((f) => f.key), sugg.map((f) => f.key), 'same suggestion keys on re-apply');
  const m3 = fresh(); T.cleanupModel(m3, () => false);
  assert(JSON.stringify(m3.sections) === JSON.stringify(fresh().sections), 'keep original = untouched');
  console.log('OK review subset');
}
