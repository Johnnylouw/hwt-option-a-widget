// Run: node tests/cleanup.test.js
const fs = require('fs'), path = require('path'), assert = require('assert');
global.window = globalThis; window.location = { href: 'http://localhost/' };
eval(fs.readFileSync(path.join(__dirname, '../js/cleanup.js'), 'utf8'));
HWTCleanup.loadText(fs.readFileSync(path.join(__dirname, '../vendor/wordlist-en.txt'), 'utf8'));
const c = (t) => HWTCleanup.clean(t, []);
assert.strictEqual(c('23-0Oct: Checked all pump stations.'), '23-Oct: Checked all pump stations.');
assert.strictEqual(c('Operational Comments (october, 2026)'), 'Operational Comments (October, 2026)');
assert.strictEqual(c('Topped up.anoxic mixer one oil. Plant is running well..no mechanical issues detected'), 'Topped up anoxic mixer one oil. Plant is running well. No mechanical issues detected');
assert.strictEqual(c('The tretment plant is runnirg well , no issues'), 'The treatment plant is running well, no issues');
assert.strictEqual(c('Biornass is settling well'), 'Biomass is settling well');
// untouched: numbers, names, acronyms, emails, domain words
['6.0 - 8.5', '66714.2', '1,378', 'Count (0) was within the allowable limit (1,000).', 'hwt@iafrica.com (mailto:hwt@iafrica.com)',
 'Welman is starting to dig at the Waldorf school', 'MLSS and COD in the anoxic zone of the WWTP clarifier', 'Samples are taken to Vinlab for analysis.',
 '3 x Bags of lime delivered (25kgs)', 'Power usage for October 2026 was 10,793 kWhrs'].forEach((t) => assert.strictEqual(c(t), t, t));
console.log('OK cleanup');
// subset via applyModel on a proposal-shaped model
{
  const mk = () => ({ intro: ['The tretment plant is runnirg well , no issues'], body: [], media: [], terms: [], extras: [], budgetNotes: [] });
  const all = HWTCleanup.applyModel(mk(), HWTCleanup.walkProposal, null);
  const keep = all.find((f) => f.from === 'runnirg');
  const m = mk();
  HWTCleanup.applyModel(m, HWTCleanup.walkProposal, (f) => f.key !== keep.key);
  assert.strictEqual(m.intro[0], 'The treatment plant is runnirg well, no issues');
  console.log('OK cleanup subset');
}
