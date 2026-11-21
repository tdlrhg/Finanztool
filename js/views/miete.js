(function () {
  'use strict';

  // Mietverwaltung: Wohnungen mit ihren Mietverhältnissen. Zahlungseingänge
  // auf den Mietkonten werden über die hinterlegten Namen den
  // Mietverhältnissen zugeordnet; was nicht passt, steht unten in
  // "Nicht zugeordnet" und lässt sich von Hand zuweisen.

  const JAHR_KEY = 'finanztool_miete_jahr';

  // UI-Zustand, der ein Neuzeichnen überlebt: welche Bereiche aufgeklappt
  // sind und was gerade bearbeitet wird (Wohnungs- oder Mietverhältnis-ID,
  // 'neu:<wohnungId>' für ein neues Mietverhältnis).
  const offen = new Set();
  let bearbeite = null;

  function ladeJahr() {
    try { return localStorage.getItem(JAHR_KEY) || ''; } catch (e) { return ''; }
  }
  function speichereJahr(jahr) {
    try { localStorage.setItem(JAHR_KEY, jahr); } catch (e) { /* egal */ }
  }

  function monateDesJahres(jahr) {
    return Array.from({ length: 12 }, (_, i) => `${jahr}-${String(i + 1).padStart(2, '0')}`);
  }

  // Akzeptiert "650,50" genauso wie "650.50".
  function zahl(v) {
    const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }

  function zahlText(n) {
    return n ? String(n).replace('.', ',') : '';
  }

  function mvLabel(mv) {
    const w = getState().wohnungen.find(w => w.id === mv.wohnungId);
    return `${w ? w.name : '?'} – ${mv.mieter || 'ohne Namen'}`;
  }

  function mvZeitraum(mv) {
    if (!mv.von) return 'ohne Beginn';
    return mv.bis ? `${monthLabel(mv.von)} – ${monthLabel(mv.bis)}` : `seit ${monthLabel(mv.von)}`;
  }

  function mietEingaengeImJahr(jahr) {
    return getState().transaktionen
      .filter(t => (t.datum || '').startsWith(jahr))
      .filter(t => istMietEingang(t) || t.mietZuordnung)
      .sort((a, b) => (a.datum < b.datum ? -1 : 1));
  }

  function aufklappbar(key, summaryText, inhalt, cls = 'mv-details') {
    const d = mk(`details.${cls}`, { open: offen.has(key) || null }, [mk('summary', { text: summaryText }), ...[].concat(inhalt)]);
    d.addEventListener('toggle', () => { if (d.open) offen.add(key); else offen.delete(key); });
    return d;
  }

  function renderMiete(root) {
    const state = getState();
    const aktuellesJahr = String(new Date().getFullYear());
    const jahr = ladeJahr() || aktuellesJahr;

    root.appendChild(mk('h1', { text: 'Mietverwaltung' }));
    root.appendChild(mk('div.sub', { text: 'Wohnungen, Mietverhältnisse und die Zahlungseingänge auf den Mietkonten.' }));

    root.appendChild(anleitung(!state.wohnungen.length));

    if (!state.konten.some(k => k.typ === 'miete')) {
      root.appendChild(mk('div.card', {}, [mk('div.empty', { text: 'Noch kein Konto mit dem Typ „Mietkonto“. Zahlungen werden nur von Mietkonten zugeordnet.' })]));
    }

    const jahre = new Set([aktuellesJahr, String(+aktuellesJahr - 1), jahr]);
    state.transaktionen.forEach(t => { if (t.datum) jahre.add(t.datum.slice(0, 4)); });
    const jahrSel = mk('select', { onchange: e => { speichereJahr(e.target.value); rerender(); } },
      [...jahre].sort().reverse().map(j => mk('option', { value: j, text: j, selected: j === jahr })));

    root.appendChild(mk('div.card', {}, [mk('div.row', {}, [wrap('Jahr', jahrSel)])]));

    state.wohnungen.forEach(w => root.appendChild(wohnungCard(w, jahr)));
    root.appendChild(neueWohnungForm());
    root.appendChild(nichtZugeordnetCard(jahr));
  }

  function anleitung(aufgeklappt) {
    const d = mk('details.card.mv-anleitung', { open: aufgeklappt || offen.has('anleitung') || null }, [
      mk('summary', { text: 'So funktioniert die Mietverwaltung' }),
      mk('ol', {}, [
        mk('li', { text: 'Wohnung anlegen, bei vermieteten Wohnungen gleich mit dem ersten Mieter.' }),
        mk('li', { text: 'Im Mietverhältnis die Kaltmiete und die Namen eintragen, wie sie auf dem Kontoauszug stehen (z.B. auch Partner*in, die überweist). Alles, was über die Kaltmiete hinaus gezahlt wird, zählt als Nebenkosten-Vorauszahlung.' }),
        mk('li', { text: 'Zahlungseingänge auf dem Mietkonto werden über diese Namen automatisch zugeordnet. Was nicht passt, steht ganz unten unter „Nicht zugeordnete Eingänge“ und lässt sich dort von Hand zuweisen.' }),
      ]),
      mk('div.sub', { text: 'Monate ohne Mietverhältnis gelten als Leerstand. Bei einem Mieterwechsel legst du in der Wohnung ein weiteres Mietverhältnis an.' }),
    ]);
    d.addEventListener('toggle', () => { if (d.open) offen.add('anleitung'); else offen.delete('anleitung'); });
    return d;
  }

  // ── Monatsdaten einer Wohnung ──
  // Die Kaltmiete ist fest vereinbart; alles, was ein Monat darüber hinaus
  // bringt, gilt als Nebenkosten-Vorauszahlung. So muss eine geänderte
  // Vorauszahlung nicht nachgepflegt werden. Liegt die Zahlung unter der
  // Kaltmiete, zählt keine Vorauszahlung und der Monat wird markiert.
  function monatsDaten(mvs, jahr) {
    const mvIds = new Set(mvs.map(mv => mv.id));
    const zahlungen = mietEingaengeImJahr(jahr).filter(t => {
      const mv = mietverhaeltnisFuerBuchung(t);
      return mv && mvIds.has(mv.id);
    });
    const summe = { kalt: 0, ist: 0, vzIst: 0, offen: 0, ohneBetrag: 0, vermietet: 0, ohneZahlung: 0 };
    let vorher = null; // letzter Monat mit Zahlung, für "NK geändert"
    const monate = monateDesJahres(jahr).map(monat => {
      const mv = mvs.find(mv => mvLaeuftIm(mv, monat)) || null;
      const kalt = mv ? mv.kaltmiete || 0 : 0;
      const ist = zahlungen.filter(t => monthKey(t.datum) === monat).reduce((s, t) => s + t.betrag, 0);
      const vzIst = mv && kalt ? Math.max(ist - kalt, 0) : 0;
      const zeile = { monat, mv, kalt, ist, vzIst, nkGeaendert: false };
      if (mv && kalt && ist >= kalt - 0.009) {
        if (vorher && vorher.mv === mv && Math.abs(vorher.vzIst - vzIst) > 0.009) zeile.nkGeaendert = true;
        vorher = zeile;
      }
      summe.kalt += kalt; summe.ist += ist; summe.vzIst += vzIst;
      if (mv) summe.vermietet++;
      if (mv && !kalt) summe.ohneBetrag++;
      if (mv && kalt && !ist) summe.ohneZahlung++;
      if (mv && kalt && ist < kalt) summe.offen += kalt - ist;
      return zeile;
    });
    return { monate, summe, zahlungen };
  }

  function statusBadge(z) {
    if (!z.mv) return z.ist ? mk('span.badge.warn', { text: 'Zahlung bei Leerstand' }) : mk('span.badge', { text: 'Leerstand' });
    if (!z.kalt) return mk('span.badge.warn', { text: 'Kaltmiete eintragen' });
    if (!z.ist) return mk('span.badge.bad', { text: 'keine Zahlung gefunden' });
    if (z.ist < z.kalt - 0.009) return mk('span.badge.bad', { text: `${euro(z.kalt - z.ist)} unter Kaltmiete` });
    if (z.nkGeaendert) return mk('span.badge.warn', { text: `NK geändert: ${euro(z.vzIst)}` });
    return mk('span.badge.ok', { text: 'bezahlt' });
  }

  // ── Wohnungskarte ──
  function wohnungCard(w, jahr) {
    const state = getState();
    const mvs = state.mietverhaeltnisse.filter(mv => mv.wohnungId === w.id).sort((a, b) => (a.von < b.von ? -1 : 1));
    const card = mk('div.card');

    if (bearbeite === w.id) {
      card.appendChild(wohnungFormular(w));
    } else {
      const stamm = [w.flaeche ? `${zahlText(w.flaeche)} m²` : null, w.mea ? `MEA ${zahlText(w.mea)}` : null].filter(Boolean).join(' · ');
      card.appendChild(mk('div.flex-between', {}, [
        mk('h2', { text: w.name + (w.selbstgenutzt ? ' (selbst bewohnt)' : '') }),
        btn('Bearbeiten', () => { bearbeite = w.id; rerender(); }, 'sm sec'),
      ]));
      if (stamm) card.appendChild(mk('div.sub', { text: stamm }));
    }
    if (w.selbstgenutzt) return card;

    const { monate, summe, zahlungen } = monatsDaten(mvs, jahr);
    card.appendChild(jahresZeile(mvs, summe, jahr));

    // Mietverhältnisse als Textzeilen, Bearbeiten öffnet das Formular.
    const liste = mk('div.mv-liste');
    if (!mvs.length) liste.appendChild(mk('div.sub', { text: 'Noch kein Mietverhältnis. Ohne Mietverhältnis gilt die Wohnung als leer stehend.' }));
    mvs.forEach(mv => liste.appendChild(bearbeite === mv.id ? mietverhaeltnisFormular(mv, w) : mietverhaeltnisZeile(mv)));
    if (bearbeite === 'neu:' + w.id) liste.appendChild(mietverhaeltnisFormular(null, w));
    else liste.appendChild(mk('div', { style: 'margin-top:8px' }, [btn('+ Mietverhältnis hinzufügen', () => { bearbeite = 'neu:' + w.id; rerender(); }, 'sm sec')]));
    card.appendChild(liste);

    card.appendChild(aufklappbar(`monate:${w.id}`, `Monate ${jahr} anzeigen`, [monatsTabelle(monate, summe, jahr)]));
    card.appendChild(aufklappbar(`zahlungen:${w.id}`, `Zugeordnete Zahlungen ${jahr} (${zahlungen.length})`,
      [zahlungen.length ? buchungsTabelle(zahlungen) : mk('div.empty', { text: 'Keine zugeordneten Zahlungen.' })]));
    return card;
  }

  function jahresZeile(mvs, summe, jahr) {
    const teile = [];
    if (!summe.vermietet) {
      teile.push(mk('span.badge', { text: `${jahr}: Leerstand` }));
    } else {
      teile.push(mk('span', { text: `${jahr}: ${euro(summe.ist)} erhalten` }));
      if (summe.ohneBetrag) teile.push(mk('span.badge.warn', { text: 'Kaltmiete im Mietverhältnis eintragen' }));
      else if (summe.offen > 0.009) teile.push(mk('span.badge.bad', { text: `${euro(summe.offen)} unter Kaltmiete` }));
      else teile.push(mk('span.badge.ok', { text: 'alles bezahlt' }));
      if (!summe.ohneBetrag) teile.push(mk('span', { text: `davon NK-Vorauszahlung ${euro(summe.vzIst)}` }));
      const leer = 12 - summe.vermietet;
      if (leer) teile.push(mk('span.badge', { text: `${leer} ${leer === 1 ? 'Monat' : 'Monate'} Leerstand` }));
    }
    return mk('div.mv-jahr', {}, teile);
  }

  function mietverhaeltnisZeile(mv) {
    const betrag = mv.kaltmiete
      ? `${euro(mv.kaltmiete)} kalt` + (mv.vorauszahlung ? ` · NK laut Vertrag ${euro(mv.vorauszahlung)}` : '')
      : null;
    return mk('div.mv-zeile', {}, [
      mk('div', {}, [
        mk('div.mv-zeile-titel', { text: `${mv.mieter || 'ohne Namen'} · ${mvZeitraum(mv)}` }),
        mk('div.sub', {}, [
          betrag ? tx(betrag) : mk('span.badge.warn', { text: 'Kaltmiete fehlt' }),
          tx(` · Namen: ${mv.zahlerNamen.length ? mv.zahlerNamen.join(', ') : '—'}`),
        ]),
      ]),
      btn('Bearbeiten', () => { bearbeite = mv.id; rerender(); }, 'sm sec'),
    ]);
  }

  // ── Formulare ──
  function eingabe(value, placeholder, type = 'text') {
    if (type === 'betrag') return mk('input.mv-betrag', { type: 'text', inputmode: 'decimal', value: zahlText(value), placeholder: placeholder || '€' });
    return mk('input', { type, value: value ?? '', placeholder: placeholder || null });
  }

  function mieterFelder(mv) {
    const f = {
      mieter: eingabe(mv?.mieter, 'Name'),
      von: eingabe(mv?.von || todayISO().slice(0, 7), null, 'month'),
      bis: eingabe(mv?.bis, null, 'month'),
      kalt: eingabe(mv?.kaltmiete, '€', 'betrag'),
      vz: eingabe(mv?.vorauszahlung, '€', 'betrag'),
      namen: mk('input', { type: 'text', value: mv ? mv.zahlerNamen.join(', ') : '', placeholder: 'leer = Name der Mieter*in' }),
    };
    f.zeilen = [
      mk('div.row', {}, [
        wrap('Mieter*in', f.mieter), wrap('Von', f.von), wrap('Bis (leer = läuft)', f.bis),
        wrap('Kaltmiete', f.kalt), wrap('NK laut Vertrag (nur Info)', f.vz),
      ]),
      mk('div.row', {}, [
        mk('div.field.mv-namen', {}, [mk('label', { text: 'Namen auf dem Kontoauszug (mehrere mit Komma trennen)' }), f.namen]),
      ]),
    ];
    f.werte = () => {
      const namen = f.namen.value.split(',').map(n => n.trim()).filter(Boolean);
      return {
        mieter: f.mieter.value.trim(), von: f.von.value, bis: f.bis.value,
        kaltmiete: zahl(f.kalt.value), vorauszahlung: zahl(f.vz.value),
        zahlerNamen: namen.length ? namen : (f.mieter.value.trim() ? [f.mieter.value.trim()] : []),
      };
    };
    return f;
  }

  function mietverhaeltnisFormular(mv, w) {
    const f = mieterFelder(mv);
    const speichern = btn('Speichern', () => {
      const werte = f.werte();
      if (!werte.mieter) { f.mieter.focus(); return; }
      if (!werte.von) { f.von.focus(); return; }
      if (!werte.kaltmiete) { f.kalt.focus(); return; }
      if (mv) updateMietverhaeltnis(mv.id, werte);
      else addMietverhaeltnis({ wohnungId: w.id, ...werte });
      bearbeite = null;
      rerender();
    }, 'sm');
    const abbrechen = btn('Abbrechen', () => { bearbeite = null; rerender(); }, 'sm sec');
    const loeschen = mv ? btn('Mietverhältnis löschen', () => {
      if (confirm(`Mietverhältnis „${mv.mieter || 'ohne Namen'}“ löschen? Die Buchungen bleiben erhalten.`)) { bearbeite = null; deleteMietverhaeltnis(mv.id); rerender(); }
    }, 'sm danger') : null;
    return mk('div.mv-block', {}, [
      mk('div.mv-zeile-titel', { text: mv ? 'Mietverhältnis bearbeiten' : 'Neues Mietverhältnis' }),
      ...f.zeilen,
      mk('div.row', { style: 'margin-bottom:12px' }, [speichern, abbrechen, loeschen]),
    ]);
  }

  function wohnungFormular(w) {
    const name = eingabe(w.name);
    const flaeche = eingabe(w.flaeche, 'm²', 'betrag');
    const mea = eingabe(w.mea, 'z.B. 125,5', 'betrag');
    const selbst = mk('input', { type: 'checkbox', checked: w.selbstgenutzt || null });
    return mk('div', {}, [
      mk('h2', { text: 'Wohnung bearbeiten' }),
      mk('div.row', {}, [
        wrap('Name', name), wrap('Wohnfläche (m²)', flaeche), wrap('Miteigentumsanteil', mea),
        mk('label.inline-check', {}, [selbst, tx('selbst bewohnt')]),
      ]),
      mk('div.row', { style: 'margin-bottom:12px' }, [
        btn('Speichern', () => {
          if (!name.value.trim()) { name.focus(); return; }
          updateWohnung(w.id, { name: name.value.trim(), flaeche: zahl(flaeche.value), mea: zahl(mea.value), selbstgenutzt: selbst.checked });
          bearbeite = null;
          rerender();
        }, 'sm'),
        btn('Abbrechen', () => { bearbeite = null; rerender(); }, 'sm sec'),
        btn('Wohnung löschen', () => {
          if (confirm(`Wohnung „${w.name}“ mit allen Mietverhältnissen löschen? Die Buchungen bleiben erhalten.`)) { bearbeite = null; deleteWohnung(w.id); rerender(); }
        }, 'sm danger'),
      ]),
    ]);
  }

  function neueWohnungForm() {
    const name = eingabe('', 'z.B. Wohnung 1. OG');
    const flaeche = eingabe(0, 'm²', 'betrag');
    const mea = eingabe(0, 'z.B. 125,5', 'betrag');
    const selbst = mk('input', { type: 'checkbox' });
    const f = mieterFelder(null);
    const mieterBereich = mk('div', {}, [mk('div.mv-zeile-titel', { text: 'Erste*r Mieter*in (leer lassen, wenn die Wohnung gerade leer steht)' }), ...f.zeilen]);
    selbst.addEventListener('change', () => { mieterBereich.style.display = selbst.checked ? 'none' : ''; });

    const submit = btn('Wohnung anlegen', () => {
      if (!name.value.trim()) { name.focus(); return; }
      const werte = f.werte();
      if (!selbst.checked && werte.mieter && !werte.von) { f.von.focus(); return; }
      const w = addWohnung({ name: name.value.trim(), flaeche: zahl(flaeche.value), mea: zahl(mea.value), selbstgenutzt: selbst.checked });
      if (!selbst.checked && werte.mieter) addMietverhaeltnis({ wohnungId: w.id, ...werte });
      rerender();
    });
    return mk('div.card', {}, [
      mk('h2', { text: 'Neue Wohnung' }),
      mk('div.row', {}, [
        wrap('Name', name), wrap('Wohnfläche (m²)', flaeche), wrap('Miteigentumsanteil', mea),
        mk('label.inline-check', {}, [selbst, tx('selbst bewohnt')]),
      ]),
      mieterBereich,
      mk('div.row', {}, [submit]),
    ]);
  }

  // ── Tabellen ──
  function monatsTabelle(monate, summe, jahr) {
    return mk('div.table-wrap', {}, [
      mk('table', {}, [
        mk('tr', {}, ['Monat', 'Mieter*in', 'Kaltmiete', 'Zahlung', 'davon NK', 'Status'].map(h => mk('th', { text: h }))),
        ...monate.map(z => mk('tr', {}, [
          mk('td', { text: monthLabel(z.monat) }),
          mk('td', { text: z.mv ? z.mv.mieter : '—' }),
          mk('td.num', { text: euro(z.kalt) }),
          mk('td.num', { text: euro(z.ist) }),
          mk('td.num', { text: euro(z.vzIst) }),
          mk('td', {}, [statusBadge(z)]),
        ])),
        mk('tr.jahr-zeile', {}, [
          mk('td', { text: `Summe ${jahr}` }), mk('td'),
          mk('td.num', { text: euro(summe.kalt) }), mk('td.num', { text: euro(summe.ist) }),
          mk('td.num', { text: euro(summe.vzIst) }), mk('td'),
        ]),
      ]),
    ]);
  }

  function nichtZugeordnetCard(jahr) {
    const eingaenge = mietEingaengeImJahr(jahr);
    const offenListe = eingaenge.filter(t => t.mietZuordnung !== 'keine' && !mietverhaeltnisFuerBuchung(t));
    const keine = eingaenge.filter(t => t.mietZuordnung === 'keine');
    return mk('div.card', {}, [
      mk('h2', { text: `Nicht zugeordnete Eingänge ${jahr}` }),
      mk('div.sub', { text: 'Eingänge auf Mietkonten, deren Name zu keinem Mietverhältnis passt. Trag den Namen beim Mietverhältnis ein oder wähle die Zuordnung hier von Hand.' }),
      offenListe.length ? buchungsTabelle(offenListe) : mk('div.empty', { text: 'Alles zugeordnet.' }),
      keine.length ? aufklappbar('keine', `Als „keine Mietzahlung“ markiert (${keine.length})`, [buchungsTabelle(keine)]) : null,
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

  function wrap(label, input) {
    return mk('div.field', {}, [mk('label', { text: label }), input]);
  }

  window.renderMiete = renderMiete;
})();
