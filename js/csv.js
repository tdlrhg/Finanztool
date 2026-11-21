// Generischer CSV-Parser: erkennt , oder ; als Trenner, unterstützt Anführungszeichen

(function () {
  'use strict';

  function parseCSV(text) {
    const cleaned = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    const firstLine = cleaned.split('\n')[0] || '';
    const delimiter = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';

    const rows = [];
    for (const line of cleaned.split('\n')) {
      if (!line.trim()) continue;
      rows.push(parseLine(line, delimiter));
    }
    return rows;
  }

  function parseLine(line, delimiter) {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else cur += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === delimiter) { cells.push(cur); cur = ''; }
        else cur += c;
      }
    }
    cells.push(cur);
    return cells.map(c => c.trim());
  }

  // Versucht ein Datum in beliebigem gängigen Format nach YYYY-MM-DD umzuwandeln
  function normalizeDate(str) {
    if (!str) return '';
    str = str.trim();
    let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
    if (m) {
      let [, d, mo, y] = m;
      if (y.length === 2) y = '20' + y;
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) {
      let [, mo, d, y] = m;
      if (y.length === 2) y = '20' + y;
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return str;
  }

  // Wandelt Betragsangaben wie "1.234,56" oder "-45,00" oder "1234.56" in eine Zahl um
  function normalizeAmount(str) {
    if (typeof str === 'number') return str;
    if (!str) return 0;
    str = str.trim().replace(/[^\d,.\-]/g, '');
    if (str.includes(',') && str.includes('.')) {
      if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
        str = str.replace(/\./g, '').replace(',', '.');
      } else {
        str = str.replace(/,/g, '');
      }
    } else if (str.includes(',')) {
      str = str.replace(',', '.');
    }
    const n = parseFloat(str);
    return isNaN(n) ? 0 : n;
  }

  window.parseCSV = parseCSV;
  window.normalizeAmount = normalizeAmount;
  window.normalizeDate = normalizeDate;
})();
