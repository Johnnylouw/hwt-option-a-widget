/**
 * Ask Richie – receives a PDF from the HWT Option A widget and emails it to Johan.
 * Deploy as web app: Execute as = Me (johan@hwt.co.za), Who has access = Anyone.
 * The widget POSTs JSON with Content-Type text/plain (no CORS preflight).
 */
var TO = 'johan@hwt.co.za';
var DOMAIN = '@hwt.co.za';
var MAX_BYTES = 20 * 1024 * 1024;
var RATE_LIMIT = 10;          // requests per email
var RATE_WINDOW_S = 60 * 60;  // per hour

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ ok: true, service: 'ask-richie', time: new Date().toISOString() });
}

function sanitiseFilename_(name) {
  var base = String(name || '').split(/[\\/]/).pop();
  base = base.replace(/[\u0000-\u001f<>:"|?*\\\/]+/g, ' ').replace(/\s+/g, ' ').trim();
  base = base.replace(/\.pdf$/i, '').slice(0, 120).trim() || 'document';
  return base + '.pdf';
}

function cleanText_(s, max) {
  return String(s || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}

function validEmail_(email) {
  var e = String(email || '').trim().toLowerCase();
  if (!/^[a-z0-9._%+\-]+@hwt\.co\.za$/.test(e)) return '';
  return e;
}

function handle_(body) {
  var data;
  try { data = JSON.parse(body || '{}'); } catch (err) { return { ok: false, error: 'Request was not valid JSON.' }; }
  var email = validEmail_(data.email);
  if (!email) return { ok: false, error: 'Use your @hwt.co.za email address.' };
  var b64 = String(data.pdfBase64 || '').replace(/^data:application\/pdf;base64,/, '').replace(/\s+/g, '');
  if (!b64) return { ok: false, error: 'No PDF was attached.' };
  if (b64.length > Math.ceil(MAX_BYTES / 3) * 4 + 8) return { ok: false, error: 'PDF is larger than 20 MB.' };
  var bytes;
  try { bytes = Utilities.base64Decode(b64); } catch (err) { return { ok: false, error: 'PDF data could not be read.' }; }
  if (bytes.length > MAX_BYTES) return { ok: false, error: 'PDF is larger than 20 MB.' };
  // %PDF-
  if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46 || bytes[4] !== 0x2d) {
    return { ok: false, error: 'That file is not a PDF.' };
  }
  var cache = CacheService.getScriptCache();
  var key = 'rl:' + email;
  var count = Number(cache.get(key) || 0);
  if (count >= RATE_LIMIT) return { ok: false, error: 'Too many requests from this address. Try again in an hour.' };
  cache.put(key, String(count + 1), RATE_WINDOW_S);

  var filename = sanitiseFilename_(data.filename);
  var name = cleanText_(data.name, 120);
  var note = cleanText_(data.note, 2000);
  var blob = Utilities.newBlob(bytes, 'application/pdf', filename);
  var lines = ['Requested by ' + email + (name ? ' (' + name + ')' : ''), ''];
  if (note) lines.push('Note:', note, '');
  lines.push('Please convert the attached PDF to warm Option A and reply to the requester.', '', 'Sent from the HWT Option A widget.');
  MailApp.sendEmail({
    to: TO,
    replyTo: email,
    subject: 'Ask Richie: Option A \u2013 ' + filename,
    body: lines.join('\n'),
    attachments: [blob],
    name: 'Ask Richie (Option A widget)'
  });
  return { ok: true };
}

function doPost(e) {
  try {
    return json_(handle_(e && e.postData ? e.postData.contents : ''));
  } catch (err) {
    return json_({ ok: false, error: 'Server error: ' + (err && err.message ? err.message : err) });
  }
}
