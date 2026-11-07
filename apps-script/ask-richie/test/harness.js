// Run: node apps-script/ask-richie/test/harness.js — mocks Apps Script services and exercises doPost/doGet.
const fs = require('fs'), path = require('path'), assert = require('assert'), vm = require('vm');
const sent = [], cache = new Map();
const ctx = {
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ t, setMimeType() { return this; } }) },
  Utilities: {
    base64Decode: (b) => { if (!/^[A-Za-z0-9+/=]+$/.test(b)) throw new Error('bad'); return Array.from(Buffer.from(b, 'base64')).map((x) => (x > 127 ? x - 256 : x)); },
    newBlob: (bytes, type, name) => ({ bytes, type, name })
  },
  CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) || null, put: (k, v) => cache.set(k, v) }) },
  MailApp: { sendEmail: (o) => sent.push(o) },
  JSON, Math, Number, String, Date
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../Code.gs'), 'utf8'), ctx);
const post = (o) => JSON.parse(ctx.doPost({ postData: { contents: typeof o === 'string' ? o : JSON.stringify(o) } }).t);
const pdf = Buffer.from('%PDF-1.4\n%test\n').toString('base64');
assert.strictEqual(JSON.parse(ctx.doGet().t).ok, true);
assert.strictEqual(post('nope').ok, false);
assert.strictEqual(post({ email: 'x@gmail.com', filename: 'a.pdf', pdfBase64: pdf }).ok, false);
assert.strictEqual(post({ email: 'x@hwt.co.za.evil.com', filename: 'a.pdf', pdfBase64: pdf }).ok, false);
assert.strictEqual(post({ email: 'x@nothwt.co.za', filename: 'a.pdf', pdfBase64: pdf }).ok, false);
assert.strictEqual(post({ email: 'x@hwt.co.za', filename: 'a.pdf', pdfBase64: Buffer.from('hello').toString('base64') }).error, 'That file is not a PDF.');
assert.strictEqual(post({ email: 'x@hwt.co.za', filename: 'a.pdf', pdfBase64: 'A'.repeat(28 * 1024 * 1024) }).error, 'PDF is larger than 20 MB.');
const ok = post({ email: 'Grant.Unser@HWT.co.za', name: 'Grant', filename: '../../evil<>name.PDF', pdfBase64: pdf, note: 'Client X, by Friday' });
assert.deepStrictEqual(ok, { ok: true });
const m = sent[0];
assert.strictEqual(m.to, 'johan@hwt.co.za');
assert.strictEqual(m.replyTo, 'grant.unser@hwt.co.za');
assert.strictEqual(m.subject, 'Ask Richie: Option A \u2013 evil name.pdf');
assert(m.body.startsWith('Requested by grant.unser@hwt.co.za (Grant)') && m.body.includes('Client X, by Friday'));
assert.strictEqual(m.attachments[0].name, 'evil name.pdf');
for (let i = 0; i < 9; i++) assert.strictEqual(post({ email: 'grant.unser@hwt.co.za', filename: 'a.pdf', pdfBase64: pdf }).ok, true);
assert.match(post({ email: 'grant.unser@hwt.co.za', filename: 'a.pdf', pdfBase64: pdf }).error, /Too many/);
assert.strictEqual(sent.length, 10);
console.log('OK ask-richie harness');
