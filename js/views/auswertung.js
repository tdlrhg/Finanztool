(function () {
  'use strict';

  const RECURRING_MIN_MONTHS = 3;
  const RECURRING_MAX_VARIANCE_RATIO = 1.5;

  // Spalten, die in der Monatstabelle zur Auswahl stehen. cls bestimmt die
  // Farbe der Zelle (rot/grün), abhängig vom Wert.
  const MONATS_SPALTEN = [
    { key: 'einnahmen', label: 'Einnahmen', calc: rows => rows.filter(t => t.betrag > 0).reduce((s, t) => s + t.betrag, 0), cls: () => 'pos' },
    { key: 'ausgaben', label: 'Ausgaben', calc: rows => Math.abs(rows.filter(t => t.betrag < 0).reduce((s, t) => s + t.betrag, 0)), cls: () => 'neg' },
    { key: 'saldo', label: 'Saldo', calc: rows => rows.reduce((s, t) => s + t.betrag, 0), cls: v => (v >= 0 ? 'pos' : 'neg') },
  ];

  // Statt einer langen Seite: Themen als Tabs, damit jede Ansicht fokussiert
  // bleibt. Der Zeitraum-Filter gilt gemeinsam für alle Tabs.
  const AUSWERTUNG_TABS = [
    ['ueberblick', 'Überblick'],
    ['ausgaben', 'Ausgaben'],
    ['kategorien', 'Kategorien'],
    ['wiederkehrend', 'Wiederkehrend'],
    ['vermietung', 'Vermietung'],
  ];

  const FILTER_KEY = 'finanztool_auswertung_filter';

  function ladeFilter() {
    try { return JSON.parse(localStorage.getItem(FILTER_KEY)) || {}; } catch (e) { return {}; }
  }

  function speichereFilter(filters, tab) {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify({ von: filters.von.value, bis: filters.bis.value, konto: filters.konto.value, tab }));
    } catch (e) { /* ohne Speicher einfach nicht merken */ }
  }

  function renderAuswertung(root) {
    const state = getState();
    const months = knownMonths(state);
    const currentYear = new Date().getFullYear();
    const defaultFrom = months.find(m => m.startsWith(String(currentYear))) || months[0] || monthKey();
    const defaultTo = months.filter(m => m.startsWith(String(currentYear))).at(-1) || months.at(-1) || monthKey();

    const gemerkt = ladeFilter();
    // Mietkonten gehören nur in den Tab "Vermietung"; alle anderen Tabs
    // zeigen ausschließlich die privaten Konten.
    const privateKonten = state.konten.filter(k => k.typ !== 'miete');
    const filters = {
      von: mk('input', { type: 'month', value: gemerkt.von || defaultFrom }),
      bis: mk('input', { type: 'month', value: gemerkt.bis || defaultTo }),
      konto: mk('select', {}, [
        mk('option', { value: '', text: 'Alle privaten Konten' }),
        ...privateKonten.map(k => mk('option', { value: k.id, text: k.name })),
      ]),
    };
    if (gemerkt.konto && privateKonten.some(k => k.id === gemerkt.konto)) filters.konto.value = gemerkt.konto;
    const kontoFeld = wrap('Konto', filters.konto);
    const tab = { current: AUSWERTUNG_TABS.some(([key]) => key === gemerkt.tab) ? gemerkt.tab : 'ueberblick' };
    const tabBar = mk('div');
    const result = mk('div');
    const update = () => {
      speichereFilter(filters, tab.current);
      renderTabBar(tabBar, tab, update);
      const vermietung = tab.current === 'vermietung';
      kontoFeld.style.display = vermietung ? 'none' : '';
      renderResult(result, filteredTransactions(getState(), filters, vermietung ? 'miete' : 'privat'), filters, tab.current, update);
    };

    Object.values(filters).forEach(input => {
      input.addEventListener('change', update);
      input.addEventListener('input', update);
    });

    root.appendChild(mk('h1', { text: 'Auswertung' }));
    root.appendChild(mk('div.sub', { text: 'Ausgaben, Einnahmen und Kategorien ohne interne Transfers. Mietkonten stehen im Tab „Vermietung“.' }));
    root.appendChild(mk('div.card', {}, [
      mk('h2', { text: 'Zeitraum' }),
      mk('div.row', {}, [
        wrap('Von', filters.von),
        wrap('Bis', filters.bis),
        kontoFeld,
      ]),
    ]));
    root.appendChild(tabBar);
    root.appendChild(result);
    update();
  }

  function renderTabBar(root, tab, update) {
    root.replaceChildren(mk('div.row', { style: 'margin:16px 0' }, AUSWERTUNG_TABS.map(([key, label]) => (
      btn(label, () => { tab.current = key; update(); }, tab.current === key ? 'sm' : 'sm sec')
    ))));
  }

  function renderResult(root, rows, filters, activeTab, update) {
    const einnahmen = rows.filter(t => t.betrag > 0).reduce((sum, t) => sum + t.betrag, 0);
    const ausgaben = rows.filter(t => t.betrag < 0).reduce((sum, t) => sum + t.betrag, 0);
    const saldo = einnahmen + ausgaben;

    const abschnitte = {
      ueberblick: () => [
        mk('div.grid.cols-3', {}, [
          stat('Einnahmen', euro(einnahmen), 'pos'),
          stat('Ausgaben', euro(Math.abs(ausgaben)), ausgaben < 0 ? 'neg' : ''),
          stat('Saldo', euro(saldo), saldo >= 0 ? 'pos' : 'neg'),
        ]),
        mk('div', { style: 'margin-top:16px' }, [monatsTabelle(rows, filters)]),
        mk('div', { style: 'margin-top:16px' }, [einnahmenTabelle(rows, filters, update)]),
      ],
      ausgaben: () => [
        einnahmenTabelle(rows, filters, update, 'ausgaben'),
      ],
      kategorien: () => [
        mk('div.grid.cols-2', {}, [
          barChartCard('Ausgaben nach Kategorie', aggregate(alsKategorienZeilen(rows).filter(t => t.betrag < 0), t => t.kategorie || 'Ohne Kategorie', t => Math.abs(t.betrag)), 'var(--red)'),
          barChartCard('Ausgaben nach Empfänger', aggregate(alsKategorienZeilen(rows).filter(t => t.betrag < 0), t => t.empfaenger || 'Ohne Empfänger', t => Math.abs(t.betrag)).slice(0, 20), 'var(--red)'),
          barChartCard('Einnahmen nach Kategorie', aggregate(alsKategorienZeilen(rows).filter(t => t.betrag > 0), t => t.kategorie || 'Ohne Kategorie', t => t.betrag), 'var(--grn)'),
        ]),
      ],
      wiederkehrend: () => [
        recurringExpensesCard(detectRecurringExpenses(rows)),
      ],
      vermietung: () => vermietungAbschnitt(rows, filters, einnahmen, ausgaben, saldo),
    };

    root.replaceChildren(...(abschnitte[activeTab] ? abschnitte[activeTab]() : []));
  }

  // Große Monatstabelle: Zeilen = Monate im gewählten Zeitraum, Spalten
  // Einnahmen/Ausgaben/Saldo. Nach dem letzten Monat jedes Jahres stehen
  // Summe und Ø/Monat, analog zu einer typischen Excel-Übersicht (Zeile
  // "Summe"/"…/Monat" unter Dezember).
  function monatsTabelle(rows, filters) {
    const monate = monthRangeFromFilters(rows, filters);
    const byMonat = new Map();
    rows.forEach(t => {
      const m = monthKey(t.datum);
      if (!byMonat.has(m)) byMonat.set(m, []);
      byMonat.get(m).push(t);
    });

    if (!monate.length) {
      return mk('div.card', {}, [
        mk('h2', { text: 'Monatstabelle' }),
        mk('div.empty', { text: 'Keine Buchungen im Zeitraum.' }),
      ]);
    }

    const jahresWerte = new Map();
    const jahresSchnitt = new Map();
    const schnittSet = new Set(schnittMonate(monate));
    const zeilen = [];
    monate.forEach((m, i) => {
      const monatsRows = byMonat.get(m) || [];
      const jahr = m.slice(0, 4);
      if (!jahresWerte.has(jahr)) jahresWerte.set(jahr, MONATS_SPALTEN.map(() => []));
      const werte = MONATS_SPALTEN.map((col, ci) => {
        const wert = col.calc(monatsRows);
        jahresWerte.get(jahr)[ci].push(wert);
        return wert;
      });
      if (schnittSet.has(m)) {
        if (!jahresSchnitt.has(jahr)) jahresSchnitt.set(jahr, MONATS_SPALTEN.map(() => []));
        werte.forEach((w, ci) => jahresSchnitt.get(jahr)[ci].push(w));
      }
      zeilen.push(mk('tr', {}, [
        mk('td', { text: monthLabel(m) }),
        ...werte.map((w, ci) => mk(`td.num.${MONATS_SPALTEN[ci].cls(w)}`, { text: euro(w) })),
      ]));

      const letzterMonatDesJahres = i === monate.length - 1 || monate[i + 1].slice(0, 4) !== jahr;
      if (letzterMonatDesJahres) {
        const listen = jahresWerte.get(jahr);
        const summen = listen.map(liste => liste.reduce((s, v) => s + v, 0));
        zeilen.push(mk('tr.jahr-zeile', {}, [
          mk('td', { text: `Summe ${jahr}` }),
          ...summen.map((s, ci) => mk(`td.num.${MONATS_SPALTEN[ci].cls(s)}`, { text: euro(s) })),
        ]));
        zeilen.push(mk('tr.jahr-zeile', {}, [
          mk('td', { text: `Ø/Monat ${jahr}` }),
          ...listen.map((liste, ci) => {
            const basis = (jahresSchnitt.get(jahr) || listen)[ci];
            const schnitt = basis.length ? basis.reduce((x, v) => x + v, 0) / basis.length : 0;
            return mk(`td.num.${MONATS_SPALTEN[ci].cls(schnitt)}`, { text: euro(schnitt) });
          }),
        ]));
      }
    });

    return mk('div.card', {}, [
      mk('h2', { text: 'Monatstabelle' }),
      mk('div.sub', { text: 'Unter dem letzten Monat jedes Jahres stehen Summe und Monatsdurchschnitt.' }),
      mk('div.table-wrap', {}, [
        mk('table', {}, [
          mk('tr', {}, [mk('th', { text: 'Monat' }), ...MONATS_SPALTEN.map(c => mk('th', { text: c.label }))]),
          ...zeilen,
        ]),
      ]),
    ]);
  }

  // Für Durchschnitte zählen nur abgeschlossene Monate: der laufende (noch
  // unvollständige) und zukünftige Monate würden den Schnitt sonst drücken.
  // Liegt der ganze Zeitraum im laufenden/zukünftigen Monat, zählt er voll.
  function schnittMonate(monate) {
    const heute = monthKey(todayISO());
    const abgeschlossen = monate.filter(m => m < heute);
    return abgeschlossen.length ? abgeschlossen : monate;
  }

  function monthRangeFromFilters(rows, filters) {
    const von = filters.von.value;
    const bis = filters.bis.value;
    if (von && bis) return monthRangeBetween(von, bis);
    const monate = [...new Set(rows.map(t => monthKey(t.datum)).filter(Boolean))].sort();
    return monate.length ? monthRangeBetween(monate[0], monate.at(-1)) : [];
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

  // Frei konfigurierbare Einnahmen-Tabelle: Monate als Spalten, Zeilen sind
  // selbst definiert (Kategorie/Unterkategorie/Empfänger als Kriterium) statt
  // fest vorgegeben — z.B. "Beteiligung Person A" oder "Zuschuss Person B", die sich
  // in kein festes Schema pressen lassen. Eine "Sonstige"-Zeile fängt alles
  // auf, was zu keiner definierten Zeile passt, damit die Summe immer stimmt.
  const offeneKategorien = new Set();

  function einnahmenTabelle(rows, filters, update, art = 'einnahmen') {
    const ausg = art === 'ausgaben';
    const titel = ausg ? 'Ausgaben' : 'Einnahmen';
    const monate = monthRangeFromFilters(rows, filters);
    const zeilenDef = getState()[art + 'Zeilen'];
    // Erstattungen sind keine echten Einnahmen: sie tauchen nur bei der
    // Ausgabenkategorie auf, gegen die sie gerechnet werden.
    if (!ausg) rows = rows.filter(t => !erstattungsZiel(t));
    // Zeilen zählen netto (Einnahmen minus dazugehörige Ausgaben mit
    // gleichem Kriterium, z.B. eine Rückbuchung) — deshalb hier alle
    // Buchungen, nicht nur die mit positivem Betrag.
    const byMonat = new Map();
    rows.forEach(t => {
      const m = monthKey(t.datum);
      if (!byMonat.has(m)) byMonat.set(m, []);
      byMonat.get(m).push(t);
    });

    const header = mk('div.flex-between', {}, [
      mk('h2', { text: `${titel} im Detail` }),
      btn('Konfigurieren', () => openModal(einnahmenKonfigFormular(update, art)), 'sm sec'),
    ]);

    if (!monate.length) {
      return mk('div.card', {}, [header, mk('div.empty', { text: 'Keine Buchungen im Zeitraum.' })]);
    }

    const zeilenMitWerten = zeilenDef.map(zeile => {
      const listen = monate.map(m => (byMonat.get(m) || []).filter(t => einnahmenZeileTrifftZu(zeile, t)));
      return { zeile, listen, werte: listen.map(l => l.reduce((s, t) => s + t.betrag, 0)) };
    });
    // Deaktivierte Zeilen bleiben sichtbar (ausgegraut), zählen aber nicht
    // zur Summe — ihre Buchungen gelten für die Tabelle als nicht erfasst,
    // eine positive landet dann ggf. in "Sonstige Einnahmen".
    const aktiveZeilen = zeilenDef.filter(z => !z.deaktiviert);
    // "Sonstige Einnahmen" bleibt auf echte, nicht zugeordnete Einnahmen
    // beschränkt (keine allgemeinen Ausgaben) — sonst würde diese Tabelle
    // zu einer allgemeinen Saldo-Aufschlüsselung statt einer Einnahmenübersicht.
    const erfassteIds = new Set();
    monate.forEach(m => {
      (byMonat.get(m) || []).forEach(t => { if (aktiveZeilen.some(z => einnahmenZeileTrifftZu(z, t))) erfassteIds.add(t.id); });
    });
    // Ausgaben: Alles, was keine eigene Zeile trifft, wird automatisch nach
    // Kategorie (ausklappbar nach Unterkategorie) aufgeteilt. Gesplittete
    // Buchungen zählen mit ihren Einzelpositionen.
    const offeneItems = monate.map(m => (byMonat.get(m) || []).filter(t => !erfassteIds.has(t.id)).flatMap(t => {
      const items = t.detailPositionen || [];
      if (!items.length) {
        const ziel = ausg ? erstattungsZiel(t) : null;
        return ziel ? [{ id: t.id, datum: t.datum, betrag: t.betrag, kategorie: ziel, unterkategorie: 'Erstattungen', empfaenger: t.empfaenger }] : [t];
      }
      return items.map(item => ({ id: t.id, datum: t.datum, betrag: item.betrag, kategorie: item.kategorie || '', unterkategorie: item.unterkategorie || '', empfaenger: item.empfaenger || t.empfaenger }));
    }));
    const kategorieZeilen = [];
    if (ausg) {
      const map = new Map();
      offeneItems.forEach((items, i) => items.forEach(t => {
        if (!t.kategorie || (t.betrag >= 0 && t.unterkategorie !== 'Erstattungen')) return;
        if (!map.has(t.kategorie)) map.set(t.kategorie, { name: t.kategorie, werte: monate.map(() => 0), listen: monate.map(() => []), unter: new Map() });
        const eintrag = map.get(t.kategorie);
        eintrag.werte[i] += t.betrag;
        eintrag.listen[i].push(t);
        const uName = t.unterkategorie || '(ohne Unterkategorie)';
        if (!eintrag.unter.has(uName)) eintrag.unter.set(uName, { werte: monate.map(() => 0), listen: monate.map(() => []) });
        eintrag.unter.get(uName).werte[i] += t.betrag;
        eintrag.unter.get(uName).listen[i].push(t);
      }));
      // Eigene Zeilen mit festgelegter Kategorie gehören in diese Kategorie.
      zeilenMitWerten.filter(z => z.zeile.kategorie).forEach(z => {
        if (!map.has(z.zeile.kategorie)) map.set(z.zeile.kategorie, { name: z.zeile.kategorie, werte: monate.map(() => 0), listen: monate.map(() => []), unter: new Map() });
      });
      map.forEach(e => {
        e.eigene = zeilenMitWerten.filter(z => z.zeile.kategorie === e.name);
        const aktiv = e.eigene.filter(z => !z.zeile.deaktiviert);
        // Kopfzeile = Rest der Kategorie + aktive eigene Zeilen darin.
        e.gesamtWerte = e.werte.map((w, i) => w + aktiv.reduce((x, z) => x + z.werte[i], 0));
        e.gesamtListen = e.listen.map((l, i) => [...l, ...aktiv.flatMap(z => z.listen[i])]);
        kategorieZeilen.push(e);
      });
      kategorieZeilen.sort((a, b) => a.gesamtWerte.reduce((x, y) => x + y, 0) - b.gesamtWerte.reduce((x, y) => x + y, 0));
    }
    const eigeneInKategorie = z => ausg && !!z.zeile.kategorie;
    const sonstigeListe = ausg
      ? offeneItems.map(items => items.filter(t => !t.kategorie && t.betrag < 0))
      : monate.map(m => (byMonat.get(m) || []).filter(t => t.betrag > 0 && !erfassteIds.has(t.id)));
    const sonstigeWerte = sonstigeListe.map(liste => liste.reduce((s, t) => s + t.betrag, 0));
    // Klick auf jede Zahl zeigt die Buchungen dahinter.
    const zelle = (w, buchungen, zeilenName, zeitText, cls = '') => mk(`td.num${cls}`, {
      text: w ? euro(w) : '–',
      title: w ? 'Klicken: zugehörige Buchungen anzeigen' : null,
      style: w ? 'cursor:pointer;' : null,
      onclick: w ? () => openModal(buchungenListe(`${zeilenName}: ${zeitText}`, buchungen)) : null,
    });
    const zeilenLabelSonstige = ausg ? 'Ohne Kategorie' : `Sonstige ${titel}`;
    const sonstigeDeaktiviert = !!getState()[art + 'SonstigeDeaktiviert'];
    const schnittSet = new Set(schnittMonate(monate));
    const schnitt = werte => summe(werte.filter((w, i) => schnittSet.has(monate[i]))) / schnittSet.size;
    const summe = arr => arr.reduce((s, w) => s + w, 0);
    const summeListen = monate.map((m, i) => [
      ...zeilenMitWerten.filter(z => !z.zeile.deaktiviert).flatMap(z => z.listen[i]),
      ...(sonstigeDeaktiviert ? [] : sonstigeListe[i]),
      ...kategorieZeilen.flatMap(k => k.listen[i]),
    ]);
    const summeWerte = monate.map((m, i) => summe(zeilenMitWerten.filter(z => !z.zeile.deaktiviert).map(z => z.werte[i])) + (sonstigeDeaktiviert ? 0 : sonstigeWerte[i]) + summe(kategorieZeilen.map(k => k.werte[i])));
    // Die Zeile bleibt sichtbar, wenn Werte drinstecken ODER sie manuell
    // deaktiviert wurde (sonst könnte man sie nicht wieder einschalten).
    const sonstigeSichtbar = sonstigeDeaktiviert || sonstigeWerte.some(w => Math.abs(w) > 0.005);

    const schnittZahl = (werte, deaktiviert) => mk(`td.num${deaktiviert ? '.zeile-deaktiviert' : ''}`, { text: schnitt(werte) ? euro(schnitt(werte)) : '–' });
    const toggleLabel = (label, deaktiviert, onToggle) => mk('span.zeile-toggle', { title: 'Klicken zum De-/Aktivieren', onclick: onToggle }, [
      mk(`span.zeile-toggle-dot${deaktiviert ? '.off' : ''}`, {}),
      mk(`span${deaktiviert ? '.zeile-deaktiviert' : ''}`, { text: label }),
    ]);

    const eigeneZeileTr = ({ zeile, werte, listen }, eingerueckt = false) => mk('tr', {}, [
      mk('td', eingerueckt ? { style: 'padding-left:32px;' } : {}, [toggleLabel(zeile.label, zeile.deaktiviert, () => { toggleEinnahmenZeile(zeile.id, art); update(); })]),
      ...werte.map((w, i) => zelle(w, listen[i], zeile.label, monthLabel(monate[i]), zeile.deaktiviert ? '.zeile-deaktiviert' : '')),
      zelle(summe(werte), listen.flat(), zeile.label, 'gesamter Zeitraum', `.zeile-gesamt${zeile.deaktiviert ? '.zeile-deaktiviert' : ''}`),
      schnittZahl(werte, zeile.deaktiviert),
    ]);

    return mk('div.card', {}, [
      header,
      mk('div.sub', { text: `Zeilen zählen netto (inkl. gegenläufiger Buchungen mit gleichem Kriterium). Klick auf den Namen deaktiviert eine Zeile (ausgegraut, zählt nicht mehr zur Summe). "${ausg ? 'Ohne Kategorie' : `Sonstige ${titel}`}" fängt nur unzugeordnete ${titel} auf.${ausg ? ' Alles andere wird automatisch nach Kategorie aufgeteilt — Klick auf eine Kategorie klappt die Unterkategorien auf.' : ''} Gesamt ist die Summe über den gewählten Zeitraum.` }),
      mk('div.table-wrap', { style: 'margin-top:8px' }, [
        mk('table', {}, [
          mk('tr', {}, [mk('th', { text: '' }), ...monate.map(m => mk('th', { text: monthLabel(m) })), mk('th.zeile-gesamt', { text: 'Gesamt' }), mk('th', { text: 'Ø/Monat' })]),
          ...zeilenMitWerten.filter(z => !eigeneInKategorie(z)).map(z => eigeneZeileTr(z)),
          ...kategorieZeilen.flatMap(k => {
            const offen = offeneKategorien.has(k.name);
            const zeileK = (label, name, werte, listen, extra = '') => mk('tr', {}, [
              label,
              ...werte.map((w, i) => zelle(w, listen[i], name, monthLabel(monate[i]), extra)),
              zelle(summe(werte), listen.flat(), name, 'gesamter Zeitraum', `.zeile-gesamt${extra}`),
              mk(`td.num${extra}`, { text: schnitt(werte) ? euro(schnitt(werte)) : '–' }),
            ]);
            const kopf = zeileK(mk('td', {}, [mk('span.zeile-toggle', {
              title: 'Klicken: Unterkategorien ein-/ausklappen',
              onclick: () => { if (offen) offeneKategorien.delete(k.name); else offeneKategorien.add(k.name); update(); },
            }, [mk('span', { text: offen ? '▾' : '▸', style: 'width:10px; font-size:11px; color:var(--tx2);' }), mk('span', { text: k.name })])]), k.name, k.gesamtWerte, k.gesamtListen);
            const unter = offen ? [...k.unter.entries()]
              .sort((a, b) => summe(a[1].werte) - summe(b[1].werte))
              .map(([uName, u]) => zeileK(mk('td', { text: uName, style: 'padding-left:32px;' }), `${k.name} › ${uName}`, u.werte, u.listen, '.zeile-deaktiviert')) : [];
            const eigene = offen ? k.eigene.map(z => eigeneZeileTr(z, true)) : [];
            return [kopf, ...eigene, ...unter];
          }),
          sonstigeSichtbar ? mk('tr', {}, [
            mk('td', {}, [toggleLabel(ausg ? 'Ohne Kategorie' : `Sonstige ${titel}`, sonstigeDeaktiviert, () => { toggleEinnahmenSonstige(art); update(); })]),
            ...sonstigeWerte.map((w, i) => zelle(w, sonstigeListe[i], zeilenLabelSonstige, monthLabel(monate[i]), sonstigeDeaktiviert ? '.zeile-deaktiviert' : '')),
            zelle(summe(sonstigeWerte), sonstigeListe.flat(), zeilenLabelSonstige, 'gesamter Zeitraum', `.zeile-gesamt${sonstigeDeaktiviert ? '.zeile-deaktiviert' : ''}`),
            schnittZahl(sonstigeWerte, sonstigeDeaktiviert),
          ]) : null,
          mk('tr.jahr-zeile', {}, [mk('td', { text: 'Summe' }), ...summeWerte.map((w, i) => zelle(w, summeListen[i], 'Summe', monthLabel(monate[i]))), zelle(summe(summeWerte), summeListen.flat(), 'Summe', 'gesamter Zeitraum', '.zeile-gesamt'), mk('td.num', { text: euro(schnitt(summeWerte)) })]),
        ]),
      ]),
    ]);
  }

  function buchungenListe(titelText, buchungen) {
    const sortiert = [...buchungen].sort((a, b) => a.datum.localeCompare(b.datum));
    return mk('div', {}, [
      mk('h2', { text: titelText }),
      mk('div.sub', { text: `${sortiert.length} Buchung(en), zusammen ${euro(sortiert.reduce((sum, t) => sum + t.betrag, 0))}.` }),
      mk('div.table-wrap', {}, [
        mk('table', {}, [
          mk('tr', {}, ['Datum', 'Empfänger', 'Kategorie', 'Unterkategorie', 'Betrag'].map(h => mk('th', { text: h }))),
          ...sortiert.map(t => mk('tr', {}, [
            mk('td', { text: t.datum }),
            mk('td', { text: t.empfaenger || '–' }),
            mk('td', { text: t.kategorie || '–' }),
            mk('td', { text: t.unterkategorie || '–' }),
            mk('td.num', { text: euro(t.betrag) }),
          ])),
        ]),
      ]),
    ]);
  }

  function einnahmenKonfigFormular(refresh, art = 'einnahmen') {
    const label = mk('input', { placeholder: 'Name der Zeile' });
    const kategorie = mk('select', {}, kategorieOptionenLokal(''));
    const unterkategorie = mk('select', {}, unterkategorieOptionenLokal('', ''));
    const empfaenger = mk('input', { placeholder: 'z.B. Versicherung, Beihilfe' });
    const tag = mk('select', {}, tagOptionenLokal(''));
    const status = mk('div');
    const listHost = mk('div');

    kategorie.addEventListener('change', () => {
      unterkategorie.replaceChildren(...unterkategorieOptionenLokal(kategorie.value, ''));
    });

    const renderListe = () => {
      const zeilen = getState()[art + 'Zeilen'];
      listHost.replaceChildren(
        zeilen.length
          ? mk('div.table-wrap', {}, [
              mk('table', {}, [
                mk('tr', {}, [mk('th', { text: '' }), mk('th', { text: 'Name' }), mk('th', { text: 'Kategorie' }), mk('th', { text: 'Unterkategorie' }), mk('th', { text: 'Empfänger' }), mk('th', { text: 'Tag' }), mk('th', { text: '' })]),
                ...zeilen.map(z => mk('tr', {}, [
                  mk('td', {}, [
                    btn('↑', () => { moveEinnahmenZeile(z.id, -1, art); renderListe(); refresh(); }, 'sm sec'),
                    btn('↓', () => { moveEinnahmenZeile(z.id, 1, art); renderListe(); refresh(); }, 'sm sec'),
                  ]),
                  mk('td', { text: z.label }),
                  mk('td', { text: z.kategorie || '–' }),
                  mk('td', { text: z.unterkategorie || '–' }),
                  mk('td', { text: z.empfaenger || '–' }),
                  mk('td', { text: z.tag || '–' }),
                  mk('td', {}, [btn('Löschen', () => { deleteEinnahmenZeile(z.id, art); renderListe(); refresh(); }, 'sm danger')]),
                ])),
              ]),
            ])
          : mk('div.empty', { text: 'Noch keine Zeilen definiert.' })
      );
    };
    renderListe();

    return mk('div', {}, [
      mk('h2', { text: art === 'ausgaben' ? 'Ausgaben-Zeilen konfigurieren' : 'Einnahmen-Zeilen konfigurieren' }),
      mk('div.sub', { text: 'Jede Zeile sammelt Buchungen nach Kategorie, Unterkategorie, Empfänger und/oder Tag — mindestens eins davon angeben. Bei Empfänger mehrere Namen mit Komma trennen, um sie in einer Zeile zusammenzufassen.' }),
      mk('div.row', {}, [
        wrap('Name', label),
        wrap('Kategorie', kategorie),
        wrap('Unterkategorie', unterkategorie),
        wrap('Empfänger', empfaenger),
        wrap('Tag', tag),
        btn('Hinzufügen', () => {
          const zeile = addEinnahmenZeile({ label: label.value, kategorie: kategorie.value, unterkategorie: unterkategorie.value, empfaenger: empfaenger.value, tag: tag.value }, art);
          if (!zeile) {
            status.replaceChildren(mk('span.badge.warn', { text: 'Name und mindestens ein Kriterium angeben.' }));
            return;
          }
          if (art === 'ausgaben' && zeile.kategorie) offeneKategorien.add(zeile.kategorie);
          label.value = '';
          empfaenger.value = '';
          status.replaceChildren();
          renderListe();
          refresh();
        }, 'sm'),
      ]),
      status,
      listHost,
      art === 'ausgaben' ? erstattungenAbschnitt(refresh) : null,
    ]);
  }

  // Einnahmen, die eine Ausgabenkategorie mindern (z.B. Beihilfe → Gesundheit).
  function erstattungenAbschnitt(refresh) {
    const ziel = mk('select', {}, kategorieOptionenLokal(''));
    const kategorie = mk('select', {}, kategorieOptionenLokal(''));
    const unterkategorie = mk('select', {}, unterkategorieOptionenLokal('', ''));
    const empfaenger = mk('input', { placeholder: 'z.B. Versicherung, Beihilfe' });
    const tag = mk('select', {}, tagOptionenLokal(''));
    const status = mk('div');
    const listHost = mk('div');
    kategorie.addEventListener('change', () => unterkategorie.replaceChildren(...unterkategorieOptionenLokal(kategorie.value, '')));

    const renderListe = () => {
      const liste = getState().erstattungen;
      listHost.replaceChildren(liste.length
        ? mk('div.table-wrap', {}, [mk('table', {}, [
            mk('tr', {}, ['Mindert Ausgabe', 'Kategorie', 'Unterkategorie', 'Empfänger', 'Tag', ''].map(h => mk('th', { text: h }))),
            ...liste.map(e => mk('tr', {}, [
              mk('td', { text: e.ziel }),
              mk('td', { text: e.kategorie || '–' }),
              mk('td', { text: e.unterkategorie || '–' }),
              mk('td', { text: e.empfaenger || '–' }),
              mk('td', { text: e.tag || '–' }),
              mk('td', {}, [btn('Löschen', () => { deleteErstattung(e.id); renderListe(); refresh(); }, 'sm danger')]),
            ])),
          ])])
        : mk('div.empty', { text: 'Noch keine Erstattungen festgelegt.' }));
    };
    renderListe();

    return mk('div', { style: 'margin-top:24px' }, [
      mk('h2', { text: 'Erstattungen gegenrechnen' }),
      mk('div.sub', { text: 'Einnahmen, die hier passen, sind keine echten Einnahmen: Sie verschwinden aus der Einnahmentabelle und mindern stattdessen die gewählte Ausgabenkategorie (Unterzeile „Erstattungen"). Mindestens ein Kriterium angeben.' }),
      mk('div.row', {}, [
        wrap('Mindert Ausgabenkategorie', ziel),
        wrap('Kategorie der Erstattung', kategorie),
        wrap('Unterkategorie', unterkategorie),
        wrap('Empfänger', empfaenger),
        wrap('Tag', tag),
        btn('Hinzufügen', () => {
          const e = addErstattung({ ziel: ziel.value, kategorie: kategorie.value, unterkategorie: unterkategorie.value, empfaenger: empfaenger.value, tag: tag.value });
          if (!e) {
            status.replaceChildren(mk('span.badge.warn', { text: 'Ausgabenkategorie und mindestens ein Kriterium angeben.' }));
            return;
          }
          empfaenger.value = '';
          status.replaceChildren();
          renderListe();
          refresh();
        }, 'sm'),
      ]),
      status,
      listHost,
    ]);
  }

  function tagOptionenLokal(currentValue) {
    const tags = [...new Set(getState().transaktionen.flatMap(t => t.tags || []))].sort((a, b) => a.localeCompare(b, 'de'));
    return [
      mk('option', { value: '', text: '(egal)', selected: !currentValue }),
      ...tags.map(t => mk('option', { value: t, text: t, selected: currentValue === t })),
    ];
  }

  function kategorieOptionenLokal(currentValue) {
    const kategorien = privateKategorien();
    return [
      mk('option', { value: '', text: '(egal)', selected: !currentValue }),
      ...kategorien.map(k => mk('option', { value: k, text: k, selected: currentValue === k })),
    ];
  }

  function unterkategorieOptionenLokal(kategorie, currentValue) {
    const unterkategorien = kategorie ? unterkategorienFuer(kategorie) : [];
    return [
      mk('option', { value: '', text: '(egal)', selected: !currentValue }),
      ...unterkategorien.map(u => mk('option', { value: u, text: u, selected: currentValue === u })),
    ];
  }

  function openModal(content) {
    const backdrop = mk('div.modal-backdrop', {}, [
      mk('div.modal-card', {}, [
        mk('button.btn.sm.sec.icon-btn.modal-close', { 'aria-label': 'Schließen' }, [mk('span', { text: '✕' })]),
        content,
      ]),
    ]);
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
    backdrop.querySelector('.modal-close').addEventListener('click', close);
    return close;
  }

  // Erkennt wiederkehrende Ausgaben automatisch: gleicher Empfänger, in mind.
  // RECURRING_MIN_MONTHS verschiedenen Monaten, mit ähnlich hohem Betrag
  // (max/min Verhältnis der Monatssummen unter RECURRING_MAX_VARIANCE_RATIO).
  // Das filtert schwankende Alltagsausgaben (z.B. Lebensmittel) automatisch raus.
  function detectRecurringExpenses(rows) {
    const byEmpfaenger = new Map();
    rows.filter(t => t.betrag < 0).forEach(t => {
      const label = t.empfaenger || 'Ohne Empfänger';
      const key = label.trim().toLowerCase();
      if (!byEmpfaenger.has(key)) byEmpfaenger.set(key, { label, monthlySums: new Map() });
      const entry = byEmpfaenger.get(key);
      const month = monthKey(t.datum);
      entry.monthlySums.set(month, (entry.monthlySums.get(month) || 0) + Math.abs(t.betrag));
    });

    return [...byEmpfaenger.values()]
      .map(entry => {
        const values = [...entry.monthlySums.values()];
        const months = values.length;
        const total = values.reduce((sum, v) => sum + v, 0);
        return { label: entry.label, months, total, monthlyAverage: total / months, max: Math.max(...values), min: Math.min(...values) };
      })
      .filter(r => r.months >= RECURRING_MIN_MONTHS && r.min > 0 && r.max / r.min <= RECURRING_MAX_VARIANCE_RATIO)
      .sort((a, b) => b.monthlyAverage - a.monthlyAverage);
  }

  function recurringExpensesCard(recurring) {
    return mk('div.card', {}, [
      mk('h2', { text: 'Wiederkehrende Ausgaben (automatisch erkannt)' }),
      mk('div.sub', { text: `Empfänger mit mind. ${RECURRING_MIN_MONTHS} Monaten ähnlich hoher Zahlungen im gewählten Zeitraum.` }),
      recurring.length
        ? mk('table', {}, [
            mk('tr', {}, [mk('th', { text: 'Empfänger' }), mk('th', { text: 'Ø/Monat' }), mk('th', { text: 'Monate' }), mk('th', { text: 'Gesamt' })]),
            ...recurring.map(r => mk('tr', {}, [
              mk('td', { text: r.label }),
              mk('td.num', { text: euro(r.monthlyAverage) }),
              mk('td.num', { text: String(r.months) }),
              mk('td.num', { text: euro(r.total) }),
            ])),
          ])
        : mk('div.empty', { text: 'Noch keine wiederkehrenden Zahlungen erkannt.' }),
    ]);
  }

  // Eigene Sicht auf die Mietkonten: Einnahmen, Ausgaben, Saldo und
  // Monatstabelle wie im Überblick, dazu Einnahmen nach Empfänger (Mieter*in)
  // und Ausgaben nach Kategorie.
  function vermietungAbschnitt(rows, filters, einnahmen, ausgaben, saldo) {
    if (!getState().konten.some(k => k.typ === 'miete')) {
      return [mk('div.card', {}, [
        mk('div.empty', { text: 'Noch kein Mietkonto angelegt. Lege unter Einstellungen → Konten ein Konto mit dem Typ „Mietkonto“ an.' }),
      ])];
    }
    const zeilen = alsKategorienZeilen(rows);
    return [
      mk('div.grid.cols-3', {}, [
        stat('Einnahmen', euro(einnahmen), 'pos'),
        stat('Ausgaben', euro(Math.abs(ausgaben)), ausgaben < 0 ? 'neg' : ''),
        stat('Saldo', euro(saldo), saldo >= 0 ? 'pos' : 'neg'),
      ]),
      mk('div', { style: 'margin-top:16px' }, [monatsTabelle(rows, filters)]),
      mk('div.grid.cols-2', { style: 'margin-top:16px' }, [
        barChartCard('Einnahmen nach Empfänger', aggregate(zeilen.filter(t => t.betrag > 0), t => t.empfaenger || 'Ohne Empfänger', t => t.betrag), 'var(--grn)'),
        barChartCard('Ausgaben nach Kategorie', aggregate(zeilen.filter(t => t.betrag < 0), t => t.kategorie || 'Ohne Kategorie', t => Math.abs(t.betrag)), 'var(--red)'),
      ]),
    ];
  }

  // bereich 'privat': alle Konten außer Mietkonten (Kontofilter gilt);
  // bereich 'miete': nur Mietkonten (Kontofilter wird ignoriert).
  function filteredTransactions(state, filters, bereich = 'privat') {
    const from = filters.von.value || '0000-00';
    const to = filters.bis.value || '9999-99';
    const mietKontoIds = new Set(state.konten.filter(k => k.typ === 'miete').map(k => k.id));
    return state.transaktionen
      .filter(t => !istTransfer(t))
      .filter(t => !t.ausAuswertung)
      .filter(t => (bereich === 'miete') === mietKontoIds.has(t.kontoId))
      .filter(t => bereich === 'miete' || !filters.konto.value || t.kontoId === filters.konto.value)
      .filter(t => {
        const month = monthKey(t.datum);
        return month >= from && month <= to;
      });
  }

  // Aufgesplittete Buchungen tragen selbst keine Kategorie mehr (die steckt
  // in den Positionen) — für Kategorie-/Empfänger-Auswertungen zählen daher
  // die Positionen statt der (leeren) Elternbuchung, sonst verschwindet der
  // Betrag einfach aus der Auswertung.
  function alsKategorienZeilen(rows) {
    return rows.flatMap(t => {
      const items = t.detailPositionen || [];
      if (!items.length) return [t];
      return items.map(item => ({ betrag: item.betrag, kategorie: item.kategorie, empfaenger: item.empfaenger || t.empfaenger }));
    });
  }

  function aggregate(rows, labelFn, amountFn) {
    const grouped = new Map();
    rows.forEach(row => {
      const label = labelFn(row);
      grouped.set(label, (grouped.get(label) || 0) + amountFn(row));
    });
    return [...grouped.entries()]
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount);
  }

  // Horizontales Balkendiagramm statt Tabelle: bei 10-15 Kategorien liest
  // sich eine nach Betrag sortierte Balkenreihe deutlich klarer als eine
  // Tabelle mit Mini-Balken oder ein Kreisdiagramm mit vielen Segmenten.
  function barChartCard(title, rows, color) {
    const max = rows[0]?.amount || 0;
    const total = rows.reduce((sum, row) => sum + row.amount, 0);
    return mk('div.card', {}, [
      mk('h2', { text: title }),
      rows.length
        ? mk('div.barchart', {}, rows.map(row => mk('div.barchart-row', {}, [
            mk('div.barchart-label', { text: row.label, title: row.label }),
            mk('div.barchart-track', {}, [
              mk('div.barchart-fill', { style: `width:${max > 0 ? Math.max((row.amount / max) * 100, 2) : 0}%; background:${color}` }),
            ]),
            mk('div.barchart-value', { text: `${euro(row.amount)} · ${total > 0 ? Math.round((row.amount / total) * 100) : 0}%` }),
          ])))
        : mk('div.empty', { text: 'Keine Buchungen im Zeitraum.' }),
    ]);
  }

  function stat(label, value, cls = '') {
    return mk('div.stat', {}, [
      mk('div.stat-label', { text: label }),
      mk(`div.stat-value${cls ? '.' + cls : ''}`, { text: value }),
    ]);
  }

  function knownMonths(state) {
    return [...new Set(state.transaktionen.map(t => monthKey(t.datum)).filter(Boolean))].sort();
  }

  function wrap(label, input) {
    return mk('div.field', {}, [mk('label', { text: label }), input]);
  }

  window.renderAuswertung = renderAuswertung;
})();
