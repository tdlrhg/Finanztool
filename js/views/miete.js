(function () {
  'use strict';

  // Mietverwaltung: Wohnungen mit ihren Mietverhältnissen. Zahlungseingänge
  // auf den Mietkonten werden über die hinterlegten Namen den
  // Mietverhältnissen zugeordnet; was nicht passt, steht unten in
  // "Nicht zugeordnet" und lässt sich von Hand zuweisen.

  const JAHR_KEY = 'finanztool_miete_jahr';

  function ladeJahr() {
    try { return localStorage.getItem(JAHR_KEY) || ''; } catch (e) { return ''; }
  }
  function speichereJahr(jahr) {
    try { localStorage.setItem(JAHR_KEY, jahr); } catch (e) { /* egal */ }
  }

  function monateDesJahres(jahr) {
    return Array.from({ length: 12 }, (_, i) => `${jahr}-${String(i + 1).padStart(2, '0')}`);
  }

  function zahl(v) {
    const n = parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }

  function mvLabel(mv) {
    const w = getState().wohnungen.find(w => w.id === mv.wohnungId);
    return `${w ? w.name : '?'} – ${mv.mieter || 'ohne Namen'}`;
  }

  function mietEingaengeImJahr(jahr) {
    return getState().transaktionen
      .filter(t => (t.datum || '').startsWith(jahr))
      .filter(t => istMietEingang(t) || t.mietZuordnung)
      .sort((a, b) => (a.datum < b.datum ? -1 : 1));
  }

  function renderMiete(root) {
    const state = getState();
    const aktuellesJahr = String(new Date().getFullYear());
    const jahr = ladeJahr() || aktuellesJahr;

    root.appendChild(mk('h1', { text: 'Mietverwaltung' }));
    root.appendChild(mk('div.sub', { text: 'Wohnungen, Mietverhältnisse und die Zahlungseingänge auf den Mietkonten.' }));

    if (!state.konten.some(k => k.typ === 'miete')) {
      root.appendChild(mk('div.card', {}, [mk('div.empty', { text: 'Noch kein Konto mit dem Typ „Mietkonto“. Zahlungen werden nur von Mietkonten zugeordnet.' })]));
    }

    const jahre = new Set([aktuellesJahr, String(+aktuellesJahr - 1), jahr]);
    state.transaktionen.forEach(t => { if (t.datum) jahre.add(t.datum.slice(0, 4)); });
    const jahrSel = mk('select', { onchange: e => { speichereJahr(e.target.value); rerender(); } },
      [...jahre].sort().reverse().map(j => mk('option', { value: j, text: j, selected: j === jahr })));

    root.appendChild(mk('div.card', {}, [
      mk('div.row', {}, [wrap('Jahr', jahrSel)]),
    ]));

    state.wohnungen.forEach(w => root.appendChild(wohnungCard(w, jahr)));
    root.appendChild(neueWohnungForm());
    root.appendChild(nichtZugeordnetCard(jahr));
  }

  // ── Wohnung anlegen ──
  function neueWohnungForm() {
    const name = mk('input', { type: 'text', placeholder: 'z.B. Wohnung 1. OG' });
    const flaeche = mk('input', { type: 'number', step: '0.01', placeholder: 'm²' });
    const mea = mk('input', { type: 'number', step: '0.001', placeholder: 'z.B. 125,5' });
    const selbst = mk('input', { type: 'checkbox' });
    const submit = btn('Wohnung anlegen', () => {
      if (!name.value.trim()) { name.focus(); return; }
      addWohnung({ name: name.value.trim(), flaeche: zahl(flaeche.value), mea: zahl(mea.value), selbstgenutzt: selbst.checked });
      rerender();
    });
    return mk('div.card', {}, [
      mk('h2', { text: 'Neue Wohnung' }),
      mk('div.row', {}, [
        wrap('Name', name), wrap('Wohnfläche (m²)', flaeche), wrap('Miteigentumsanteil', mea),
        mk('label.inline-check', {}, [selbst, tx('selbst bewohnt')]),
        submit,
      ]),
    ]);
  }

  // ── Wohnung mit Mietverhältnissen und Monatstabelle ──
  function wohnungCard(w, jahr) {
    const state = getState();
    const mvs = state.mietverhaeltnisse.filter(mv => mv.wohnungId === w.id).sort((a, b) => (a.von < b.von ? -1 : 1));

    const kopf = mk('div.flex-between', {}, [
      mk('h2', { text: w.name + (w.selbstgenutzt ? ' (selbst bewohnt)' : '') }),
      btn('Wohnung löschen', () => {
        if (confirm(`Wohnung „${w.name}“ mit allen Mietverhältnissen löschen? Die Buchungen bleiben erhalten.`)) { deleteWohnung(w.id); rerender(); }
      }, 'sm danger'),
    ]);

    const stammdaten = mk('div.row', {}, [
      wrap('Name', feld('text', w.name, v => updateWohnung(w.id, { name: v.trim() || w.name }))),
      wrap('Wohnfläche (m²)', feld('number', w.flaeche || '', v => updateWohnung(w.id, { flaeche: zahl(v) }), '0.01')),
      wrap('Miteigentumsanteil', feld('number', w.mea || '', v => updateWohnung(w.id, { mea: zahl(v) }), '0.001')),
      mk('label.inline-check', {}, [
        mk('input', { type: 'checkbox', checked: w.selbstgenutzt || null, onchange: e => { updateWohnung(w.id, { selbstgenutzt: e.target.checked }); rerender(); } }),
        tx('selbst bewohnt'),
      ]),
    ]);

    const card = mk('div.card', {}, [kopf, stammdaten]);
    if (w.selbstgenutzt) return card;

    card.appendChild(mk('h3.miete-h3', { text: 'Mietverhältnisse' }));
    if (!mvs.length) card.appendChild(mk('div.sub', { text: 'Noch kein Mietverhältnis. Ohne Mietverhältnis gilt die Wohnung als leer stehend.' }));
    mvs.forEach(mv => card.appendChild(mietverhaeltnisBlock(mv)));
    card.appendChild(neuesMietverhaeltnisForm(w));

    card.appendChild(mk('h3.miete-h3', { text: `Zahlungen ${jahr}` }));
    card.appendChild(monatsTabelle(w, mvs, jahr));
    card.appendChild(zahlungsListe(mvs, jahr));
    return card;
  }

  function mietverhaeltnisBlock(mv) {
    const gesamt = (mv.kaltmiete || 0) + (mv.vorauszahlung || 0);
    return mk('div.mv-block', {}, [
      mk('div.row', {}, [
        wrap('Mieter*in', feld('text', mv.mieter, v => updateMietverhaeltnis(mv.id, { mieter: v.trim() }))),
        wrap('Von', feld('month', mv.von, v => updateMietverhaeltnis(mv.id, { von: v }))),
        wrap('Bis (leer = läuft)', feld('month', mv.bis, v => updateMietverhaeltnis(mv.id, { bis: v }))),
        wrap('Kaltmiete', feld('number', mv.kaltmiete || '', v => updateMietverhaeltnis(mv.id, { kaltmiete: zahl(v) }), '0.01')),
        wrap('NK-Vorauszahlung', feld('number', mv.vorauszahlung || '', v => updateMietverhaeltnis(mv.id, { vorauszahlung: zahl(v) }), '0.01')),
        mk('div.field', {}, [mk('label', { text: 'Gesamt / Monat' }), mk('div.mv-gesamt', { text: euro(gesamt) })]),
      ]),
      mk('div.row', {}, [
        mk('div.field.mv-namen', {}, [
          mk('label', { text: 'Namen auf dem Kontoauszug (mit Komma getrennt)' }),
          feld('text', mv.zahlerNamen.join(', '), v => updateMietverhaeltnis(mv.id, { zahlerNamen: v.split(',').map(n => n.trim()).filter(Boolean) })),
        ]),
        mk('div.field', {}, [btn('Mietverhältnis löschen', () => {
          if (confirm(`Mietverhältnis „${mv.mieter || 'ohne Namen'}“ löschen? Die Buchungen bleiben erhalten.`)) { deleteMietverhaeltnis(mv.id); rerender(); }
        }, 'sm danger')]),
      ]),
    ]);
  }

  function neuesMietverhaeltnisForm(w) {
    const mieter = mk('input', { type: 'text', placeholder: 'Name' });
    const von = mk('input', { type: 'month', value: todayISO().slice(0, 7) });
    const bis = mk('input', { type: 'month' });
    const kalt = mk('input', { type: 'number', step: '0.01', placeholder: '€' });
    const vz = mk('input', { type: 'number', step: '0.01', placeholder: '€' });
    const namen = mk('input', { type: 'text', placeholder: 'wie auf dem Kontoauszug' });
    const submit = btn('Mietverhältnis anlegen', () => {
      if (!mieter.value.trim()) { mieter.focus(); return; }
      if (!von.value) { von.focus(); return; }
      const zahlerNamen = namen.value.split(',').map(n => n.trim()).filter(Boolean);
      addMietverhaeltnis({
        wohnungId: w.id, mieter: mieter.value.trim(), von: von.value, bis: bis.value,
        kaltmiete: zahl(kalt.value), vorauszahlung: zahl(vz.value),
        zahlerNamen: zahlerNamen.length ? zahlerNamen : [mieter.value.trim()],
      });
      rerender();
    }, 'sm');
    return mk('details.mv-neu', {}, [
      mk('summary', { text: '+ Mietverhältnis hinzufügen' }),
      mk('div.row', { style: 'margin-top:10px' }, [
        wrap('Mieter*in', mieter), wrap('Von', von), wrap('Bis (leer = läuft)', bis),
        wrap('Kaltmiete', kalt), wrap('NK-Vorauszahlung', vz),
      ]),
      mk('div.row', {}, [
        mk('div.field.mv-namen', {}, [mk('label', { text: 'Namen auf dem Kontoauszug (mit Komma getrennt, leer = Name der Mieter*in)' }), namen]),
        mk('div.field', {}, [submit]),
      ]),
    ]);
  }

  // Monat für Monat: Soll laut Mietverhältnis, Ist aus den zugeordneten
  // Zahlungen. "davon NK" rechnet eine Zahlung zuerst auf die
  // Vorauszahlung an (bis zur vereinbarten Höhe), der Rest ist Kaltmiete.
  function monatsTabelle(w, mvs, jahr) {
    const mvIds = new Set(mvs.map(mv => mv.id));
    const zahlungen = mietEingaengeImJahr(jahr).filter(t => {
      const mv = mietverhaeltnisFuerBuchung(t);
      return mv && mvIds.has(mv.id);
    });
    const summe = { soll: 0, ist: 0, vzSoll: 0, vzIst: 0 };
    const zeilen = monateDesJahres(jahr).map(monat => {
      const mv = mvs.find(mv => mvLaeuftIm(mv, monat));
      const soll = mv ? (mv.kaltmiete || 0) + (mv.vorauszahlung || 0) : 0;
      const ist = zahlungen.filter(t => monthKey(t.datum) === monat).reduce((s, t) => s + t.betrag, 0);
      const vzSoll = mv ? mv.vorauszahlung || 0 : 0;
      const vzIst = mv ? Math.min(Math.max(ist, 0), vzSoll) : 0;
      summe.soll += soll; summe.ist += ist; summe.vzSoll += vzSoll; summe.vzIst += vzIst;
      const diff = ist - soll;
      let status;
      if (!mv) status = ist ? mk('span.badge.warn', { text: 'Zahlung bei Leerstand' }) : mk('span.badge', { text: 'Leerstand' });
      else if (Math.abs(diff) < 0.01) status = mk('span.badge.ok', { text: 'bezahlt' });
      else if (diff < 0) status = mk('span.badge.bad', { text: `${euro(-diff)} offen` });
      else status = mk('span.badge.warn', { text: `${euro(diff)} zu viel` });
      return mk('tr', {}, [
        mk('td', { text: monthLabel(monat) }),
        mk('td', { text: mv ? mv.mieter : '—' }),
        mk('td.num', { text: euro(soll) }),
        mk('td.num', { text: euro(ist) }),
        mk('td.num', { text: euro(vzSoll) }),
        mk('td.num', { text: euro(vzIst) }),
        mk('td', {}, [status]),
      ]);
    });
    return mk('div.table-wrap', {}, [
      mk('table', {}, [
        mk('tr', {}, ['Monat', 'Mieter*in', 'Soll', 'Ist', 'NK-VZ Soll', 'NK-VZ Ist', 'Status'].map(h => mk('th', { text: h }))),
        ...zeilen,
        mk('tr.jahr-zeile', {}, [
          mk('td', { text: `Summe ${jahr}` }), mk('td'),
          mk('td.num', { text: euro(summe.soll) }), mk('td.num', { text: euro(summe.ist) }),
          mk('td.num', { text: euro(summe.vzSoll) }), mk('td.num', { text: euro(summe.vzIst) }), mk('td'),
        ]),
      ]),
    ]);
  }

  function zahlungsListe(mvs, jahr) {
    const mvIds = new Set(mvs.map(mv => mv.id));
    const zahlungen = mietEingaengeImJahr(jahr).filter(t => {
      const mv = mietverhaeltnisFuerBuchung(t);
      return mv && mvIds.has(mv.id);
    });
    return mk('details.mv-zahlungen', {}, [
      mk('summary', { text: `Zugeordnete Zahlungen ${jahr} (${zahlungen.length})` }),
      zahlungen.length ? buchungsTabelle(zahlungen) : mk('div.empty', { text: 'Keine zugeordneten Zahlungen.' }),
    ]);
  }

  // ── Nicht zugeordnete Eingänge ──
  function nichtZugeordnetCard(jahr) {
    const eingaenge = mietEingaengeImJahr(jahr);
    const offen = eingaenge.filter(t => t.mietZuordnung !== 'keine' && !mietverhaeltnisFuerBuchung(t));
    const keine = eingaenge.filter(t => t.mietZuordnung === 'keine');
    return mk('div.card', {}, [
      mk('h2', { text: `Nicht zugeordnete Eingänge ${jahr}` }),
      mk('div.sub', { text: 'Eingänge auf Mietkonten, deren Name zu keinem Mietverhältnis passt. Ergänze den Namen beim Mietverhältnis oder ordne die Zahlung hier von Hand zu.' }),
      offen.length ? buchungsTabelle(offen) : mk('div.empty', { text: 'Alles zugeordnet.' }),
      keine.length ? mk('details.mv-zahlungen', {}, [
        mk('summary', { text: `Als „keine Mietzahlung“ markiert (${keine.length})` }),
        buchungsTabelle(keine),
      ]) : null,
    ]);
  }

  function buchungsTabelle(buchungen) {
    return mk('div.table-wrap', {}, [
      mk('table', {}, [
        mk('tr', {}, ['Datum', 'Empfänger', 'Beschreibung', 'Betrag', 'Zuordnung'].map(h => mk('th', { text: h }))),
        ...buchungen.map(t => mk('tr', {}, [
          mk('td', { text: fmtDate(t.datum) }),
          mk('td', { text: t.empfaenger || '' }),
          mk('td.mv-beschreibung', { text: t.beschreibung || '', title: t.beschreibung || '' }),
          mk('td.num', { text: euro(t.betrag) }),
          mk('td', {}, [zuordnungSelect(t)]),
        ])),
      ]),
    ]);
  }

  function zuordnungSelect(t) {
    const state = getState();
    const auto = !t.mietZuordnung ? mietverhaeltnisFuerBuchung(t) : null;
    const optionen = [
      mk('option', { value: '', text: auto ? `automatisch: ${mvLabel(auto)}` : 'automatisch (nichts passt)' }),
      ...state.mietverhaeltnisse.map(mv => mk('option', { value: mv.id, text: mvLabel(mv) })),
      mk('option', { value: 'keine', text: 'keine Mietzahlung' }),
    ];
    const sel = mk('select', { onchange: e => { setMietZuordnung(t.id, e.target.value); rerender(); } }, optionen);
    sel.value = t.mietZuordnung || '';
    return sel;
  }

  // ── Helfer ──
  function feld(type, value, onSave, step) {
    return mk('input', {
      type, value: value ?? '', step: step || null,
      onchange: e => { onSave(e.target.value); rerender(); },
    });
  }

  function wrap(label, input) {
    return mk('div.field', {}, [mk('label', { text: label }), input]);
  }

  window.renderMiete = renderMiete;
})();
