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
  let buchungsAuswahl = null; // eigene Kostenposition, für die gerade Buchungen gewählt werden ('neu' = neue Grundsteuer)
  let alleAusgabenZeigen = false;

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
      .filter(t => istMietEingang(t) || t.mietZuordnung || mietZuordnungFuerBuchung(t))
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
        mk('li', { text: 'Steht „Nachzahlung“, „Abrechnung“, „Guthaben“ oder „Erstattung“ im Verwendungszweck, zählt die Zahlung zur Nebenkostenabrechnung des Vorjahres statt zur Miete. Überweisungen von dir an die Mieter*in gelten als ausgezahltes Guthaben. Beides lässt sich in der Spalte „Zuordnung“ korrigieren.' }),
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
    // Nachzahlungen/Guthaben aus NK-Abrechnungen zählen nicht als Miete.
    const zugeordnet = mietEingaengeImJahr(jahr).filter(t => {
      const z = mietZuordnungFuerBuchung(t);
      return z && mvIds.has(z.mv.id);
    });
    const zahlungen = zugeordnet.filter(t => !mietZuordnungFuerBuchung(t).nkJahr);
    const summe = { kalt: 0, ist: 0, vzIst: 0, offen: 0, ohneBetrag: 0, vermietet: 0, ohneZahlung: 0 };
    let vorher = null; // letzter Monat mit Zahlung, für "NK geändert"
    const monate = monateDesJahres(jahr).map(monat => {
      const mv = mvs.find(mv => mvLaeuftIm(mv, monat)) || null;
      const kalt = mv ? kaltmieteIm(mv, monat) : 0;
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
    return { monate, summe, zugeordnet };
  }

  // Nachzahlungen und Guthaben aus Nebenkostenabrechnungen, über alle
  // Jahre, neueste Abrechnung zuerst.
  function nkAbrechnungsZahlungen(mvs) {
    const mvIds = new Set(mvs.map(mv => mv.id));
    return getState().transaktionen
      .map(t => ({ t, z: mietZuordnungFuerBuchung(t) }))
      .filter(({ z }) => z && z.nkJahr && mvIds.has(z.mv.id))
      .sort((a, b) => (a.z.nkJahr !== b.z.nkJahr ? (a.z.nkJahr < b.z.nkJahr ? 1 : -1) : (a.t.datum < b.t.datum ? -1 : 1)));
  }

  function nkAbrechnungsBlock(mvs) {
    const liste = nkAbrechnungsZahlungen(mvs);
    if (!liste.length) return null;
    return mk('div.mv-nk', {}, [
      mk('div.mv-zeile-titel', { text: 'Nebenkostenabrechnungen' }),
      ...liste.map(({ t, z }) => mk('div.mv-nk-zeile', {}, [
        mk('span', { text: `NK-Abrechnung ${z.nkJahr} · ${z.mv.mieter || 'ohne Namen'}` }),
        mk(t.betrag > 0 ? 'span.pos' : 'span.neg', {
          text: t.betrag > 0
            ? `Nachzahlung ${euro(t.betrag)} erhalten am ${fmtDate(t.datum)}`
            : `Guthaben ${euro(-t.betrag)} ausgezahlt am ${fmtDate(t.datum)}`,
        }),
      ])),
    ]);
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
    if (w.selbstgenutzt) { card.appendChild(eaZeile(w, jahr)); return card; }

    const { monate, summe, zugeordnet } = monatsDaten(mvs, jahr);
    card.appendChild(jahresZeile(mvs, summe, jahr));

    // Mietverhältnisse als Textzeilen, Bearbeiten öffnet das Formular.
    const liste = mk('div.mv-liste');
    if (!mvs.length) liste.appendChild(mk('div.sub', { text: 'Noch kein Mietverhältnis. Ohne Mietverhältnis gilt die Wohnung als leer stehend.' }));
    mvs.forEach(mv => liste.appendChild(bearbeite === mv.id ? mietverhaeltnisFormular(mv, w) : mietverhaeltnisZeile(mv, jahr)));
    if (bearbeite === 'neu:' + w.id) liste.appendChild(mietverhaeltnisFormular(null, w));
    else liste.appendChild(mk('div', { style: 'margin-top:8px' }, [btn('+ Mietverhältnis hinzufügen', () => { bearbeite = 'neu:' + w.id; rerender(); }, 'sm sec')]));
    card.appendChild(liste);
    const nk = nkAbrechnungsBlock(mvs);
    if (nk) card.appendChild(nk);
    card.appendChild(eaZeile(w, jahr));

    card.appendChild(aufklappbar(`monate:${w.id}`, `Monate ${jahr} anzeigen`, [monatsTabelle(monate, summe, jahr)]));
    card.appendChild(aufklappbar(`zahlungen:${w.id}`, `Zugeordnete Zahlungen ${jahr} (${zugeordnet.length})`,
      [zugeordnet.length ? buchungsTabelle(zugeordnet) : mk('div.empty', { text: 'Keine zugeordneten Zahlungen.' })]));
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

  function mietverhaeltnisZeile(mv, jahr) {
    const abrechenbar = monateDesJahres(jahr).some(m => mvLaeuftIm(mv, m)) && eigentuemerabrechnungFuer(mv.wohnungId, jahr);
    const aenderungen = (mv.kaltmieteAenderungen || []).filter(a => a.ab).sort((a, b) => (a.ab < b.ab ? -1 : 1));
    const kaltText = aenderungen.length
      ? [`${euro(mv.kaltmiete)} kalt`, ...aenderungen.map(a => `ab ${monthLabel(a.ab)} ${euro(a.betrag)}`)].join(' · ')
      : `${euro(mv.kaltmiete)} kalt`;
    const betrag = mv.kaltmiete
      ? kaltText + (mv.vorauszahlung ? ` · NK laut Vertrag ${euro(mv.vorauszahlung)}` : '')
      : null;
    return mk('div.mv-zeile', {}, [
      mk('div', {}, [
        mk('div.mv-zeile-titel', { text: `${mv.mieter || 'ohne Namen'} · ${mvZeitraum(mv)}` }),
        mk('div.sub', {}, [
          betrag ? tx(betrag) : mk('span.badge.warn', { text: 'Kaltmiete fehlt' }),
          tx(` · Namen: ${mv.zahlerNamen.length ? mv.zahlerNamen.join(', ') : '—'}`),
        ]),
      ]),
      mk('div.mv-knoepfe', {}, [
        abrechenbar ? btn(`Abrechnung ${jahr}`, () => druckeNkAbrechnung(mv, jahr), 'sm') : null,
        btn('Bearbeiten', () => { bearbeite = mv.id; rerender(); }, 'sm sec'),
      ]),
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
    // Änderungen der Kaltmiete (z.B. vereinbarte Minderung am Anfang oder
    // Mieterhöhung): je Zeile "ab Monat" + neuer Betrag.
    const aenderungen = (mv?.kaltmieteAenderungen || []).map(a => ({ ab: eingabe(a.ab, null, 'month'), betrag: eingabe(a.betrag, '€', 'betrag') }));
    const aenderungsBox = mk('div.mv-aenderungen');
    const zeichneAenderungen = () => {
      aenderungsBox.replaceChildren(
        ...aenderungen.map(a => mk('div.row', {}, [
          wrap('Kaltmiete ab', a.ab), wrap('Betrag', a.betrag),
          mk('div.field', {}, [btn('✕', () => { aenderungen.splice(aenderungen.indexOf(a), 1); zeichneAenderungen(); }, 'sm sec')]),
        ])),
        mk('div.field', {}, [btn('+ Kaltmiete ändert sich ab …', () => { aenderungen.push({ ab: eingabe('', null, 'month'), betrag: eingabe(0, '€', 'betrag') }); zeichneAenderungen(); }, 'sm sec')]),
      );
    };
    zeichneAenderungen();
    f.zeilen = [
      mk('div.row', {}, [
        wrap('Mieter*in', f.mieter), wrap('Von', f.von), wrap('Bis (leer = läuft)', f.bis),
        wrap('Kaltmiete (ab Beginn)', f.kalt), wrap('NK laut Vertrag (nur Info)', f.vz),
      ]),
      aenderungsBox,
      mk('div.row', {}, [
        mk('div.field.mv-namen', {}, [mk('label', { text: 'Namen auf dem Kontoauszug (mehrere mit Komma trennen)' }), f.namen]),
      ]),
    ];
    f.werte = () => {
      const namen = f.namen.value.split(',').map(n => n.trim()).filter(Boolean);
      return {
        mieter: f.mieter.value.trim(), von: f.von.value, bis: f.bis.value,
        kaltmiete: zahl(f.kalt.value), vorauszahlung: zahl(f.vz.value),
        kaltmieteAenderungen: aenderungen.filter(a => a.ab.value).map(a => ({ ab: a.ab.value, betrag: zahl(a.betrag.value) })),
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
    const titel = mk('input', { type: 'text', value: w.abrechnungsTitel || '', placeholder: 'z.B. Musterstraße 1, Whg. II in Musterstadt' });
    return mk('div', {}, [
      mk('h2', { text: 'Wohnung bearbeiten' }),
      mk('div.row', {}, [
        wrap('Name', name), wrap('Wohnfläche (m²)', flaeche), wrap('Miteigentumsanteil', mea),
        mk('label.inline-check', {}, [selbst, tx('selbst bewohnt')]),
      ]),
      mk('div.row', {}, [
        mk('div.field.mv-namen', {}, [mk('label', { text: 'Überschrift in der Nebenkostenabrechnung (Adresse und Wohnung)' }), titel]),
      ]),
      mk('div.row', { style: 'margin-bottom:12px' }, [
        btn('Speichern', () => {
          if (!name.value.trim()) { name.focus(); return; }
          updateWohnung(w.id, { name: name.value.trim(), flaeche: zahl(flaeche.value), mea: zahl(mea.value), selbstgenutzt: selbst.checked, abrechnungsTitel: titel.value.trim() });
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

  // Werte: '' = automatisch, '<mvId>' = Miete, '<mvId>|<Jahr>' =
  // Nachzahlung/Guthaben aus der NK-Abrechnung dieses Jahres, 'keine'.
  function zuordnungSelect(t) {
    const state = getState();
    const zuText = z => z ? `${mvLabel(z.mv)}${z.nkJahr ? ` · NK-Abrechnung ${z.nkJahr}` : ''}` : '';
    const auto = !t.mietZuordnung ? mietZuordnungFuerBuchung(t) : null;
    const zahlJahr = parseInt((t.datum || '').slice(0, 4), 10) || new Date().getFullYear();
    const nkJahre = [zahlJahr - 1, zahlJahr - 2, zahlJahr].map(String);
    if (t.mietNkJahr && !nkJahre.includes(t.mietNkJahr)) nkJahre.push(t.mietNkJahr);
    const optionen = [
      mk('option', { value: '', text: auto ? `automatisch: ${zuText(auto)}` : 'automatisch (nichts passt)' }),
      ...state.mietverhaeltnisse.flatMap(mv => [
        mk('option', { value: mv.id, text: `${mvLabel(mv)} · Miete` }),
        ...nkJahre.map(j => mk('option', { value: `${mv.id}|${j}`, text: `${mvLabel(mv)} · NK-Abrechnung ${j}` })),
      ]),
      mk('option', { value: 'keine', text: 'keine Mietzahlung' }),
    ];
    const sel = mk('select', {
      onchange: e => {
        const [id, nkJahr] = e.target.value.split('|');
        setMietZuordnung(t.id, id, nkJahr || '');
        rerender();
      },
    }, optionen);
    sel.value = t.mietZuordnung && t.mietZuordnung !== 'keine' && t.mietNkJahr ? `${t.mietZuordnung}|${t.mietNkJahr}` : (t.mietZuordnung || '');
    return sel;
  }

  // ── Eigentümerabrechnung ──
  // In der Karte nur eine Zeile; Erfassen und Bearbeiten im Overlay.
  // Verwalter rechnen mit ungerundeten Einzelbeträgen; wenige Cent
  // Abweichung zur Summe der gerundeten Positionen sind normal.
  const RUNDUNG = 0.05;

  // summe/umlage/abweichung: nur Verwalterabrechnung (Kontrolle gegen die
  // Abrechnung). eigene/umlageGesamt: zusätzlich eigene Kosten (Grundsteuer).
  function eaSummen(ea) {
    const summe = ea.positionen.reduce((s, p) => s + (p.betrag || 0), 0);
    const umlage = ea.positionen.filter(p => p.umlagefaehig).reduce((s, p) => s + (p.betrag || 0), 0);
    const abweichung = ea.summeLautAbrechnung != null && ea.summeLautAbrechnung !== '' ? summe - ea.summeLautAbrechnung : null;
    const eigene = ea.eigeneKosten.reduce((s, k) => s + eigeneKostenBetrag(k), 0);
    const eigeneUmlage = ea.eigeneKosten.filter(k => k.umlagefaehig).reduce((s, k) => s + eigeneKostenBetrag(k), 0);
    // Mit Heizkosten laut Messdienst ersetzen diese die Heizungsposition:
    // umlagefähig ist nur, was auf Mieter entfällt, abzüglich deines
    // CO2-Anteils; Leerstand und CO2-Anteil bleiben bei dir.
    const heizPos = heizungsPosition(ea);
    const heiz = heizSummen(ea);
    const heizKorrektur = ea.heizkosten.length && heizPos?.umlagefaehig ? heiz.mieter - (heizPos.betrag || 0) : 0;
    return { summe, umlage, nichtUmlage: summe - umlage, abweichung, eigene, umlageGesamt: umlage + eigeneUmlage + heizKorrektur };
  }

  function heizungsPosition(ea) {
    return ea.positionen.find(p => /heiz/i.test(p.bezeichnung)) || null;
  }
  function heizSummen(ea) {
    const gesamt = ea.heizkosten.reduce((s, h) => s + (h.gesamt || 0), 0);
    const mieter = ea.heizkosten.filter(h => h.nutzer !== 'leerstand').reduce((s, h) => s + (h.gesamt || 0) - (h.co2Vermieter || 0), 0);
    return { gesamt, mieter };
  }

  function eaZeile(w, jahr) {
    const ea = eigentuemerabrechnungFuer(w.id, jahr);
    const oeffnen = () => openModal(box => eaModalInhalt(box, w, jahr));
    if (!ea) {
      return mk('div.mv-ea', {}, [
        mk('span', { text: `Eigentümerabrechnung ${jahr}: noch nicht erfasst` }),
        btn('Erfassen', oeffnen, 'sm sec'),
      ]);
    }
    const z = eaSummen(ea);
    return mk('div.mv-ea', {}, [
      mk('span', {}, [
        tx(`Eigentümerabrechnung ${jahr}: ${euro(z.summe)}`),
        z.eigene ? tx(` · eigene Kosten ${euro(z.eigene)}`) : null,
        tx(' · umlagefähig '),
        mk('strong', { text: euro(z.umlageGesamt) }),
        !ea.eigeneKosten.length ? mk('span.badge.warn', { text: 'Grundsteuer fehlt', style: 'margin-left:8px' }) : null,
        heizungsPosition(ea) && !ea.heizkosten.length ? mk('span.badge.warn', { text: 'Heizkosten A&S fehlen', style: 'margin-left:8px' }) : null,
        z.abweichung != null && Math.abs(z.abweichung) > RUNDUNG ? mk('span.badge.bad', { text: `weicht ${euro(z.abweichung)} ab`, style: 'margin-left:8px' }) : null,
      ]),
      btn('Öffnen', oeffnen, 'sm sec'),
    ]);
  }

  function eaModalInhalt(box, w, jahr) {
    const neuZeichnen = () => { box.replaceChildren(); eaModalInhalt(box, w, jahr); };
    const ea = eigentuemerabrechnungFuer(w.id, jahr);
    box.appendChild(mk('h2', { text: `Eigentümerabrechnung ${jahr} · ${w.name}` }));

    const datei = mk('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
    datei.addEventListener('change', async () => {
      const f = datei.files[0];
      if (!f) return;
      try {
        const daten = JSON.parse(await f.text());
        if (!Array.isArray(daten.positionen)) throw new Error('Keine Positionen in der Datei.');
        if (daten.jahr && String(daten.jahr) !== String(jahr) && !confirm(`Die Datei ist für ${daten.jahr}, eingestellt ist ${jahr}. Trotzdem für ${jahr} übernehmen?`)) return;
        if (ea && !confirm('Die vorhandenen Positionen werden ersetzt. Fortfahren?')) return;
        speichereEigentuemerabrechnung({
          wohnungId: w.id, jahr,
          summeLautAbrechnung: daten.summeLautAbrechnung ?? null,
          positionen: daten.positionen.map(p => ({
            nr: String(p.nr ?? ''), bezeichnung: p.bezeichnung || '', schluessel: p.schluessel || '',
            schluesselTyp: p.schluesselTyp || '', schluesselAnteil: p.schluesselAnteil || '',
            gesamtbetrag: p.gesamtbetrag == null ? null : zahl(p.gesamtbetrag),
            betrag: zahl(p.betrag), umlagefaehig: !!p.umlagefaehig,
          })),
        });
        neuZeichnen();
      } catch (e) {
        alert(`Die Datei konnte nicht gelesen werden: ${e.message}`);
      }
    });

    const vorjahr = eigentuemerabrechnungFuer(w.id, String(+jahr - 1));
    const werkzeuge = mk('div.row', { style: 'margin:8px 0 14px' }, [
      datei,
      btn('Aus Datei importieren', () => datei.click(), 'sm sec'),
      vorjahr && !ea ? btn(`Positionen aus ${+jahr - 1} übernehmen`, () => {
        speichereEigentuemerabrechnung({
          wohnungId: w.id, jahr, summeLautAbrechnung: null,
          positionen: vorjahr.positionen.map(p => ({ nr: p.nr, bezeichnung: p.bezeichnung, schluessel: p.schluessel, betrag: 0, umlagefaehig: p.umlagefaehig })),
        });
        neuZeichnen();
      }, 'sm sec') : null,
      !ea ? btn('Leer anlegen', () => { speichereEigentuemerabrechnung({ wohnungId: w.id, jahr, positionen: [] }); neuZeichnen(); }, 'sm sec') : null,
    ]);
    box.appendChild(werkzeuge);
    if (!ea) {
      box.appendChild(mk('div.sub', { text: 'Importiere die Datei, die Claude aus deiner Abrechnung erzeugt hat, oder lege die Abrechnung leer an und trag die Positionen selbst ein.' }));
      return;
    }

    // Änderungen sofort speichern; Summen neu zeichnen, ohne dass das
    // gerade bearbeitete Feld den Fokus verliert.
    const speichern = () => { speichereEigentuemerabrechnung(ea); fussAktualisieren(); };
    const zeile = p => mk('tr', {}, [
      mk('td', {}, [mk('input.ea-nr', { type: 'text', value: p.nr, onchange: e => { p.nr = e.target.value.trim(); speichern(); } })]),
      mk('td', {}, [mk('input.cell-input', { type: 'text', value: p.bezeichnung, onchange: e => { p.bezeichnung = e.target.value.trim(); speichern(); } })]),
      mk('td', {}, [mk('input.cell-input', { type: 'text', value: p.schluessel, onchange: e => { p.schluessel = e.target.value.trim(); speichern(); } })]),
      mk('td', {}, [mk('input.mv-betrag', { type: 'text', inputmode: 'decimal', value: zahlText(p.betrag), onchange: e => { p.betrag = zahl(e.target.value); speichern(); } })]),
      mk('td', { style: 'text-align:center' }, [mk('input', { type: 'checkbox', checked: p.umlagefaehig || null, onchange: e => { p.umlagefaehig = e.target.checked; speichern(); } })]),
      mk('td', {}, [btn('✕', () => { ea.positionen = ea.positionen.filter(x => x !== p); speichern(); neuZeichnen(); }, 'sm sec')]),
    ]);
    box.appendChild(mk('div.table-wrap', {}, [
      mk('table.ea-tabelle', {}, [
        mk('tr', {}, ['Pos', 'Kostenstelle', 'Schlüssel', 'Ihr Anteil €', 'umlagefähig', ''].map(h => mk('th', { text: h }))),
        ...ea.positionen.map(zeile),
      ]),
    ]));
    box.appendChild(mk('div.row', { style: 'margin-top:8px' }, [
      btn('+ Position', () => { ea.positionen.push({ nr: '', bezeichnung: '', schluessel: '', betrag: 0, umlagefaehig: true }); speichern(); neuZeichnen(); }, 'sm sec'),
    ]));

    const sollFeld = mk('input.mv-betrag', {
      type: 'text', inputmode: 'decimal', value: ea.summeLautAbrechnung != null ? zahlText(ea.summeLautAbrechnung) : '',
      onchange: e => { ea.summeLautAbrechnung = e.target.value.trim() ? zahl(e.target.value) : null; speichern(); },
    });
    const fuss = mk('div.ea-fuss');
    function fussAktualisieren() {
      const z = eaSummen(ea);
      fuss.replaceChildren(
        mk('div', {}, [tx('Summe: '), mk('strong', { text: euro(z.summe) })]),
        mk('div', {}, [tx('davon umlagefähig: '), mk('strong.pos', { text: euro(z.umlage) })]),
        mk('div', {}, [tx('nicht umlagefähig: '), mk('strong', { text: euro(z.nichtUmlage) })]),
        z.abweichung == null ? mk('span.badge', { text: 'Kontrollsumme fehlt' })
          : Math.abs(z.abweichung) < 0.005 ? mk('span.badge.ok', { text: 'stimmt mit der Abrechnung überein' })
            : Math.abs(z.abweichung) <= RUNDUNG ? mk('span.badge.ok', { text: `stimmt (Rundungsdifferenz ${euro(Math.abs(z.abweichung))})` })
            : mk('span.badge.bad', { text: `Abweichung ${euro(z.abweichung)}` }),
      );
    }
    fussAktualisieren();
    box.appendChild(mk('div.row', { style: 'margin-top:16px' }, [
      wrap('„Ihr Anteil an den Betriebskosten“ laut Abrechnung', sollFeld),
    ]));
    box.appendChild(fuss);
    box.appendChild(heizkostenBlock(ea, w, speichern, neuZeichnen));
    box.appendChild(eigeneKostenBlock(ea, w, jahr, speichern, neuZeichnen));
    box.appendChild(mk('div.row', { style: 'margin-top:16px' }, [
      btn('Abrechnung löschen', () => {
        if (confirm(`Eigentümerabrechnung ${jahr} für „${w.name}“ löschen?`)) { deleteEigentuemerabrechnung(ea.id); neuZeichnen(); }
      }, 'sm danger'),
    ]));
  }

  // ── Heizkosten laut Einzelabrechnung des Messdienstes ──
  function heizkostenBlock(ea, w, speichern, neuZeichnen) {
    const mvs = getState().mietverhaeltnisse.filter(mv => mv.wohnungId === w.id).sort((a, b) => (a.von < b.von ? -1 : 1));
    const block = mk('div.ea-eigene', {}, [
      mk('h3.miete-h3', { text: 'Heizkosten laut A&S' }),
      mk('div.sub', { text: 'Je Nutzer die „Gesamtkosten“ aus der A&S-Einzelabrechnung und den nicht umlagefähigen CO2-Anteil (unter „Anteil an Kostenposition“). Bei Leerstand nur die Gesamtkosten. Diese Werte ersetzen die Heizungsposition für die Mieter.' }),
    ]);
    const zeilen = ea.heizkosten.map(h => {
      const nutzerSel = mk('select', { onchange: e => { h.nutzer = e.target.value; speichern(); neuZeichnen(); } }, [
        mk('option', { value: '', text: '– Nutzer wählen –' }),
        ...mvs.map(mv => mk('option', { value: mv.id, text: `${mv.mieter || 'ohne Namen'} (${mvZeitraum(mv)})` })),
        mk('option', { value: 'leerstand', text: 'Leerstand (trägst du)' }),
      ]);
      nutzerSel.value = h.nutzer || '';
      const leer = h.nutzer === 'leerstand';
      return mk('tr', {}, [
        mk('td', {}, [nutzerSel]),
        mk('td', {}, [mk('input.mv-betrag', { type: 'text', inputmode: 'decimal', value: zahlText(h.gesamt), onchange: e => { h.gesamt = zahl(e.target.value); speichern(); neuZeichnen(); } })]),
        mk('td', {}, [leer ? mk('span', { text: '–' }) : mk('input.mv-betrag', { type: 'text', inputmode: 'decimal', value: zahlText(h.co2Vermieter), onchange: e => { h.co2Vermieter = zahl(e.target.value); speichern(); neuZeichnen(); } })]),
        mk('td.num', { text: leer ? euro(0) : euro((h.gesamt || 0) - (h.co2Vermieter || 0)) }),
        mk('td', {}, [btn('✕', () => { ea.heizkosten = ea.heizkosten.filter(x => x !== h); speichern(); neuZeichnen(); }, 'sm sec')]),
      ]);
    });
    if (zeilen.length) {
      block.appendChild(mk('div.table-wrap', {}, [mk('table.ea-tabelle', {}, [
        mk('tr', {}, ['Nutzer', 'Gesamtkosten €', 'CO2 nicht umlagefähig €', 'Mieter zahlt', ''].map(t => mk('th', { text: t }))),
        ...zeilen,
      ])]));
    }
    block.appendChild(mk('div.row', { style: 'margin-top:8px' }, [
      btn('+ Nutzer', () => {
        const belegt = new Set(ea.heizkosten.map(h => h.nutzer));
        const vorschlag = mvs.find(mv => !belegt.has(mv.id));
        ea.heizkosten.push({ nutzer: vorschlag ? vorschlag.id : '', gesamt: 0, co2Vermieter: 0 });
        speichern(); neuZeichnen();
      }, 'sm sec'),
    ]));
    if (ea.heizkosten.length) {
      const pos = heizungsPosition(ea);
      const z = heizSummen(ea);
      const diff = pos ? z.gesamt - (pos.betrag || 0) : null;
      block.appendChild(mk('div.ea-fuss', {}, [
        mk('div', {}, [tx('Summe A&S: '), mk('strong', { text: euro(z.gesamt) })]),
        mk('div', {}, [tx('davon Mieter: '), mk('strong.pos', { text: euro(z.mieter) })]),
        diff == null ? mk('span.badge.warn', { text: 'keine Position „Heizung“ oben' })
          : Math.abs(diff) <= RUNDUNG ? mk('span.badge.ok', { text: 'passt zur Position „Heizung“' })
            : mk('span.badge.bad', { text: `weicht ${euro(diff)} von „Heizung“ ab` }),
      ]));
    }
    return block;
  }

  // ── Eigene Kosten (z.B. Grundsteuer) im Overlay ──
  const GRUNDSTEUER = /grundsteuer|grundbesitzabgabe/i;

  function eigeneKostenBlock(ea, w, jahr, speichern, neuZeichnen) {
    const block = mk('div.ea-eigene', {}, [
      mk('h3.miete-h3', { text: 'Eigene Kosten' }),
      mk('div.sub', { text: 'Kosten, die nicht über die Verwaltung laufen, z.B. die Grundsteuer. Sie zählen nicht zur Kontrollsumme oben.' }),
    ]);
    const zeilen = ea.eigeneKosten.map(k => {
      const verknuepft = k.buchungIds.length > 0;
      return mk('tr', {}, [
        mk('td', {}, [mk('input.cell-input', { type: 'text', value: k.bezeichnung, onchange: e => { k.bezeichnung = e.target.value.trim(); speichern(); } })]),
        mk('td', {}, [verknuepft
          ? mk('span', { text: `${euro(eigeneKostenBetrag(k))} aus ${k.buchungIds.length} ${k.buchungIds.length === 1 ? 'Buchung' : 'Buchungen'}` })
          : mk('input.mv-betrag', { type: 'text', inputmode: 'decimal', value: zahlText(k.betrag), onchange: e => { k.betrag = zahl(e.target.value); speichern(); neuZeichnen(); } })]),
        mk('td', { style: 'text-align:center' }, [mk('input', { type: 'checkbox', checked: k.umlagefaehig || null, onchange: e => { k.umlagefaehig = e.target.checked; speichern(); neuZeichnen(); } })]),
        mk('td', {}, [
          btn('Buchungen wählen', () => { buchungsAuswahl = k.id; neuZeichnen(); }, 'sm sec'),
          tx(' '),
          btn('✕', () => { ea.eigeneKosten = ea.eigeneKosten.filter(x => x !== k); speichern(); neuZeichnen(); }, 'sm sec'),
        ]),
      ]);
    });
    if (zeilen.length) {
      block.appendChild(mk('div.table-wrap', {}, [mk('table.ea-tabelle', {}, [
        mk('tr', {}, ['Kostenart', 'Betrag', 'umlagefähig', ''].map(h => mk('th', { text: h }))),
        ...zeilen,
      ])]));
    }
    block.appendChild(mk('div.row', { style: 'margin-top:8px' }, [
      !ea.eigeneKosten.some(k => /grundsteuer/i.test(k.bezeichnung))
        ? btn('+ Grundsteuer aus dem Mietkonto', () => { buchungsAuswahl = 'neu'; neuZeichnen(); }, 'sm') : null,
      btn('+ Eigene Position', () => { ea.eigeneKosten.push({ bezeichnung: '', betrag: 0, umlagefaehig: true, buchungIds: [] }); speichern(); neuZeichnen(); }, 'sm sec'),
    ]));
    if (buchungsAuswahl) block.appendChild(buchungsAuswahlBlock(ea, w, jahr, speichern, neuZeichnen));
    const z = eaSummen(ea);
    block.appendChild(mk('div.ea-fuss', {}, [
      mk('div', {}, [tx('Umlagefähig gesamt für die Mieter (Verwaltung, Heizkosten laut A&S, eigene Kosten): '), mk('strong.pos', { text: euro(z.umlageGesamt) })]),
    ]));
    return block;
  }

  // Ausgaben der Mietkonten im Jahr zum Ankreuzen. Standard: nur Buchungen
  // mit "Grundsteuer" im Text. Buchungen, die schon bei einer anderen
  // Wohnung verknüpft sind, werden gekennzeichnet.
  function buchungsAuswahlBlock(ea, w, jahr, speichern, neuZeichnen) {
    const state = getState();
    const k = buchungsAuswahl === 'neu' ? null : ea.eigeneKosten.find(x => x.id === buchungsAuswahl);
    const gewaehlt = new Set(k ? k.buchungIds : []);
    const vergebenAn = new Map();
    state.eigentuemerabrechnungen.forEach(andere => andere.eigeneKosten.forEach(x => {
      if (x === k) return;
      const wo = state.wohnungen.find(ww => ww.id === andere.wohnungId);
      x.buchungIds.forEach(id => vergebenAn.set(id, wo ? wo.name : '?'));
    }));
    const ausgaben = state.transaktionen
      .filter(t => (t.datum || '').startsWith(jahr) && t.betrag < 0 && istMietBuchung(t))
      .sort((a, b) => (a.datum < b.datum ? -1 : 1));
    const treffer = ausgaben.filter(t => GRUNDSTEUER.test(`${t.empfaenger || ''} ${t.beschreibung || ''}`));
    const liste = alleAusgabenZeigen ? ausgaben : treffer;

    const haken = new Map();
    const zeilen = liste.map(t => {
      const cb = mk('input', { type: 'checkbox', checked: gewaehlt.has(t.id) || null });
      haken.set(t.id, cb);
      return mk('tr', {}, [
        mk('td', {}, [cb]),
        mk('td', { text: fmtDate(t.datum) }),
        mk('td', { text: t.empfaenger || '' }),
        mk('td.mv-beschreibung', { text: t.beschreibung || '', title: t.beschreibung || '' }),
        mk('td.num', { text: euro(Math.abs(t.betrag)) }),
        mk('td', {}, [vergebenAn.has(t.id) ? mk('span.badge.warn', { text: `bei ${vergebenAn.get(t.id)}` }) : null]),
      ]);
    });

    const uebernehmen = btn('Übernehmen', () => {
      const ids = [...haken].filter(([, cb]) => cb.checked).map(([id]) => id);
      // Nicht angezeigte, aber bereits gewählte Buchungen bleiben erhalten.
      const unsichtbar = [...gewaehlt].filter(id => !haken.has(id));
      const alle = [...unsichtbar, ...ids];
      if (k) k.buchungIds = alle;
      else ea.eigeneKosten.push({ bezeichnung: 'Grundsteuer', betrag: 0, umlagefaehig: true, buchungIds: alle });
      buchungsAuswahl = null;
      speichern();
      neuZeichnen();
    }, 'sm');

    return mk('div.ea-auswahl', {}, [
      mk('div.mv-zeile-titel', { text: `Ausgaben vom Mietkonto ${jahr}: Zahlungen für ${w.name} ankreuzen` }),
      mk('label.inline-check', {}, [
        mk('input', { type: 'checkbox', checked: alleAusgabenZeigen || null, onchange: e => { alleAusgabenZeigen = e.target.checked; neuZeichnen(); } }),
        tx('alle Ausgaben zeigen, nicht nur „Grundsteuer“'),
      ]),
      zeilen.length
        ? mk('div.table-wrap', {}, [mk('table', {}, [
            mk('tr', {}, ['', 'Datum', 'Empfänger', 'Beschreibung', 'Betrag', ''].map(h => mk('th', { text: h }))),
            ...zeilen,
          ])])
        : mk('div.empty', { text: alleAusgabenZeigen ? `Keine Ausgaben auf Mietkonten in ${jahr}.` : `Keine Buchung mit „Grundsteuer“ im Text in ${jahr}. Häkchen oben setzen, um alle Ausgaben zu sehen.` }),
      mk('div.row', { style: 'margin-top:8px' }, [uebernehmen, btn('Abbrechen', () => { buchungsAuswahl = null; neuZeichnen(); }, 'sm sec')]),
    ]);
  }

  // ── Nebenkostenabrechnung für eine*n Mieter*in ──
  // Umlagefähige Positionen der Eigentümerabrechnung, anteilig nach
  // Mietmonaten im Jahr. Ausnahmen: Punkte (Personen × gewohnte Monate)
  // enthalten die Monate schon und werden nicht gekürzt – außer es gab im
  // Jahr mehrere Mietverhältnisse; Heizung kommt aus "Heizkosten laut A&S".
  // Abzüglich der tatsächlich gezahlten Vorauszahlungen vom Mietkonto.
  function nkAbrechnung(mv, jahr) {
    const ea = eigentuemerabrechnungFuer(mv.wohnungId, jahr);
    const mvsWohnung = getState().mietverhaeltnisse.filter(x => x.wohnungId === mv.wohnungId);
    const monate = monateDesJahres(jahr).filter(m => mvLaeuftIm(mv, m));
    const faktor = monate.length / 12;
    const mehrereMieter = mvsWohnung.filter(x => monateDesJahres(jahr).some(m => mvLaeuftIm(x, m))).length > 1;
    const hinweise = [];
    const heizEintrag = ea.heizkosten.find(h => h.nutzer === mv.id);

    const umlagePositionen = ea.positionen.filter(p => p.umlagefaehig)
      .sort((a, b) => (parseInt(a.nr, 10) || 0) - (parseInt(b.nr, 10) || 0));
    // Neue Gruppe nur an echten Lücken der Nummerierung der Verwaltung
    // (z.B. 11 → 14), nicht an weggelassenen nicht umlagefähigen Positionen.
    const alleNr = new Set(ea.positionen.map(p => parseInt(p.nr, 10)).filter(Number.isFinite));
    let vorherNr = null;
    const zeilen = umlagePositionen.map(p => {
      const nr = parseInt(p.nr, 10);
      let neueGruppe = false;
      if (vorherNr != null && Number.isFinite(nr)) {
        for (let n = vorherNr + 1; n < nr; n++) if (!alleNr.has(n)) { neueGruppe = true; break; }
      }
      vorherNr = Number.isFinite(nr) ? nr : vorherNr;
      const istHeizung = p.schluesselTyp === 'Zähl.' || /heiz/i.test(p.bezeichnung);
      let anteil;
      if (!p.betrag) anteil = null;
      else if (istHeizung && ea.heizkosten.length) {
        if (heizEintrag) anteil = (heizEintrag.gesamt || 0) - (heizEintrag.co2Vermieter || 0);
        else { anteil = p.betrag * faktor; hinweise.push('Für diese*n Mieter*in fehlt die Zeile in „Heizkosten laut A&S“. Die Heizung ist nach Monaten gerechnet.'); }
      } else if (istHeizung) {
        anteil = p.betrag * faktor;
        hinweise.push('„Heizkosten laut A&S“ sind nicht erfasst. Die Heizung ist ohne CO2-Abzug nach Monaten gerechnet.');
      } else if (p.schluesselTyp === 'Punkte' && !mehrereMieter) anteil = p.betrag;
      else anteil = p.betrag * faktor;
      if (p.schluesselTyp === 'Punkte' && mehrereMieter && p.betrag) {
        hinweise.push('Mehrere Mietverhältnisse im Jahr: Die Punkte-Positionen sind nach Monaten aufgeteilt. Bitte prüfen.');
      }
      return {
        bezeichnung: p.bezeichnung, gesamtbetrag: p.gesamtbetrag ?? null,
        typ: p.schluesselTyp || '', schluessel: p.schluesselAnteil || (p.schluesselTyp ? '' : p.schluessel || ''),
        anteil: anteil == null ? null : Math.round(anteil * 100) / 100, neueGruppe,
      };
    });
    const eigene = ea.eigeneKosten.filter(k => k.umlagefaehig).map(k => ({
      bezeichnung: k.bezeichnung || 'Eigene Kosten', anteil: Math.round(eigeneKostenBetrag(k) * faktor * 100) / 100,
    }));
    if (!ea.eigeneKosten.some(k => /grundsteuer/i.test(k.bezeichnung))) hinweise.push('Die Grundsteuer ist noch nicht erfasst.');
    if (umlagePositionen.some(p => p.betrag && (p.gesamtbetrag == null || !p.schluesselTyp))) {
      hinweise.push('Bei einigen Positionen fehlen Gesamtbetrag oder Umlageschlüssel. Bitte die Eigentümerabrechnung neu aus der Datei importieren.');
    }

    const gesamt = [...zeilen, ...eigene].reduce((s, z) => s + (z.anteil || 0), 0);
    const { monate: monatsZeilen } = monatsDaten(mvsWohnung, jahr);
    const vorauszahlungen = monatsZeilen.filter(z => z.mv === mv).reduce((s, z) => s + z.vzIst, 0);
    return {
      mv, jahr, ea, zeilen, eigene, gesamt, vorauszahlungen, ergebnis: vorauszahlungen - gesamt,
      von: monate[0], bis: monate.at(-1), hinweise: [...new Set(hinweise)],
    };
  }

  function druckeNkAbrechnung(mv, jahr) {
    const w = getState().wohnungen.find(x => x.id === mv.wohnungId);
    const a = nkAbrechnung(mv, jahr);
    const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const betrag = n => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
    const tag = (monat, ende) => {
      const [y, m] = monat.split('-').map(Number);
      const d = ende ? new Date(y, m, 0).getDate() : 1;
      return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
    };
    // Vor- und Nachname, damit gleiche Nachnamen unterscheidbar sind;
    // "Nachname, Vorname" wird zu "Vorname Nachname".
    const [nachname, ...vorn] = (mv.mieter || '').split(',').map(x => x.trim());
    const mieter = vorn.length ? `${vorn.join(' ')} ${nachname}` : nachname;
    const zeile = z => `
      ${z.neueGruppe ? '<tr class="abstand"><td colspan="6"></td></tr>' : ''}
      <tr>
        <td>${esc(z.bezeichnung)}</td><td class="dp">:</td>
        <td class="r">${z.gesamtbetrag != null ? betrag(z.gesamtbetrag) : z.anteil == null ? 'entfällt €' : ''}</td>
        <td class="c">${esc(z.typ)}</td><td class="c">${esc(z.schluessel)}</td>
        <td class="r">${z.anteil == null ? '' : betrag(z.anteil)}</td>
      </tr>`;
    const eigeneZeile = z => `
      <tr class="abstand"><td colspan="6"></td></tr>
      <tr><td>${esc(z.bezeichnung)}</td><td class="dp">:</td><td></td><td></td><td></td><td class="r">${betrag(z.anteil)}</td></tr>`;
    const ergebnisText = a.ergebnis >= 0 ? 'Guthaben' : 'Nachzahlung';
    // Konkrete Anteile für den Kopf aus den Schlüsseln der Positionen,
    // z.B. "85,23/495" → "85,23 von 495".
    const anteilVon = typ => {
      const p = a.ea.positionen.find(x => x.schluesselTyp === typ && x.schluesselAnteil);
      if (!p) return null;
      const [teil, ganz] = p.schluesselAnteil.split('/').map(x => x.trim());
      return ganz ? `${teil} von ${ganz}` : teil;
    };
    const kopfAnteile = [['Wohnfläche (qm)', 'qm'], ['Wohnanteil (WA)', 'WA'], ['Punkte', 'Punkte']]
      .map(([label, typ]) => [label, anteilVon(typ)]).filter(([, wert]) => wert)
      .map(([label, wert]) => `<tr><td>${esc(label)}</td><td>:</td><td>${esc(wert)}</td></tr>`).join('');

    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>NK-Abr. ${esc(jahr)} ${esc(mieter)}</title>
<style>
  body { font-family: Tahoma, Verdana, Geneva, sans-serif; font-size: 10.5pt; color: #000; background: #fff; margin: 0; }
  .seite { width: 180mm; margin: 0 auto; padding: 20mm 0; }
  h1 { text-align: center; font-size: 13pt; margin: 0; }
  .jahr { text-align: center; font-size: 18pt; font-weight: bold; margin: 2px 0; }
  .objekt { text-align: center; font-weight: bold; font-size: 10pt; margin-bottom: 28px; }
  .kasten { border: 1px solid #000; padding: 2px 8px; }
  .kasten.titel { text-align: center; margin-bottom: 14px; }
  .daten td { padding: 1px 0; vertical-align: top; }
  .daten td:first-child { width: 62mm; } .daten td:nth-child(2) { width: 10mm; text-align: center; }
  .schluessel { display: flex; justify-content: space-between; margin: 10px 0 30px; padding: 4px 8px; }
  .schluessel table td { padding: 0 3px; } .schluessel table td:first-child { text-align: right; }
  table.kosten { width: 100%; border-collapse: collapse; }
  table.kosten th { font-weight: normal; border: 1px solid #000; padding: 2px; }
  table.kosten td { padding: 1px 2px; white-space: nowrap; }
  .dp { width: 6mm; text-align: center; } .r { text-align: right; } .c { text-align: center; }
  tr.abstand td { height: 12px; }
  tr.summe td { font-weight: bold; padding-top: 14px; }
  .hinweise { background: #fff4d6; border: 1px solid #e0b84c; padding: 8px 12px; margin: 12px auto; width: 180mm; font-family: sans-serif; font-size: 10pt; }
  .knoepfe { width: 180mm; margin: 12px auto 0; font-family: sans-serif; }
  .knoepfe button { font-size: 11pt; padding: 6px 14px; cursor: pointer; }
  @media print { .hinweise, .knoepfe { display: none; } .seite { padding: 0; } @page { size: A4; margin: 20mm 15mm; } }
</style></head><body>
<div class="knoepfe"><button onclick="window.print()">Drucken / als PDF speichern</button></div>
${a.hinweise.length ? `<div class="hinweise"><strong>Bitte prüfen (wird nicht gedruckt):</strong><ul>${a.hinweise.map(h => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
<div class="seite">
  <h1>Abrechnung für das Wirtschaftsjahr</h1>
  <div class="jahr">${esc(jahr)}</div>
  <div class="objekt">${esc(w.abrechnungsTitel || w.name)}</div>
  <div class="kasten titel">Allgemeine Daten</div>
  <table class="daten">
    <tr><td>Mieter</td><td>:</td><td>${esc(mieter)}</td></tr>
    <tr><td>Abgerechneter Zeitraum</td><td>:</td><td><strong>${tag(a.von)} – ${tag(a.bis, true)}</strong></td></tr>
    ${kopfAnteile}
  </table>
  <div class="kasten schluessel">
    <strong>Umlageschlüsselbezeichnung</strong>
    <table>
      <tr><td>Part.</td><td>= Parteien</td></tr>
      <tr><td>Zähl.</td><td>= Zähler</td></tr>
      <tr><td>Punkte</td><td>= Personen x gewohnte Monate</td></tr>
      <tr><td>qm</td><td>= Quadratmeter Wohnung</td></tr>
      <tr><td>WA</td><td>= Wohnanteil</td></tr>
    </table>
  </div>
  <table class="kosten">
    <tr><th colspan="3">Ausgaben</th><th colspan="2">Umlageschlüssel</th><th>Ihr Anteil</th></tr>
    <tr class="abstand"><td colspan="6"></td></tr>
    ${a.zeilen.map(zeile).join('')}
    ${a.eigene.map(eigeneZeile).join('')}
    <tr class="summe"><td>Gesamt</td><td class="dp">:</td><td></td><td></td><td></td><td class="r">${betrag(a.gesamt)}</td></tr>
    <tr class="abstand"><td colspan="6"></td></tr>
    <tr><td colspan="5">Vorauszahlungen wurden angerechnet in Höhe von:</td><td class="r">${betrag(a.vorauszahlungen)}</td></tr>
    <tr class="summe"><td>${ergebnisText}</td><td class="dp">:</td><td></td><td></td><td></td><td class="r">${betrag(Math.abs(a.ergebnis))}</td></tr>
  </table>
</div>
</body></html>`;
    const fenster = window.open('', '_blank');
    if (!fenster) { alert('Das neue Fenster wurde blockiert. Bitte Pop-ups für diese Seite erlauben.'); return; }
    fenster.document.open();
    fenster.document.write(html);
    fenster.document.close();
  }

  // Overlay; beim Schließen wird die Seite dahinter neu gezeichnet.
  function openModal(baue) {
    const inhalt = mk('div');
    const backdrop = mk('div.modal-backdrop', {}, [
      mk('div.modal-card', {}, [
        mk('button.btn.sm.sec.icon-btn.modal-close', { 'aria-label': 'Schließen' }, [mk('span', { text: '✕' })]),
        inhalt,
      ]),
    ]);
    document.body.appendChild(backdrop);
    const close = () => { buchungsAuswahl = null; backdrop.remove(); document.removeEventListener('keydown', esc); rerender(); };
    const esc = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
    backdrop.querySelector('.modal-close').addEventListener('click', close);
    baue(inhalt);
  }

  function wrap(label, input) {
    return mk('div.field', {}, [mk('label', { text: label }), input]);
  }

  window.renderMiete = renderMiete;
})();
