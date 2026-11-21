(function () {
  'use strict';

  const KONTO_TYPEN = [
    ['giro', 'Girokonto'],
    ['kreditkarte', 'Kreditkarte'],
    ['paypal', 'PayPal'],
    ['spar', 'Sparkonto'],
    ['miete', 'Mietkonto'],
    ['bargeld', 'Bargeld'],
  ];

  function renderKonten(root, options = {}) {
    const state = getState();
    if (!options.embedded) {
      root.appendChild(mk('h1', { text: 'Konten' }));
      root.appendChild(mk('div.sub', { text: 'Alle Konten mit Startsaldo. Der laufende Saldo ergibt sich aus Startsaldo + Transaktionen.' }));
    }

    root.appendChild(buildForm());

    if (!state.konten.length) {
      root.appendChild(mk('div.card', {}, [mk('div.empty', { text: 'Noch keine Konten angelegt.' })]));
      return;
    }

    const rows = state.konten.map(k => mk('tr', {}, [
      mk('td', {}, [mk('span.color-dot', { style: `background:${k.farbe}` }), tx(k.name)]),
      mk('td', {}, [kontoTypSelect(k)]),
      mk('td.num', { text: euro(k.startsaldo) }),
      mk('td.num', { text: euro(kontoSaldo(k.id)) }),
      mk('td', {}, [btn('Löschen', () => { if (confirm(`Konto "${k.name}" inkl. Transaktionen löschen?`)) { deleteKonto(k.id); rerender(); } }, 'sm danger')]),
    ]));

    root.appendChild(mk('div.card', {}, [
      mk('table', {}, [
        mk('tr', {}, [mk('th', { text: 'Name' }), mk('th', { text: 'Typ' }), mk('th', { text: 'Startsaldo' }), mk('th', { text: 'Aktueller Saldo' }), mk('th', { text: '' })]),
        ...rows,
      ]),
    ]));
  }

  function buildForm() {
    const name = mk('input', { placeholder: 'Kontoname' });
    const typ = kontoTypOptions('giro');
    const start = mk('input', { type: 'number', step: '0.01', placeholder: 'Startsaldo €', value: '0' });
    const farbe = mk('input', { type: 'color', value: '#0f766e' });

    const submit = btn('Konto anlegen', () => {
      if (!name.value.trim()) return;
      addKonto({ name: name.value.trim(), typ: typ.value, startsaldo: parseFloat(start.value) || 0, farbe: farbe.value });
      rerender();
    });

    return mk('div.card', {}, [
      mk('h2', { text: 'Neues Konto' }),
      mk('div.row', {}, [
        wrap('Name', name), wrap('Typ', typ), wrap('Startsaldo', start), wrap('Farbe', farbe), submit,
      ]),
    ]);
  }

  function kontoTypSelect(konto) {
    const select = kontoTypOptions(konto.typ);
    select.addEventListener('change', () => updateKonto(konto.id, { typ: select.value }));
    return select;
  }

  function kontoTypOptions(value) {
    return mk('select', {}, KONTO_TYPEN.map(([typ, label]) => mk('option', {
      value: typ,
      text: label,
      selected: typ === value,
    })));
  }

  function wrap(label, input) {
    return mk('div.field', {}, [mk('label', { text: label }), input]);
  }

  function renderKontenZeitleiste(root) {
    const state = getState();
    if (!state.konten.length) {
      root.appendChild(mk('div.card', {}, [
        mk('h2', { text: 'Buchungs-Zeitleiste' }),
        mk('div.empty', { text: 'Noch keine Konten angelegt.' }),
      ]));
      return;
    }
    root.appendChild(mk('div.card', {}, [
      mk('h2', { text: 'Buchungs-Zeitleiste' }),
      mk('div.sub', { text: 'Zeigt pro Konto, für welche Monate Buchungen vorliegen — hilft, Lücken beim Import zu finden.' }),
      ...state.konten.map(k => kontoTimeline(k, state.transaktionen.filter(t => t.kontoId === k.id))),
    ]));
  }

  function kontoTimeline(konto, transaktionen) {
    if (!transaktionen.length) {
      return mk('div', { style: 'margin-bottom:14px' }, [
        mk('div.flex-between', {}, [
          mk('strong', { text: konto.name }),
          mk('span.muted', { text: 'Keine Buchungen' }),
        ]),
      ]);
    }
    const monate = transaktionen.map(t => monthKey(t.datum)).filter(Boolean).sort();
    const heute = monthKey(todayISO());
    const bis = monate[monate.length - 1] > heute ? monate[monate.length - 1] : heute;
    const alleMonate = monthRangeBetween(monate[0], bis);
    const counts = new Map();
    transaktionen.forEach(t => {
      const m = monthKey(t.datum);
      counts.set(m, (counts.get(m) || 0) + 1);
    });
    // Der laufende Monat taucht auf, zählt aber nicht als Lücke — der ist
    // naturgemäß noch nicht komplett importiert, solange er nicht rum ist.
    const luecken = alleMonate.filter(m => !counts.has(m) && m !== heute);

    return mk('div', { style: 'margin-bottom:18px' }, [
      mk('div.flex-between', {}, [
        mk('strong', { text: konto.name }),
        luecken.length
          ? mk('span.badge.warn', { text: `${luecken.length} Monat(e) ohne Buchungen` })
          : mk('span.badge.ok', { text: 'lückenlos' }),
      ]),
      mk('div.timeline', {}, alleMonate.map((m, i) => {
        const label = monthLabel(m);
        const showYear = i === 0 || m.endsWith('-01');
        const status = counts.has(m) ? 'filled' : (m === heute ? 'pending' : 'gap');
        return mk('div.timeline-cell', {}, [
          mk(`div.timeline-month.${status}`, {
            title: `${label}: ${status === 'pending' ? 'läuft noch' : `${counts.get(m) || 0} Buchung(en)`}`,
          }),
          mk('div.timeline-label', { text: showYear ? label : label.split(' ')[0] }),
        ]);
      })),
    ]);
  }

  function monthRangeBetween(from, to) {
    const result = [];
    let [y, m] = from.split('-').map(Number);
    const [endY, endM] = to.split('-').map(Number);
    while (y < endY || (y === endY && m <= endM)) {
      result.push(`${y}-${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return result;
  }

  window.renderKonten = renderKonten;
  window.renderKontenZeitleiste = renderKontenZeitleiste;
})();
