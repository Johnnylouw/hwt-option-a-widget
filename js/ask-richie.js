'use strict';

/* Ask Richie: emails the PDF to Richie via the Apps Script web app. Hidden while ASK_RICHIE_URL is empty. */
(function () {
  var url = (window.HWT_CONFIG && window.HWT_CONFIG.ASK_RICHIE_URL) || '';
  var panel = document.getElementById('richie');
  if (!panel || !url) return;
  panel.hidden = false;

  var MAX = 20 * 1024 * 1024;
  var form = document.getElementById('richie-form');
  var email = document.getElementById('richie-email');
  var note = document.getElementById('richie-note');
  var fileLabel = document.getElementById('richie-file');
  var pick = document.getElementById('richie-pick');
  var input = document.getElementById('richie-input');
  var send = document.getElementById('richie-send');
  var msg = document.getElementById('richie-msg');
  var file = null;

  try { email.value = localStorage.getItem('hwt.richie.email') || ''; } catch (e) {}

  function say(text, kind) { msg.textContent = text || ''; msg.className = 'rf-msg' + (kind ? ' ' + kind : ''); }
  function setFile(f) {
    file = f || null;
    fileLabel.textContent = file ? file.name + ' (' + (file.size / 1048576).toFixed(1) + ' MB)' : 'No PDF selected';
    say('');
  }
  function validEmail(v) { return /^[a-z0-9._%+\-]+@hwt\.co\.za$/i.test(String(v).trim()); }

  document.addEventListener('hwt:files', function (e) {
    var pdf = (e.detail || []).find(function (f) { return /\.pdf$/i.test(f.name) || f.type === 'application/pdf'; });
    if (pdf) setFile(pdf);
  });
  pick.addEventListener('click', function () { input.click(); });
  input.addEventListener('change', function () { if (input.files[0]) setFile(input.files[0]); input.value = ''; });

  function toBase64(f) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { reject(new Error('Could not read the PDF.')); };
      r.readAsDataURL(f);
    });
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var addr = email.value.trim();
    if (!validEmail(addr)) { say('Use your @hwt.co.za email address.', 'err'); email.focus(); return; }
    if (!file) { say('Choose or drop a PDF first.', 'err'); return; }
    if (file.size > MAX) { say('That PDF is larger than 20 MB.', 'err'); return; }
    try { localStorage.setItem('hwt.richie.email', addr); } catch (err) {}
    send.disabled = true;
    say('Sending ' + file.name + '…', 'busy');
    try {
      var b64 = await toBase64(file);
      var res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ email: addr, name: '', filename: file.name, pdfBase64: b64, note: note.value.trim() }),
        redirect: 'follow'
      });
      var data = await res.json().catch(function () { return { ok: false, error: 'Unexpected reply from the server.' }; });
      if (data && data.ok) { say('Sent. Richie will email the Option A PDF to ' + addr + '.', 'ok'); note.value = ''; }
      else say((data && data.error) || 'Could not send. Try again.', 'err');
    } catch (err) {
      say('Could not reach Richie. Check your connection and try again.', 'err');
    } finally {
      send.disabled = false;
    }
  });
})();
