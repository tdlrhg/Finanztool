(function () {
  'use strict';

  function renderDashboard(root) {
    const state = getState();
    const gesamtSaldo = state.konten.reduce((sum, k) => sum + kontoSaldo(k.id), 0);
    const aktuellerMonat = monthKey();
    const transaktionenDiesenMonat = state.transaktionen.filter(t => !istTransfer(t) && monthKey(t.datum) === aktuellerMonat);
    const einnahmen = transaktionenDiesenMonat.filter(t => t.betrag > 0).reduce((sum, t) => sum + t.betrag, 0);
    const ausgaben = transaktionenDiesenMonat.filter(t => t.betrag < 0).reduce((sum, t) => sum + t.betrag, 0);

    root.appendChild(mk('h1', { text: 'Übersicht' }));
    root.appendChild(mk('div.sub', { text: 'Der aktuelle Stand deiner Konten und Buchungen.' }));

    root.appendChild(mk('div.grid.cols-3', {}, [
      stat('Gesamtsaldo', euro(gesamtSaldo), gesamtSaldo >= 0 ? 'pos' : 'neg'),
      stat('Einnahmen diesen Monat', euro(einnahmen), 'pos'),
      stat('Ausgaben diesen Monat', euro(Math.abs(ausgaben)), ausgaben < 0 ? 'neg' : ''),
      stat('Konten', String(state.konten.length)),
    ]));

    root.appendChild(mk('div.grid.cols-2', { style: 'margin-top:16px' }, [
      kontenCard(state),
      letzteTransaktionenCard(state),
    ]));
  }

  function stat(label, value, cls = '') {
    return mk('div.stat', {}, [
      mk('div.stat-label', { text: label }),
      mk(`div.stat-value${cls ? '.' + cls : ''}`, { text: value }),
    ]);
  }

  function kontenCard(state) {
    if (!state.konten.length) {
      return mk('div.card', {}, [
        mk('h2', { text: 'Konten' }),
        mk('div.empty', { text: 'Noch keine Konten angelegt.' }),
      ]);
    }

    return mk('div.card', {}, [
      mk('h2', { text: 'Konten' }),
      mk('table', {}, [
        mk('tr', {}, [mk('th', { text: 'Name' }), mk('th', { text: 'Saldo' })]),
        ...state.konten.map(k => mk('tr', {}, [
          mk('td', { text: k.name }),
          mk('td.num', { text: euro(kontoSaldo(k.id)) }),
        ])),
      ]),
    ]);
  }

  function letzteTransaktionenCard(state) {
    const txs = state.transaktionen
      .slice()
      .sort((a, b) => (b.datum || '').localeCompare(a.datum || ''))
      .slice(0, 8);

    return mk('div.card', {}, [
      mk('h2', { text: 'Letzte Transaktionen' }),
      txs.length
        ? mk('table', {}, [
            mk('tr', {}, [mk('th', { text: 'Datum' }), mk('th', { text: 'Empfänger' }), mk('th', { text: 'Kategorie' }), mk('th', { text: 'Betrag' })]),
            ...txs.map(t => mk('tr', {}, [
              mk('td', { text: fmtDate(t.datum) }),
              mk('td', { text: t.empfaenger || t.beschreibung || '' }),
              mk('td', { text: t.kategorie || t.beschreibung || 'Ohne Kategorie' }),
              mk(`td.num${t.betrag >= 0 ? '.pos' : '.neg'}`, { text: euro(t.betrag) }),
            ])),
          ])
        : mk('div.empty', { text: 'Noch keine Transaktionen erfasst.' }),
    ]);
  }

  window.renderDashboard = renderDashboard;
})();
