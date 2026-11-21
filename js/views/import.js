(function () {
  'use strict';

  const AUTO_FIELDS = {
    datum: ['datum', 'buchungstag', 'valuta', 'date'],
    betrag: ['betrag', 'umsatz', 'amount', 'wert'],
    soll: ['soll', 'lastschrift', 'belastung', 'ausgang'],
    haben: ['haben', 'gutschrift', 'eingang'],
    kategorie: ['kategorie', 'category'],
    // "tag" bewusst nicht als Suchbegriff: würde "Buchungstag"/"Valutatag"
    // (endet auf "tag") fälschlich als Tags-Spalte erkennen. "Tags" (Plural)
    // ist eindeutig, "Tag" (Singular) bedeutet auf Deutsch meist "Datum".
    tags: ['schlagworte', 'tags'],
    empfaenger: ['empfaenger', 'empfänger', 'auftraggeber', 'zahlungspflichtiger', 'beguenstigter', 'begünstigter', 'name'],
    beschreibung: ['beschreibung', 'verwendungszweck', 'buchungstext', 'text'],
  };

  // PayPal-Aktivitätenexport: jede Zahlung besteht aus zwei Zeilen (Kauf +
  // Finanzierungszeile), verknüpft über Transaktionscode/Zugehöriger
  // Transaktionscode. Die Finanzierungszeile verrät, ob PayPal sich das Geld
  // von der Kreditkarte oder direkt vom Girokonto geholt hat.
  const PAYPAL_REQUIRED_HEADERS = ['Datum', 'Name', 'Typ', 'Brutto', 'Netto', 'Transaktionscode', 'Zugehöriger Transaktionscode', 'Auswirkung auf Guthaben'];

  function headerIndex(headers, name) {
    return headers.findIndex(h => h.trim().toLowerCase() === name.toLowerCase());
  }

  function isPaypalShape(headers) {
    return PAYPAL_REQUIRED_HEADERS.every(name => headerIndex(headers, name) >= 0);
  }

  function paypalColumns(headers) {
    return {
      typ: headerIndex(headers, 'Typ'),
      transaktionscode: headerIndex(headers, 'Transaktionscode'),
      zugehoerig: headerIndex(headers, 'Zugehöriger Transaktionscode'),
    };
  }

  function applyPaypalMapping(headers, mapping) {
    mapping.datum = headerIndex(headers, 'Datum');
    mapping.betrag = headerIndex(headers, 'Brutto');
    mapping.empfaenger = headerIndex(headers, 'Name');
    mapping.beschreibung = headerIndex(headers, 'Betreff');
    mapping.beschreibung2 = headerIndex(headers, 'Artikelbezeichnung');
    mapping.beschreibung3 = -1;
    mapping.kategorie = -1;
    mapping.tags = -1;
  }

  function kontoSelectByTyp(typ) {
    const state = getState();
    const kandidaten = state.konten.filter(k => k.typ === typ);
    const defaultId = kandidaten.length === 1 ? kandidaten[0].id : '';
    return mk('select', {}, [
      mk('option', { value: '', text: '(kein Transfer, normale Buchung)' }),
      ...state.konten.map(k => mk('option', { value: k.id, text: k.name, selected: k.id === defaultId })),
    ]);
  }

  function renderImport(root) {
    const state = getState();
    const model = {
      rows: [],
      headers: [],
      parsed: [],
      fileName: '',
    };

    const file = mk('input', { type: 'file', accept: '.csv,text/csv' });
    const konto = mk('select', {}, [
      mk('option', { value: '', text: '(Konto auswählen)' }),
      ...state.konten.map(k => mk('option', { value: k.id, text: k.name })),
    ]);
    const fixedCategory = mk('select', {}, [
      mk('option', { value: '', text: '(Ohne Kategorie)', selected: true }),
      ...state.kategorien.map(k => mk('option', { value: k, text: k })),
    ]);
    const amountMode = mk('select', {}, [
      mk('option', { value: 'single', text: 'Eine Betragsspalte' }),
      mk('option', { value: 'split', text: 'Getrennte Soll/Haben-Spalten' }),
    ]);

    const mappingCard = mk('div.card');
    const previewCard = mk('div.card', {}, [mk('div.empty', { text: 'CSV-Datei auswählen, dann erscheint hier die Vorschau.' })]);

    root.appendChild(mk('h1', { text: 'Import' }));
    root.appendChild(mk('div.sub', { text: 'Kontobuchungen und Abrechnungen an einer Stelle importieren.' }));

    file.addEventListener('change', async () => {
      const selected = file.files && file.files[0];
      if (!selected) return;
      model.fileName = selected.name;
      model.rows = parseCSV(await readFileText(selected));
      model.headers = model.rows[0] || [];
      model.parsed = [];
      renderMapping(mappingCard, model, { konto, fixedCategory, amountMode, previewCard });
      renderPreview(previewCard, model.parsed, konto.value);
    });

    [konto, fixedCategory, amountMode].forEach(input => {
      input.addEventListener('change', () => renderMapping(mappingCard, model, { konto, fixedCategory, amountMode, previewCard }));
      input.addEventListener('input', () => {
        model.parsed = parseTransactions(model, collectMapping(mappingCard), konto.value, fixedCategory.value);
        renderPreview(previewCard, model.parsed, konto.value);
      });
    });

    root.appendChild(mk('div.card', {}, [
      mk('h2', { text: 'Kontobuchungen aus CSV' }),
      state.konten.length
        ? null
        : mk('div.badge.warn', { text: 'Lege zuerst unter Konten ein Konto an.' }),
      mk('div.row', { style: 'margin-top:10px' }, [
        wrap('CSV-Datei', file),
        wrap('Zielkonto', konto),
        wrap('Betragsformat', amountMode),
        wrap('Kategorie, falls keine CSV-Spalte passt', fixedCategory),
      ]),
    ]));
    root.appendChild(mappingCard);
    root.appendChild(previewCard);
  }

  function renderMapping(root, model, controls) {
    if (!model.rows.length) {
      root.replaceChildren(mk('div.empty', { text: 'Noch keine CSV-Datei geladen.' }));
      return;
    }

    const mapping = {
      datum: autoIndex(model.headers, AUTO_FIELDS.datum),
      betrag: autoIndex(model.headers, AUTO_FIELDS.betrag),
      soll: autoIndex(model.headers, AUTO_FIELDS.soll),
      haben: autoIndex(model.headers, AUTO_FIELDS.haben),
      kategorie: autoIndex(model.headers, AUTO_FIELDS.kategorie),
      tags: autoIndex(model.headers, AUTO_FIELDS.tags),
      empfaenger: autoIndex(model.headers, AUTO_FIELDS.empfaenger),
      beschreibung: autoIndex(model.headers, AUTO_FIELDS.beschreibung),
      beschreibung2: -1,
      beschreibung3: -1,
    };
    applyKnownProfile(model.headers, mapping);
    const paypal = isPaypalShape(model.headers);
    if (paypal) applyPaypalMapping(model.headers, mapping);
    // Kreditkarten-CSVs haben keine Empfänger-Spalte, der Händler steht in der
    // Beschreibung. Ohne Empfänger greifen Regeln und "Empfänger zusammenführen"
    // nicht — deshalb standardmäßig die Beschreibung als Empfänger vorschlagen.
    if (mapping.empfaenger < 0 && mapping.beschreibung >= 0) mapping.empfaenger = mapping.beschreibung;
    const kreditkartenKonto = paypal ? kontoSelectByTyp('kreditkarte') : null;
    const girokonto = paypal ? kontoSelectByTyp('giro') : null;

    const fields = [
      wrapCompact('Datum', selectColumn('datum', model.headers, mapping.datum)),
      controls.amountMode.value === 'single'
        ? wrapCompact('Betrag', selectColumn('betrag', model.headers, mapping.betrag))
        : wrapCompact('Soll / Belastung', selectColumn('soll', model.headers, mapping.soll)),
      controls.amountMode.value === 'split'
        ? wrapCompact('Haben / Gutschrift', selectColumn('haben', model.headers, mapping.haben))
        : null,
      wrapCompact('Kategorie', selectColumn('kategorie', model.headers, mapping.kategorie, true)),
      wrapCompact('Tags', selectColumn('tags', model.headers, mapping.tags, true)),
      wrapCompact('Empfänger', selectColumn('empfaenger', model.headers, mapping.empfaenger, true)),
      wrapCompact('Beschreibung 1', selectColumn('beschreibung', model.headers, mapping.beschreibung, true)),
      wrapCompact('Beschreibung 2', selectColumn('beschreibung2', model.headers, mapping.beschreibung2, true)),
      wrapCompact('Beschreibung 3', selectColumn('beschreibung3', model.headers, mapping.beschreibung3, true)),
    ];

    const extra = () => ({
      kreditkartenKontoId: kreditkartenKonto ? kreditkartenKonto.value : '',
      girokontoId: girokonto ? girokonto.value : '',
    });
    const recompute = () => {
      model.parsed = parseTransactions(model, collectMapping(root), controls.konto.value, controls.fixedCategory.value, extra());
      renderPreview(controls.previewCard, model.parsed, controls.konto.value);
    };

    root.replaceChildren(
      mk('h2', { text: `Spalten zuordnen: ${model.fileName}` }),
      mk('div.row.tight', {}, fields),
      paypal ? mk('div.card', { style: 'margin-top:8px; background:var(--surf2)' }, [
        mk('div.sub', { text: 'PayPal-Export erkannt: Finanzierungszeilen (Kreditkarte/Bankkonto) werden automatisch als Transfer statt als Kategorie-Buchung importiert.' }),
        mk('div.row.tight', {}, [
          wrapCompact('Gegenkonto bei Kreditkarten-Finanzierung', kreditkartenKonto),
          wrapCompact('Gegenkonto bei Bankkonto-Finanzierung', girokonto),
        ]),
      ]) : null,
      mk('div.table-wrap', { style: 'margin-top:8px' }, [
        mk('table', {}, [
          mk('tr', {}, model.headers.map(h => mk('th', { text: h || '(leer)' }))),
          ...model.rows.slice(1, 4).map(row => mk('tr', {}, model.headers.map((_, idx) => mk('td', { text: row[idx] || '' })))),
        ]),
      ]),
      mk('div.row', { style: 'margin-top:12px' }, [
        btn('Vorschau aktualisieren', recompute, 'sec'),
        btn('Importieren', () => {
          recompute();
          if (!controls.konto.value) {
            alert('Bitte zuerst ein Zielkonto auswählen.');
            return;
          }
          const importableRows = filterImportable(model.parsed, controls.konto.value);
          if (!importableRows.length) {
            alert('Keine importierbaren Buchungen gefunden.');
            return;
          }
          importableRows.forEach(addTransaktion);
          rerender();
        }),
      ])
    );

    root.querySelectorAll('select[data-map]').forEach(sel => sel.addEventListener('change', recompute));
    if (kreditkartenKonto) kreditkartenKonto.addEventListener('change', recompute);
    if (girokonto) girokonto.addEventListener('change', recompute);

    recompute();
  }

  function selectColumn(name, headers, selected, allowEmpty = false) {
    return mk('select.mapping-select', { 'data-map': name }, [
      allowEmpty ? mk('option', { value: '-1', text: '(nicht importieren)' }) : null,
      ...headers.map((h, idx) => mk('option', { value: String(idx), text: h || `Spalte ${idx + 1}`, selected: idx === selected })),
    ]);
  }

  function collectMapping(root) {
    const mapping = {};
    root.querySelectorAll('select[data-map]').forEach(sel => {
      mapping[sel.getAttribute('data-map')] = parseInt(sel.value, 10);
    });
    return mapping;
  }

  function parseTransactions(model, mapping, kontoId, fixedCategory, extra = {}) {
    if (!model.rows.length || mapping.datum === undefined) return [];
    const paypal = isPaypalShape(model.headers) ? paypalColumns(model.headers) : null;
    const paypalByCode = new Map();
    if (paypal) {
      model.rows.slice(1).forEach(row => {
        const code = value(row, paypal.transaktionscode);
        if (code) paypalByCode.set(code, row);
      });
    }
    return model.rows.slice(1)
      .map(row => {
        const datum = normalizeDate(value(row, mapping.datum));
        const betrag = amountFromRow(row, mapping);
        const empfaenger = canonicalEmpfaenger(value(row, mapping.empfaenger));
        const beschreibung = [
          value(row, mapping.beschreibung),
          value(row, mapping.beschreibung2),
          value(row, mapping.beschreibung3),
        ].filter(Boolean).join(' · ');

        if (paypal) {
          const typ = value(row, paypal.typ);
          const zugehoerig = value(row, paypal.zugehoerig);
          // Finanzierungszeile (Gegenstück zum eigentlichen Kauf): kein
          // eigener Empfänger, verweist per Zugehöriger Transaktionscode auf
          // die Kaufzeile. Typ verrät, ob Kreditkarte oder Girokonto belastet wurde.
          if (!empfaenger && zugehoerig && /gutschrift/i.test(typ)) {
            const gegenkontoId = /kreditkarte/i.test(typ)
              ? extra.kreditkartenKontoId
              : /bank/i.test(typ) ? extra.girokontoId : '';
            if (gegenkontoId) {
              const quellzeile = paypalByCode.get(zugehoerig);
              const quellEmpfaenger = quellzeile ? value(quellzeile, mapping.empfaenger) : '';
              return {
                datum, betrag,
                kategorie: '', kategorieQuelle: '', unterkategorie: '', tags: [],
                empfaenger: quellEmpfaenger,
                beschreibung: `Finanzierung: ${typ}`,
                kontoId, buchungstyp: 'transfer', gegenkontoId,
              };
            }
          }
        }

        const regelTreffer = kategorieUndTagsFuerBuchung({ empfaenger, beschreibung, betrag });
        const regelKategorie = regelTreffer ? regelTreffer.kategorie : '';
        // Nur übernehmen, wenn die von der Bank mitgelieferte Kategorie exakt
        // (bis auf Groß-/Kleinschreibung) einer bereits vorhandenen eigenen
        // Kategorie entspricht — sonst entstehen bei jedem Import parallele
        // Kategorien wie "Lebensmittel und Drogerie" neben der eigenen
        // "Nahrungsmittel und Getränke".
        const csvKategorie = findKategorie(value(row, mapping.kategorie));
        const kategorie = regelKategorie || csvKategorie || fixedCategory || '';
        const kategorieQuelle = regelKategorie ? 'regel' : (csvKategorie ? 'csv' : (fixedCategory ? 'manuell' : ''));
        const tags = [...new Set([...splitTags(value(row, mapping.tags)), ...(regelTreffer ? regelTreffer.tags : [])])];
        const unterkategorie = regelTreffer ? regelTreffer.unterkategorie : '';

        return { datum, betrag, kategorie, kategorieQuelle, unterkategorie, tags, empfaenger, beschreibung, kontoId };
      })
      .filter(t => t.datum && Number.isFinite(t.betrag) && Math.abs(t.betrag) > 0.000001);
  }

  function amountFromRow(row, mapping) {
    if (mapping.betrag !== undefined && mapping.betrag >= 0) return normalizeAmount(value(row, mapping.betrag));
    const soll = mapping.soll >= 0 ? normalizeAmount(value(row, mapping.soll)) : 0;
    const haben = mapping.haben >= 0 ? normalizeAmount(value(row, mapping.haben)) : 0;
    if (haben) return Math.abs(haben);
    if (soll) return -Math.abs(soll);
    return 0;
  }

  function value(row, idx) {
    return idx >= 0 ? (row[idx] || '').trim() : '';
  }

  // Sucht die passende Spalte in drei Stufen abnehmender Genauigkeit, damit
  // z.B. "Umsatz getätigt von" (Kartennummer) nicht vor "Buchungsbetrag"
  // als Betrag-Spalte erkannt wird, nur weil "Umsatz" irgendwo vorkommt.
  function autoIndex(headers, needles) {
    const normalized = headers.map(h => h.toLowerCase().trim());
    for (const n of needles) {
      const exact = normalized.findIndex(h => h === n);
      if (exact >= 0) return exact;
    }
    for (const n of needles) {
      const candidates = normalized.map((h, i) => ({ h, i })).filter(({ h }) => h.endsWith(n));
      if (candidates.length) {
        // "Originalbetrag" (Fremdwährung, oft 0) nicht vor "Buchungsbetrag" bevorzugen
        return (candidates.find(({ h }) => !h.includes('original')) || candidates[0]).i;
      }
    }
    for (const n of needles) {
      const loose = normalized.findIndex(h => h.includes(n));
      if (loose >= 0) return loose;
    }
    return -1;
  }

  function applyKnownProfile(headers, mapping) {
    const index = name => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
    const hasFinanzblickShape = [
      'Buchungsdatum',
      'Empfaenger',
      'Verwendungszweck',
      'Buchungstext',
      'Betrag',
      'Kategorie',
      'Konto',
    ].every(name => index(name) >= 0);

    if (!hasFinanzblickShape) return;
    mapping.datum = index('Buchungsdatum');
    mapping.betrag = index('Betrag');
    mapping.kategorie = index('Kategorie');
    mapping.tags = index('Schlagworte');
    mapping.empfaenger = index('Empfaenger');
    mapping.beschreibung = index('Verwendungszweck');
    mapping.beschreibung2 = index('Buchungstext');
    mapping.beschreibung3 = -1;
  }

  function renderPreview(root, rows, kontoId = '') {
    const kontoNamen = new Map(getState().konten.map(k => [k.id, k.name]));
    const duplicateKeys = existingTransactionKeys();
    const markedRows = rows.map(row => {
      const key = transactionKey({ ...row, kontoId: kontoId || row.kontoId });
      const duplicate = duplicateKeys.has(key);
      duplicateKeys.add(key);
      return { ...row, duplicate };
    });
    const importableRows = markedRows.filter(row => !row.duplicate);
    const summe = rows.reduce((sum, t) => sum + t.betrag, 0);
    root.replaceChildren(
      mk('div.flex-between', {}, [
        mk('h2', { text: 'Vorschau' }),
        rows.length ? mk('span.badge.ok', { text: `${importableRows.length} neu · ${markedRows.length - importableRows.length} doppelt · ${euro(summe)}` }) : null,
      ]),
      rows.length
        ? mk('table', {}, [
            mk('tr', {}, [
              mk('th', { text: 'Datum' }),
              mk('th', { text: 'Betrag' }),
              mk('th', { text: 'Empfänger' }),
              mk('th', { text: 'Kategorie' }),
              mk('th', { text: 'Tags' }),
              mk('th', { text: 'Beschreibung' }),
            ]),
            ...markedRows.slice(0, 30).map(t => mk('tr', {}, [
              mk('td', { text: fmtDate(t.datum) }),
              mk(`td.num${t.betrag >= 0 ? '.pos' : '.neg'}`, { text: euro(t.betrag) }),
              mk('td', { text: t.empfaenger || '' }),
              mk('td', { text: t.buchungstyp === 'transfer' ? `Transfer → ${kontoNamen.get(t.gegenkontoId) || '?'}` : t.kategorie }),
              mk('td', { text: (t.tags || []).join(', ') }),
              mk('td', {}, [
                t.duplicate ? mk('span.badge.warn', { text: 'schon vorhanden' }) : null,
                t.duplicate ? document.createTextNode(' ') : null,
                document.createTextNode(t.beschreibung),
              ]),
            ])),
          ])
        : mk('div.empty', { text: 'Keine importierbaren Buchungen gefunden.' })
    );
  }

  function transactionKey(t) {
    return [
      t.kontoId || '',
      t.datum || '',
      Number(t.betrag || 0).toFixed(2),
      // Ohne Empfänger: der kann sich nachträglich ändern (Zusammenführen,
      // Umbenennen, später gesetzt), die Bankbeschreibung bleibt stabil.
      normalizeTransactionText(t.beschreibung),
    ].join('|');
  }

  function normalizeTransactionText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function splitTags(value) {
    return value ? value.split(/[;,]/).map(t => t.trim()).filter(Boolean) : [];
  }

  function existingTransactionKeys() {
    return new Set(getState().transaktionen.map(transactionKey));
  }

  function filterImportable(rows, kontoId) {
    const duplicateKeys = existingTransactionKeys();
    return rows
      .map(row => ({ ...row, kontoId: kontoId || row.kontoId }))
      .filter(row => {
        const key = transactionKey(row);
        if (duplicateKeys.has(key)) return false;
        duplicateKeys.add(key);
        return true;
      });
  }

  function wrap(label, input) {
    return mk('div.field', {}, [mk('label', { text: label }), input]);
  }

  function wrapCompact(label, input) {
    return mk('div.field.compact', {}, [mk('label', { text: label }), input]);
  }

  window.renderImport = renderImport;
})();
