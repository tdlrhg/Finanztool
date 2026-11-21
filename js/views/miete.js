(function () {
  'use strict';

  // Liefert Monatsliste (YYYY-MM) von beginn bis inkl. aktuellem Monat
  function monthRange(beginn) {
    const months = [];
    let [y, m] = beginn.split('-').map(Number);
    const now = new Date();
    const endY = now.getFullYear(), endM = now.getMonth() + 1;
    while (y < endY || (y === endY && m <= endM)) {
      months.push(`${y}-${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return months;
  }

  function mietStatus(mietobjekt, transaktionen) {
    const months = monthRange(mietobjekt.beginn || todayISO().slice(0, 7));
    const zahlungen = transaktionen.filter(t => t.mietobjektId === mietobjekt.id);
    const perMonth = months.map(mk => {
      const ist = zahlungen.filter(t => monthKey(t.datum) === mk).reduce((s, t) => s + Math.max(t.betrag, 0), 0);
      return { monat: mk, soll: mietobjekt.sollMiete, ist, offen: mietobjekt.sollMiete - ist };
    });
    const offenGesamt = perMonth.reduce((s, m) => s + Math.max(m.offen, 0), 0);
    return { perMonth, offenGesamt };
  }

  function alleOffenePosten() {
    const { mietobjekte, transaktionen } = getState();
    return mietobjekte.map(m => ({ mietobjekt: m, ...mietStatus(m, transaktionen) })).filter(r => r.offenGesamt > 0.009);
  }

  function renderMiete(root) {
    const state = getState();

    root.appendChild(mk('h1', { text: 'Mietverwaltung' }));
    root.appendChild(mk('div.sub', { text: 'Mietobjekte, Soll-Miete und offene Posten im Blick behalten.' }));

    root.appendChild(buildForm());

    if (!state.mietobjekte.length) {
      root.appendChild(mk('div.card', {}, [mk('div.empty', { text: 'Noch keine Mietobjekte angelegt.' })]));
      return;
    }

    state.mietobjekte.forEach(m => root.appendChild(buildObjektCard(m)));
  }

  function buildForm() {
    const name = mk('input', { placeholder: 'Wohnung / Objekt', id: 'm-name' });
    const mieter = mk('input', { placeholder: 'Mieter*in', id: 'm-mieter' });
    const soll = mk('input', { type: 'number', step: '0.01', placeholder: 'Sollmiete €', id: 'm-soll' });
    const beginn = mk('input', { type: 'month', value: todayISO().slice(0, 7), id: 'm-beginn' });
    const kontoSel = mk('select', { id: 'm-konto' }, [
      mk('option', { value: '', text: '(kein Konto verknüpft)' }),
      ...getState().konten.map(k => mk('option', { value: k.id, text: k.name })),
    ]);

    const submit = btn('Mietobjekt anlegen', () => {
      if (!name.value.trim() || !soll.value) return;
      addMietobjekt({
        name: name.value.trim(),
        mieterName: mieter.value.trim(),
        sollMiete: parseFloat(soll.value),
        beginn: beginn.value,
        kontoId: kontoSel.value,
      });
      rerender();
    });

    return mk('div.card', {}, [
      mk('h2', { text: 'Neues Mietobjekt' }),
      mk('div.row', {}, [
        wrap('Objekt', name), wrap('Mieter*in', mieter), wrap('Sollmiete', soll), wrap('Beginn', beginn), wrap('Konto', kontoSel), submit,
      ]),
    ]);
  }

  function wrap(label, input) {
    return mk('div.field', {}, [mk('label', { text: label }), input]);
  }

  function buildObjektCard(m) {
    const state = getState();
    const { perMonth, offenGesamt } = mietStatus(m, state.transaktionen);
    const badge = offenGesamt > 0.009
      ? mk('span.badge.bad', { text: `${euro(offenGesamt)} offen` })
      : mk('span.badge.ok', { text: 'alles bezahlt' });

    const card = mk('div.card', {}, [
      mk('div.flex-between', {}, [
        mk('h2', { text: `${m.name}${m.mieterName ? ' – ' + m.mieterName : ''}` }),
        mk('div', {}, [badge, tx(' '), btn('Löschen', () => { if (confirm('Mietobjekt löschen?')) { deleteMietobjekt(m.id); rerender(); } }, 'sm danger')]),
      ]),
      mk('div.sub', { text: `Sollmiete ${euro(m.sollMiete)} / Monat · seit ${m.beginn}` }),
    ]);

    const table = mk('table', {}, [
      mk('tr', {}, [mk('th', { text: 'Monat' }), mk('th', { text: 'Soll' }), mk('th', { text: 'Ist' }), mk('th', { text: 'Status' })]),
      ...perMonth.slice().reverse().map(pm => mk('tr', {}, [
        mk('td', { text: monthLabel(pm.monat) }),
        mk('td.num', { text: euro(pm.soll) }),
        mk('td.num', { text: euro(pm.ist) }),
        mk('td', {}, [pm.offen > 0.009 ? mk('span.badge.bad', { text: `${euro(pm.offen)} offen` }) : mk('span.badge.ok', { text: 'bezahlt' })]),
      ])),
    ]);
    card.appendChild(table);

    card.appendChild(buildZahlungForm(m));
    return card;
  }

  function buildZahlungForm(m) {
    const betrag = mk('input', { type: 'number', step: '0.01', placeholder: 'Betrag €' });
    const datum = mk('input', { type: 'date', value: todayISO() });
    const submitBtn = btn('Zahlung erfassen', () => {
      if (!betrag.value) return;
      addTransaktion({
        datum: datum.value,
        betrag: parseFloat(betrag.value),
        kategorie: 'Mieteinnahme',
        kontoId: m.kontoId || '',
        beschreibung: `Miete ${m.name}`,
        mietobjektId: m.id,
      });
      rerender();
    }, 'sm');

    return mk('div.row', { style: 'margin-top:10px' }, [wrap('Zahlung Datum', datum), wrap('Betrag', betrag), submitBtn]);
  }

  window.renderMiete = renderMiete;
  window.mietStatus = mietStatus;
  window.alleOffenePosten = alleOffenePosten;
})();
