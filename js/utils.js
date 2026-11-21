// Kleine Helfer für Formatierung und Elementerzeugung

(function () {
  'use strict';

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function euro(n) {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n || 0);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  // Fehlendes Datum ergibt bewusst '' statt heute — sonst rutscht eine
  // Buchung ohne Datum unbemerkt in die Auswertung des aktuellen Monats,
  // während sie in datumsgefilterten Listen (Textvergleich) unsichtbar bleibt.
  function monthKey(iso) {
    return iso ? iso.slice(0, 7) : ''; // YYYY-MM
  }

  function monthLabel(key) {
    const [y, m] = key.split('-');
    const names = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    return `${names[parseInt(m, 10) - 1]} ${y}`;
  }

  // mk('div.klasse', {attr: val}, [kinder]) — knapper Elementbau
  function mk(sel, attrs = {}, children = []) {
    const [tagPart, ...classes] = sel.split('.');
    const [tag, id] = tagPart.split('#');
    const el = document.createElement(tag || 'div');
    if (id) el.id = id;
    if (classes.length) el.className = classes.join(' ');
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v !== false && v !== null && v !== undefined) el.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  function tx(text) {
    return document.createTextNode(text);
  }

  function btn(label, onClick, cls = '') {
    return mk(`button.btn${cls ? '.' + cls : ''}`, { text: label, onclick: onClick });
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  // Liest eine Datei als Text. Viele Bank-CSVs sind Windows-1252/Latin-1
  // statt UTF-8 kodiert (Umlaute werden dann zu Ersatzzeichen) — wird das
  // erkannt, liest die Funktion die Datei stattdessen als Windows-1252.
  async function readFileText(file) {
    const buffer = await file.arrayBuffer();
    const utf8 = new TextDecoder('utf-8').decode(buffer);
    if (!utf8.includes('�')) return utf8;
    try {
      return new TextDecoder('windows-1252').decode(buffer);
    } catch (e) {
      return utf8;
    }
  }

  window.uid = uid;
  window.euro = euro;
  window.fmtDate = fmtDate;
  window.todayISO = todayISO;
  window.monthKey = monthKey;
  window.monthLabel = monthLabel;
  window.mk = mk;
  window.tx = tx;
  window.btn = btn;
  window.clear = clear;
  window.readFileText = readFileText;
})();
