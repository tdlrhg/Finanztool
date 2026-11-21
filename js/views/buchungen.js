(function () {
  'use strict';

  const COLUMN_WIDTH_KEY = 'finanztool_buchungen_column_widths_v1';
  const COLUMN_ORDER_KEY = 'finanztool_buchungen_column_order_v1';
  const COLUMN_HIDDEN_KEY = 'finanztool_buchungen_column_hidden_v1';
  const TRANSACTION_COLUMNS = [
    { key: 'date', className: 'col-date', label: 'Datum', width: 92, min: 72 },
    { key: 'account', className: 'col-account', label: 'Konto', width: 116, min: 80 },
    { key: 'payee', className: 'col-payee', label: 'Empfänger', width: 210, min: 120 },
    { key: 'type', className: 'col-type', label: 'Typ', width: 128, min: 100 },
    { key: 'counterAccount', className: 'col-counter-account', label: 'Gegenkonto', width: 160, min: 120 },
    { key: 'category', className: 'col-category', label: 'Kategorie', width: 160, min: 120 },
    { key: 'subcategory', className: 'col-subcategory', label: 'Unterkategorie', width: 150, min: 110 },
    { key: 'source', className: 'col-source', label: 'Quelle', width: 94, min: 74 },
    { key: 'statistik', className: 'col-statistik', label: 'Statistik', width: 90, min: 74 },
    { key: 'tags', className: 'col-tags', label: 'Tags', width: 150, min: 100 },
    { key: 'desc', className: 'col-desc', label: 'Beschreibung', width: 310, min: 160 },
    { key: 'amount', className: 'col-amount', label: 'Betrag', width: 120, min: 90 },
    { key: 'actions', className: 'col-actions', label: '', width: 46, min: 40, fixed: true },
  ];

  // Bleibt über Seitenwechsel hinweg erhalten (nur für die laufende Sitzung),
  // damit ein gesetzter Filter nicht verschwindet, wenn man z.B. kurz nach
  // Einstellungen wechselt und wieder zu Buchungen zurückkommt.
  const savedFilterState = { konto: '', kategorie: '', empfaenger: '', tag: '', details: '', suche: '', von: '', bis: '' };

  function renderBuchungen(root) {
    const state = getState();
    const filters = {
      von: mk('input', { type: 'date', value: savedFilterState.von }),
      bis: mk('input', { type: 'date', value: savedFilterState.bis }),
      konto: mk('select', {}, [
        mk('option', { value: '', text: 'Alle Konten' }),
        ...state.konten.map(k => mk('option', { value: k.id, text: k.name })),
      ]),
      kategorie: mk('select', {}, [
        mk('option', { value: '', text: 'Alle Kategorien' }),
        mk('option', { value: '__none__', text: 'Ohne Kategorie' }),
        ...verwalteteKategorien(state).map(k => mk('option', { value: k, text: k })),
      ]),
      empfaenger: mk('select', {}, [
        mk('option', { value: '', text: 'Alle Empfänger' }),
        ...knownPayees(state).map(e => mk('option', { value: e, text: e })),
      ]),
      tag: mk('select', {}, [
        mk('option', { value: '', text: 'Alle Tags' }),
        mk('option', { value: '__none__', text: 'Ohne Tags' }),
        ...knownTags(state).map(tag => mk('option', { value: tag, text: tag })),
      ]),
      details: mk('select', {}, [
        mk('option', { value: '', text: 'Alle Buchungen' }),
        mk('option', { value: 'yes', text: 'Mit Einzelpositionen' }),
        mk('option', { value: 'no', text: 'Ohne Einzelpositionen' }),
      ]),
      suche: mk('input', { type: 'search', placeholder: 'Suchen', value: savedFilterState.suche }),
    };
    Object.entries(filters).forEach(([key, input]) => {
      if (input.tagName === 'SELECT') input.value = savedFilterState[key];
    });

    const result = mk('div');
    const sort = { key: 'date', dir: 'desc' };
    const splitMode = { on: false };
    const duplikateAnsicht = { on: false };
    // Bearbeitest du eine Buchung so, dass sie nicht mehr zum aktiven Filter
    // passt (z.B. "Ohne Kategorie" verlassen), bleibt sie trotzdem sichtbar
    // — sonst verschwindet sie mitten in der Bearbeitung, bevor du z.B. noch
    // die Unterkategorie setzen kannst. Ein echter Filterwechsel räumt das
    // wieder auf.
    const pinned = new Set();
    const update = (pinId) => {
      if (pinId) pinned.add(pinId);
      const currentState = getState();
      const sortedRows = sortRows(applyFilters(currentState, filters, pinned), sort, currentState);
      renderResult(result, sortedRows, update, sort, splitMode, duplikateAnsicht);
    };

    Object.entries(filters).forEach(([key, input]) => {
      const onChange = () => { savedFilterState[key] = input.value; pinned.clear(); update(); };
      input.addEventListener('change', onChange);
      input.addEventListener('input', onChange);
    });

    root.appendChild(mk('div.flex-between', {}, [
      mk('h1', { text: 'Buchungen' }),
      buchungHinzufuegenButton(state, update),
    ]));
    root.appendChild(mk('div.sub', { text: 'Alle importierten Kontobuchungen mit Empfänger, Kategorie und Beschreibung.' }));
    root.appendChild(mk('div.card', {}, [
      mk('h2', { text: 'Filtern' }),
      mk('div.row', {}, [
        wrap('Von', filters.von),
        wrap('Bis', filters.bis),
        wrap('Konto', filters.konto),
        wrap('Kategorie', filters.kategorie),
        wrap('Empfänger', filters.empfaenger),
        wrap('Tag', filters.tag),
        wrap('Details', filters.details),
        wrap('Suche', filters.suche),
      ]),
    ]));
    root.appendChild(result);
    update();
  }

  // Für Buchungen, die beim Import gefehlt haben und von Hand nachgetragen
  // werden müssen — es gibt sonst keinen Weg, eine komplett neue Buchung
  // anzulegen (Import legt nur aus CSV-Zeilen an). Steckt hinter einem
  // Plus-Button in einem Overlay, statt dauerhaft Platz auf der Seite zu
  // belegen.
  function buchungHinzufuegenButton(state, update) {
    const openBtn = mk('button.btn.fab-add', { title: 'Buchung hinzufügen', 'aria-label': 'Buchung hinzufügen' }, [
      mk('span', { text: '+' }),
    ]);
    openBtn.addEventListener('click', () => {
      let close = () => {};
      const formular = buildBuchungFormular(state, update, () => close());
      close = openModal(formular);
    });
    return openBtn;
  }

  function buildBuchungFormular(state, update, close) {
    if (!state.konten.length) {
      return mk('div', {}, [
        mk('h2', { text: 'Buchung hinzufügen' }),
        mk('div.empty', { text: 'Lege zuerst unter Einstellungen ein Konto an.' }),
      ]);
    }

    const datum = mk('input', { type: 'date', value: todayISO() });
    const konto = mk('select', {}, state.konten.map(k => mk('option', { value: k.id, text: k.name })));
    const betrag = mk('input', { type: 'number', step: '0.01', placeholder: 'Betrag' });
    const empfaenger = mk('input', { placeholder: 'Empfänger' });
    const kategorie = mk('select', {}, kategorieOptions(''));
    const unterkategorie = mk('select', {}, unterkategorieOptions('', ''));
    const tags = mk('input', { placeholder: 'Tags' });
    const beschreibung = mk('input', { placeholder: 'Beschreibung' });
    const status = mk('div');

    kategorie.addEventListener('change', () => {
      unterkategorie.replaceChildren(...unterkategorieOptions(kategorie.value, ''));
    });

    return mk('div', {}, [
      mk('h2', { text: 'Buchung hinzufügen' }),
      mk('div.sub', { text: 'Für Buchungen, die beim Import gefehlt haben und von Hand nachgetragen werden.' }),
      mk('div.row', {}, [
        wrap('Datum', datum),
        wrap('Konto', konto),
        wrap('Betrag', betrag),
        wrap('Empfänger', empfaenger),
        wrap('Kategorie', kategorie),
        wrap('Unterkategorie', unterkategorie),
        wrap('Tags', tags),
        wrap('Beschreibung', beschreibung),
      ]),
      status,
      mk('div.row', { style: 'margin-top:10px' }, [
        btn('Anlegen', () => {
          const wert = Number(betrag.value);
          if (!datum.value || !Number.isFinite(wert) || !wert) {
            status.replaceChildren(mk('span.badge.warn', { text: 'Bitte Datum und Betrag angeben.' }));
            return;
          }
          addTransaktion({
            datum: datum.value,
            kontoId: konto.value,
            betrag: wert,
            empfaenger: canonicalEmpfaenger(empfaenger.value),
            kategorie: kategorie.value,
            unterkategorie: unterkategorie.value,
            tags: tags.value,
            beschreibung: beschreibung.value,
            kategorieQuelle: kategorie.value ? 'manuell' : '',
          });
          update();
          close();
        }),
      ]),
    ]);
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

  function renderResult(root, rows, update, sort, splitMode, duplikateAnsicht) {
    const echteRows = rows.filter(t => !istTransfer(t));
    const einnahmen = echteRows.filter(t => t.betrag > 0).reduce((sum, t) => sum + t.betrag, 0);
    const ausgaben = echteRows.filter(t => t.betrag < 0).reduce((sum, t) => sum + t.betrag, 0);
    const saldo = einnahmen + ausgaben;
    const konten = new Map(getState().konten.map(k => [k.id, k.name]));
    const tags = knownTags(getState());
    const expanded = new Set();
    const duplicates = duplicateTransactions(rows);
    const angezeigteRows = duplikateAnsicht.on ? duplicates : rows;
    // Die Tabellen-Hülle wird bei jeder Änderung neu gebaut — ohne das hier
    // würde die horizontale Scrollposition bei jeder Bearbeitung (z.B. Tag
    // am rechten Rand) auf 0 zurückspringen.
    const vorherigerScroll = root.querySelector('.table-wrap')?.scrollLeft || 0;
    const tableHost = mk('div.table-wrap');
    const renderTable = () => renderTransactionsTable(tableHost, angezeigteRows, konten, tags, expanded, splitMode, duplikateAnsicht, renderTable, update, sort);
    const children = [
      mk('div.grid.cols-3', {}, [
        stat('Buchungen', String(rows.length)),
        stat('Einnahmen', euro(einnahmen), 'pos'),
        stat('Ausgaben', euro(Math.abs(ausgaben)), ausgaben < 0 ? 'neg' : ''),
        stat('Saldo Auswahl', euro(saldo), saldo >= 0 ? 'pos' : 'neg'),
      ]),
      mk('datalist#buchungen-tags', {}, tags.map(tag => mk('option', { value: tag }))),
      mk('div.card', { style: 'margin-top:16px' }, [
        rows.length ? mk('div.flex-between', {}, [
          mk('h2', { text: duplikateAnsicht.on ? 'Duplikate' : 'Gefilterte Buchungen' }),
          mk('div.row', {}, [
            spaltenButton(update),
            splitModeToggle(splitMode, update),
            duplicateReviewToggle(duplicates, duplikateAnsicht, update),
            duplikateAnsicht.on ? duplicateDeleteButton(duplicates, () => { duplikateAnsicht.on = false; update(); }) : null,
            bulkDeleteButton(rows, update),
          ]),
        ]) : null,
        rows.length && splitMode.on ? mk('div.sub', { text: 'Aufsplitten-Modus aktiv: Klick auf den Betrag einer Buchung, um sie in Positionen aufzuteilen.' }) : null,
        duplikateAnsicht.on ? mk('div.sub', { text: `${duplicates.length} doppelt erkannte Buchung(en) — jeweils der ältere Eintrag bleibt beim Löschen erhalten.` }) : null,
        angezeigteRows.length ? tableHost : mk('div.empty', { text: duplikateAnsicht.on ? 'Keine Duplikate gefunden.' : 'Keine Buchungen gefunden.' }),
      ]),
    ].filter(Boolean);

    root.replaceChildren(...children);
    renderTable();
    tableHost.scrollLeft = vorherigerScroll;
  }


  function renderTransactionsTable(root, rows, konten, tags, expanded, splitMode, duplikateAnsicht, refresh, update, sort) {
    const columns = visibleColumns();
    const widths = loadColumnWidths();
    const tableWidth = columns.reduce((sum, column) => sum + columnWidth(column, widths), 0);
    root.replaceChildren(mk('table.tx-table', { style: `width:${tableWidth}px;min-width:${tableWidth}px` }, [
      mk('colgroup', {}, columns.map(column => (
        mk(`col.${column.className}`, { style: `width:${columnWidth(column, widths)}px` })
      ))),
      mk('tr', {}, columns.map((column, index) => resizableHeader(column, index, widths, columns, sort, update, () => {
        renderTransactionsTable(root, rows, konten, tags, expanded, splitMode, duplikateAnsicht, refresh, update, sort);
      }))),
      ...rows.flatMap(t => {
        const detailRows = expanded.has(t.id) ? (t.detailPositionen || []).map(item => detailPositionRow(t, item, columns, refresh)) : [];
        const addRow = splitMode.on && expanded.has(t.id) ? [addPositionRow(t, columns, refresh)] : [];
        return [transactionRow(t, konten, tags, expanded, splitMode, duplikateAnsicht, refresh, update, columns), ...detailRows, ...addRow];
      }),
    ]));
  }

  function resizableHeader(column, index, widths, columns, sort, update, refresh) {
    const th = mk(`th.resizable-th${column.fixed ? '' : '.draggable-th'}`, { draggable: column.fixed ? false : true }, [
      column.fixed ? mk('span', { text: column.label }) : sortLabel(column, sort, update),
      column.fixed ? null : mk('span.col-resizer', { title: 'Spaltenbreite ändern' }),
    ]);
    if (!column.fixed) {
      th.addEventListener('click', event => {
        if (event.target.closest('.col-resizer')) return;
        applySort(column, sort, update);
      });
      th.addEventListener('dragstart', event => {
        if (event.target.closest('.col-resizer')) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData('text/plain', column.key);
        event.dataTransfer.effectAllowed = 'move';
        th.classList.add('is-dragging');
      });
      th.addEventListener('dragend', () => th.classList.remove('is-dragging'));
      th.addEventListener('dragover', event => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        th.classList.add('is-drop-target');
      });
      th.addEventListener('dragleave', () => th.classList.remove('is-drop-target'));
      th.addEventListener('drop', event => {
        event.preventDefault();
        th.classList.remove('is-drop-target');
        const draggedKey = event.dataTransfer.getData('text/plain');
        if (!draggedKey || draggedKey === column.key) return;
        const next = moveColumn(columns, draggedKey, column.key);
        saveColumnOrder(next);
        refresh();
      });
    }
    const handle = th.querySelector('.col-resizer');
    if (!handle) return th;
    handle.addEventListener('pointerdown', event => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = columnWidth(column, widths);
      const table = th.closest('table');
      const col = table?.querySelectorAll('col')[index];
      handle.setPointerCapture(event.pointerId);
      th.classList.add('is-resizing');
      const move = moveEvent => {
        const next = Math.max(column.min, startWidth + moveEvent.clientX - startX);
        widths[column.key] = Math.round(next);
        saveColumnWidths(widths);
        if (col) col.style.width = `${widths[column.key]}px`;
        if (table) {
          const tableWidth = columns.reduce((sum, item) => sum + columnWidth(item, widths), 0);
          table.style.width = `${tableWidth}px`;
          table.style.minWidth = `${tableWidth}px`;
        }
      };
      const up = upEvent => {
        th.classList.remove('is-resizing');
        handle.releasePointerCapture(upEvent.pointerId);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    return th;
  }

  function sortLabel(column, sort, update) {
    const active = sort.key === column.key;
    const indicator = active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
    const label = mk('span.sort-label', { text: `${column.label}${indicator}`, title: 'Sortieren' });
    label.addEventListener('click', event => {
      event.stopPropagation();
      applySort(column, sort, update);
    });
    return label;
  }

  function applySort(column, sort, update) {
    if (sort.key === column.key) {
      sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      sort.key = column.key;
      sort.dir = column.key === 'date' || column.key === 'amount' ? 'desc' : 'asc';
    }
    update();
  }

  function orderedColumns() {
    let stored = [];
    try {
      const raw = localStorage.getItem(COLUMN_ORDER_KEY);
      stored = raw ? JSON.parse(raw) : [];
    } catch (error) {
      stored = [];
    }
    const byKey = new Map(TRANSACTION_COLUMNS.map(column => [column.key, column]));
    const ordered = stored
      .map(key => byKey.get(key))
      .filter(column => column && !column.fixed);
    const known = new Set(ordered.map(column => column.key));
    const missing = TRANSACTION_COLUMNS.filter(column => !column.fixed && !known.has(column.key));
    const fixed = TRANSACTION_COLUMNS.filter(column => column.fixed);
    return [...ordered, ...missing, ...fixed];
  }

  function saveColumnOrder(columns) {
    localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(columns.filter(column => !column.fixed).map(column => column.key)));
  }

  function loadHiddenColumns() {
    try {
      const raw = localStorage.getItem(COLUMN_HIDDEN_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch (error) {
      return new Set();
    }
  }

  function saveHiddenColumns(hidden) {
    localStorage.setItem(COLUMN_HIDDEN_KEY, JSON.stringify([...hidden]));
  }

  // Spalten, die tatsächlich gerendert werden — orderedColumns() bleibt die
  // vollständige Liste (für Drag&Drop-Reihenfolge), ausgeblendete Spalten
  // fallen hier einfach raus.
  function visibleColumns() {
    const hidden = loadHiddenColumns();
    return orderedColumns().filter(column => column.fixed || !hidden.has(column.key));
  }

  function moveColumn(columns, draggedKey, targetKey) {
    const movable = columns.filter(column => !column.fixed);
    const fixed = columns.filter(column => column.fixed);
    const from = movable.findIndex(column => column.key === draggedKey);
    const to = movable.findIndex(column => column.key === targetKey);
    if (from < 0 || to < 0) return columns;
    const [item] = movable.splice(from, 1);
    movable.splice(to, 0, item);
    return [...movable, ...fixed];
  }

  function loadColumnWidths() {
    try {
      const raw = localStorage.getItem(COLUMN_WIDTH_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return typeof parsed === 'object' && parsed ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function saveColumnWidths(widths) {
    localStorage.setItem(COLUMN_WIDTH_KEY, JSON.stringify(widths));
  }

  function columnWidth(column, widths) {
    const stored = Number(widths[column.key]);
    return Number.isFinite(stored) ? Math.max(column.min, stored) : column.width;
  }

  function transactionRow(t, konten, tags, expanded, splitMode, duplikateAnsicht, refresh, update, columns) {
    return mk('tr', {}, columns.map(column => transactionCell(column, t, konten, tags, expanded, splitMode, duplikateAnsicht, refresh, update)));
  }

  function transactionCell(column, t, konten, tags, expanded, splitMode, duplikateAnsicht, refresh, update) {
    const hasDetails = (t.detailPositionen || []).length > 0;
    const cells = {
      date: () => mk('td', {}, [dateInput(t, update)]),
      account: () => mk('td', { text: konten.get(t.kontoId) || '' }),
      payee: () => mk('td', { text: t.empfaenger || '' }),
      type: () => mk('td', {}, [bookingTypeSelect(t, update)]),
      counterAccount: () => mk('td', {}, [counterAccountSelect(t, konten, update)]),
      category: () => mk('td', {}, [categoryInput(t, update)]),
      subcategory: () => mk('td', {}, [unterkategorieInput(t, update)]),
      source: () => mk('td', {}, [sourceBadge(t.kategorieQuelle)]),
      statistik: () => mk('td', {}, [statistikCheckbox(t, update)]),
      tags: () => mk('td', {}, [tagsInput(t)]),
      desc: () => mk('td', {}, [
        hasDetails ? btn(expanded.has(t.id) ? '−' : '+', () => {
          if (expanded.has(t.id)) expanded.delete(t.id);
          else expanded.add(t.id);
          refresh();
        }, 'sm sec') : null,
        hasDetails ? document.createTextNode(' ') : null,
        hasDetails ? mk('span.badge.ok', { text: `${t.detailPositionen.length} Details` }) : null,
        hasDetails ? document.createTextNode(' ') : null,
        document.createTextNode(t.beschreibung || ''),
      ]),
      amount: () => mk(`td.num${t.betrag >= 0 ? '.pos' : '.neg'}`, {}, [
        splitMode.on ? splitAmountTrigger(t, expanded, refresh) : amountInput(t, update),
      ]),
      actions: () => mk('td', {}, [
        duplikateAnsicht && duplikateAnsicht.on
          ? btn('Kein Duplikat', () => { updateTransaktion(t.id, { keinDuplikat: true }); update(); }, 'sm sec')
          : null,
        trashButton(() => { if (confirm('Buchung löschen?')) { deleteTransaktion(t.id); update(); } }),
      ]),
    };
    return cells[column.key] ? cells[column.key]() : mk('td', { text: '' });
  }

  function detailPositionRow(parent, item, columns, refresh) {
    return mk('tr.detail-row', {}, columns.map(column => detailPositionCell(column, parent, item, refresh)));
  }

  function detailPositionCell(column, parent, item, refresh) {
    const cells = {
      date: () => mk('td', { text: fmtDate(item.datum) }),
      account: () => mk('td', { text: '' }),
      payee: () => mk('td', { text: item.empfaenger || '' }),
      type: () => mk('td', { text: '' }),
      counterAccount: () => mk('td', { text: '' }),
      category: () => mk('td', {}, [detailCategoryInput(parent, item, refresh)]),
      subcategory: () => mk('td', {}, [detailUnterkategorieInput(parent, item)]),
      source: () => mk('td', {}, [sourceBadge(item.kategorieQuelle)]),
      tags: () => mk('td', {}, [detailTagsInput(parent, item)]),
      desc: () => mk('td', { text: item.beschreibung || '' }),
      amount: () => mk(`td.num${item.betrag >= 0 ? '.pos' : '.neg'}`, { text: euro(item.betrag) }),
      actions: () => mk('td', {}, [trashButton(() => {
        updateTransaktion(parent.id, { detailPositionen: (parent.detailPositionen || []).filter(i => i.id !== item.id) });
        refresh();
      })]),
    };
    return cells[column.key] ? cells[column.key]() : mk('td', { text: '' });
  }

  function applyFilters(state, filters, pinned) {
    const query = filters.suche.value.trim().toLowerCase();
    return state.transaktionen
      .filter(t => (pinned && pinned.has(t.id)) || matchesFilters(t, filters, query))
      .slice();
  }

  function matchesFilters(t, filters, query) {
    if (filters.von.value && (t.datum || '') < filters.von.value) return false;
    if (filters.bis.value && (t.datum || '') > filters.bis.value) return false;
    if (filters.konto.value && t.kontoId !== filters.konto.value) return false;
    if (filters.kategorie.value) {
      if (filters.kategorie.value === '__none__') {
        if (istTransfer(t)) return false;
        const positionen = t.detailPositionen || [];
        // Aufgesplittete Buchungen tragen selbst keine Kategorie mehr —
        // "Ohne Kategorie" heißt hier: mindestens eine Position hat noch
        // keine, nicht "die Elternbuchung hat keine" (die hat nie eine).
        const fehltNoch = positionen.length ? positionen.some(item => !item.kategorie) : !t.kategorie;
        if (!fehltNoch) return false;
      } else if (t.kategorie !== filters.kategorie.value && !(t.detailPositionen || []).some(item => item.kategorie === filters.kategorie.value)) {
        return false;
      }
    }
    if (filters.empfaenger.value && t.empfaenger !== filters.empfaenger.value && !(t.detailPositionen || []).some(item => item.empfaenger === filters.empfaenger.value)) return false;
    if (filters.details.value) {
      const hasDetails = (t.detailPositionen || []).length > 0;
      if (filters.details.value === 'yes' && !hasDetails) return false;
      if (filters.details.value === 'no' && hasDetails) return false;
    }
    if (filters.tag.value) {
      const tags = t.tags || [];
      if (filters.tag.value === '__none__') {
        if (tags.length !== 0) return false;
      } else if (!tags.includes(filters.tag.value) && !(t.detailPositionen || []).some(item => (item.tags || []).includes(filters.tag.value))) {
        return false;
      }
    }
    if (query && !matchesSearch(t, query)) return false;
    return true;
  }

  function sortRows(rows, sort, state) {
    const konten = new Map(state.konten.map(k => [k.id, k.name]));
    const dir = sort.dir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => compareValues(sortValue(a, sort.key, konten), sortValue(b, sort.key, konten)) * dir);
  }

  function sortValue(t, key, konten) {
    const values = {
      date: () => t.datum || '',
      account: () => konten.get(t.kontoId) || '',
      payee: () => t.empfaenger || '',
      type: () => istTransfer(t) ? 'Transfer' : 'Buchung',
      counterAccount: () => konten.get(t.gegenkontoId) || '',
      category: () => t.kategorie || '',
      source: () => sourceLabelText(t.kategorieQuelle),
      tags: () => (t.tags || []).join(', '),
      desc: () => t.beschreibung || '',
      amount: () => Number(t.betrag || 0),
    };
    return values[key] ? values[key]() : '';
  }

  function compareValues(a, b) {
    if (typeof a === 'number' || typeof b === 'number') return Number(a || 0) - Number(b || 0);
    return String(a || '').localeCompare(String(b || ''), 'de', { numeric: true, sensitivity: 'base' });
  }

  function matchesSearch(t, query) {
    const amount = Number(t.betrag || 0);
    const amountTexts = [
      String(amount),
      amount.toFixed(2),
      amount.toFixed(2).replace('.', ','),
      Math.abs(amount).toFixed(2),
      Math.abs(amount).toFixed(2).replace('.', ','),
    ];
    const textValues = [
      t.datum,
      t.empfaenger,
      t.kategorie,
      (t.tags || []).join(' '),
      t.beschreibung,
      ...amountTexts,
      ...(t.detailPositionen || []).flatMap(item => detailSearchValues(item)),
    ];
    return textValues.some(v => (v || '').toLowerCase().includes(query));
  }

  function detailSearchValues(item) {
    const amount = Number(item.betrag || 0);
    return [
      item.datum,
      item.empfaenger,
      item.kategorie,
      (item.tags || []).join(' '),
      item.beschreibung,
      String(amount),
      amount.toFixed(2),
      amount.toFixed(2).replace('.', ','),
      Math.abs(amount).toFixed(2),
      Math.abs(amount).toFixed(2).replace('.', ','),
    ];
  }

  function stat(label, value, cls = '') {
    return mk('div.stat', {}, [
      mk('div.stat-label', { text: label }),
      mk(`div.stat-value${cls ? '.' + cls : ''}`, { text: value }),
    ]);
  }

  function bulkDeleteButton(rows, update) {
    return btn(`${rows.length} Treffer löschen`, () => {
      const count = rows.length;
      if (!count) return;
      if (!confirm(`${count} gefilterte Buchung(en) wirklich löschen?`)) return;
      rows.forEach(row => deleteTransaktion(row.id));
      update();
    }, 'sm danger');
  }

  // Zeigt "Duplikate anzeigen" statt sofort zu löschen — erst wenn die
  // Vorschau aktiv ist (die betroffenen Buchungen also tatsächlich sichtbar
  // sind), erscheint der eigentliche Löschen-Button daneben.
  function duplicateReviewToggle(duplicates, duplikateAnsicht, update) {
    if (!duplikateAnsicht.on && !duplicates.length) return mk('span.badge.ok', { text: 'Keine Duplikate' });
    return btn(duplikateAnsicht.on ? 'Duplikate ausblenden' : `${duplicates.length} Duplikate anzeigen`, () => {
      duplikateAnsicht.on = !duplikateAnsicht.on;
      update();
    }, duplikateAnsicht.on ? 'sm' : 'sm sec');
  }

  function duplicateDeleteButton(duplicates, onDeleted) {
    return btn(`${duplicates.length} Duplikate löschen`, () => {
      if (!confirm(`${duplicates.length} doppelte Buchung(en) löschen? Jeweils ein Eintrag bleibt erhalten.`)) return;
      duplicates.forEach(row => deleteTransaktion(row.id));
      onDeleted();
    }, 'sm danger');
  }

  function duplicateTransactions(rows) {
    const filteredIds = new Set(rows.map(row => row.id));
    const seen = new Set();
    const duplicates = [];
    getState().transaktionen
      .filter(row => filteredIds.has(row.id))
      .forEach(row => {
        if (row.keinDuplikat) return;
        const key = duplicateKey(row);
        if (seen.has(key)) duplicates.push(row);
        else seen.add(key);
      });
    return duplicates;
  }

  function duplicateKey(t) {
    return [
      t.kontoId || '',
      t.datum || '',
      Number(t.betrag || 0).toFixed(2),
      normalizeDuplicateText(t.empfaenger),
      normalizeDuplicateText(t.beschreibung),
    ].join('|');
  }

  function normalizeDuplicateText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  }

  function verwalteteKategorien(state) {
    return unique(state.kategorien);
  }

  function knownTags(state) {
    return unique([
      ...state.transaktionen.flatMap(t => t.tags || []),
      ...state.transaktionen.flatMap(t => (t.detailPositionen || []).flatMap(item => item.tags || [])),
    ]);
  }

  function knownPayees(state) {
    return unique([
      ...state.transaktionen.map(t => t.empfaenger),
      ...state.transaktionen.flatMap(t => (t.detailPositionen || []).map(item => item.empfaenger)),
    ]);
  }

  function categoryInput(t, update) {
    if (istTransfer(t)) return mk('span.muted', { text: 'Transfer' });
    if ((t.detailPositionen || []).length) return mk('span.muted', { text: 'siehe Positionen' });
    const select = mk('select.cell-input', {}, kategorieOptions(t.kategorie));
    select.addEventListener('change', () => {
      updateTransaktion(t.id, { kategorie: select.value, kategorieQuelle: 'manuell' });
      update(t.id);
    });
    return select;
  }

  function kategorieOptions(currentValue) {
    const kategorien = getState().kategorien;
    const options = (!currentValue || kategorien.includes(currentValue) ? kategorien : [currentValue, ...kategorien])
      .slice()
      .sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
    return [
      mk('option', { value: '', text: '(keine Kategorie)', selected: !currentValue }),
      ...options.map(k => mk('option', { value: k, text: k, selected: currentValue === k })),
    ];
  }

  function unterkategorieOptions(kategorie, currentValue) {
    const unterkategorien = kategorie ? unterkategorienFuer(kategorie) : [];
    return [
      mk('option', { value: '', text: '(keine)', selected: !currentValue }),
      ...unterkategorien.map(u => mk('option', { value: u, text: u, selected: currentValue === u })),
    ];
  }

  function unterkategorieInput(t, update) {
    if (istTransfer(t)) return mk('span.muted', { text: '' });
    if ((t.detailPositionen || []).length) return mk('span.muted', { text: '' });
    if (!t.kategorie) return mk('span.muted', { text: 'erst Kategorie wählen' });
    const unterkategorien = unterkategorienFuer(t.kategorie);
    if (!unterkategorien.length) return mk('span.muted', { text: 'keine angelegt' });
    const options = !t.unterkategorie || unterkategorien.includes(t.unterkategorie) ? unterkategorien : [t.unterkategorie, ...unterkategorien];
    const select = mk('select.cell-input', {}, [
      mk('option', { value: '', text: '(keine)', selected: !t.unterkategorie }),
      ...options.map(u => mk('option', { value: u, text: u, selected: t.unterkategorie === u })),
    ]);
    select.addEventListener('change', () => {
      updateTransaktion(t.id, { unterkategorie: select.value });
      update(t.id);
    });
    return select;
  }

  function dateInput(t, update) {
    const input = mk('input.cell-input', { type: 'date', value: t.datum || '' });
    input.addEventListener('change', () => {
      if (!input.value) { input.value = t.datum || ''; return; }
      updateTransaktion(t.id, { datum: input.value });
      update(t.id);
    });
    return input;
  }

  function amountInput(t, update) {
    const input = mk('input.cell-input.amount-input', { value: formatAmountInput(t.betrag), inputmode: 'decimal' });
    const save = () => {
      const betrag = parseAmountInput(input.value);
      if (!Number.isFinite(betrag)) {
        input.value = formatAmountInput(t.betrag);
        return;
      }
      if (Math.abs(betrag - Number(t.betrag || 0)) < 0.000001) return;
      updateTransaktion(t.id, { betrag });
      update(t.id);
    };
    input.addEventListener('change', save);
    input.addEventListener('blur', save);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        save();
        input.blur();
      }
    });
    return input;
  }

  function formatAmountInput(value) {
    return Number(value || 0).toFixed(2).replace('.', ',');
  }

  function parseAmountInput(value) {
    const normalized = String(value || '')
      .replace(/\s/g, '')
      .replace(/€/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    return Number(normalized);
  }

  function bookingTypeSelect(t, update) {
    const select = mk('select.cell-input', {}, [
      mk('option', { value: 'buchung', text: 'Buchung', selected: !istTransfer(t) }),
      mk('option', { value: 'transfer', text: 'Transfer', selected: istTransfer(t) }),
    ]);
    select.addEventListener('change', () => {
      const patch = { buchungstyp: select.value };
      if (select.value === 'transfer') {
        patch.kategorie = '';
        patch.kategorieQuelle = 'manuell';
      } else {
        patch.gegenkontoId = '';
      }
      updateTransaktion(t.id, patch);
      update(t.id);
    });
    return select;
  }

  function spaltenButton(update) {
    return btn('Spalten', () => openModal(spaltenFormular(update)), 'sm sec');
  }

  function spaltenFormular(update) {
    const hidden = loadHiddenColumns();
    const zeilen = TRANSACTION_COLUMNS.filter(column => !column.fixed).map(column => {
      const cb = mk('input', { type: 'checkbox', checked: !hidden.has(column.key) });
      cb.addEventListener('change', () => {
        const current = loadHiddenColumns();
        if (cb.checked) current.delete(column.key); else current.add(column.key);
        saveHiddenColumns(current);
        update();
      });
      return mk('label.inline-check', {}, [cb, document.createTextNode(` ${column.label}`)]);
    });
    return mk('div', {}, [
      mk('h2', { text: 'Spalten ein-/ausblenden' }),
      mk('div', { style: 'display:flex; flex-direction:column; gap:8px; margin-top:8px' }, zeilen),
    ]);
  }

  // Globaler Umschalter statt Aufsplitten-Button an jeder einzelnen
  // Buchung: solange aktiv, öffnet ein Klick auf den Betrag die
  // Positionen-Aufteilung für diese Buchung.
  function splitModeToggle(splitMode, update) {
    const b = btn(splitMode.on ? 'Aufsplitten-Modus: An' : 'Aufsplitten-Modus', () => {
      splitMode.on = !splitMode.on;
      update();
    }, splitMode.on ? 'sm' : 'sm sec');
    return b;
  }

  function splitAmountTrigger(t, expanded, refresh) {
    const span = mk('span', { text: euro(t.betrag), title: 'Klicken zum Aufsplitten', style: 'cursor:pointer; text-decoration:underline dotted;' });
    span.addEventListener('click', () => {
      expanded.add(t.id);
      refresh();
    });
    return span;
  }

  // Neue Position anlegen, während eine Buchung im Aufsplitten-Modus
  // aufgeklappt ist. Zeigt den noch nicht zugeordneten Rest der Summe an.
  function addPositionRow(parent, columns, refresh) {
    // Text statt type="number": passt zum Rest der App (deutsches
    // Komma-Format via parseAmountInput/formatAmountInput) und hat keine
    // verwirrenden Auf/Ab-Pfeile für einen Geldbetrag.
    const betrag = mk('input.cell-input', { placeholder: 'z.B. -12,50', inputmode: 'decimal' });
    const kategorie = mk('select.cell-input', {}, kategorieOptions(''));
    const unterkategorie = mk('select.cell-input', {}, unterkategorieOptions('', ''));
    const summe = (parent.detailPositionen || []).reduce((sum, item) => sum + item.betrag, 0);
    const restEl = mk('td.muted', { text: restText(parent, summe) });

    const aktualisierenRest = () => {
      const eingabe = parseAmountInput(betrag.value);
      const offen = Number.isFinite(eingabe) ? summe + eingabe : summe;
      restEl.textContent = restText(parent, offen);
    };
    betrag.addEventListener('input', aktualisierenRest);

    kategorie.addEventListener('change', () => {
      unterkategorie.replaceChildren(...unterkategorieOptions(kategorie.value, ''));
    });

    const hinzufuegen = () => {
      const wert = parseAmountInput(betrag.value);
      if (!Number.isFinite(wert) || !wert) return;
      updateTransaktion(parent.id, {
        detailPositionen: [...(parent.detailPositionen || []), {
          datum: parent.datum,
          betrag: wert,
          empfaenger: parent.empfaenger,
          beschreibung: '',
          kategorie: kategorie.value,
          kategorieQuelle: kategorie.value ? 'manuell' : '',
          unterkategorie: unterkategorie.value,
          tags: [],
          quelle: 'manuell',
        }],
      });
      refresh();
    };
    betrag.addEventListener('keydown', event => { if (event.key === 'Enter') hinzufuegen(); });

    const cells = {
      desc: () => restEl,
      category: () => mk('td', {}, [kategorie]),
      subcategory: () => mk('td', {}, [unterkategorie]),
      amount: () => mk('td', {}, [betrag]),
      actions: () => mk('td', {}, [btn('+', hinzufuegen, 'sm')]),
    };
    return mk('tr.detail-row', {}, columns.map(column => (cells[column.key] ? cells[column.key]() : mk('td', { text: '' }))));
  }

  function restText(parent, zugeordnet) {
    return `Rest: ${euro((parent.betrag || 0) - zugeordnet)}`;
  }

  // Buchung bleibt importiert und zählt zum Kontostand, taucht aber nicht in
  // der Auswertung auf (z.B. eine einmalige Ausnahme, die die Statistik
  // verzerren würde).
  function statistikCheckbox(t, update) {
    const cb = mk('input', { type: 'checkbox', checked: !t.ausAuswertung, title: 'In Auswertung berücksichtigen' });
    cb.addEventListener('change', () => {
      updateTransaktion(t.id, { ausAuswertung: !cb.checked });
      update(t.id);
    });
    return cb;
  }

  function trashButton(onClick) {
    return mk('button.btn.sm.danger.icon-btn', { title: 'Buchung löschen', 'aria-label': 'Buchung löschen', onclick: onClick }, [
      mk('span', { text: '🗑' }),
    ]);
  }

  function counterAccountSelect(t, konten, update) {
    const select = mk('select.cell-input', { disabled: istTransfer(t) ? null : true }, [
      mk('option', { value: '', text: istTransfer(t) ? '(wählen)' : '' }),
      ...[...konten.entries()]
        .filter(([id]) => id !== t.kontoId)
        .map(([id, name]) => mk('option', { value: id, text: name, selected: t.gegenkontoId === id })),
    ]);
    select.addEventListener('change', () => {
      updateTransaktion(t.id, { gegenkontoId: select.value });
      update(t.id);
    });
    return select;
  }

  function sourceBadge(source) {
    const label = sourceLabelText(source);
    return label ? mk(`span.badge${source === 'manuell' ? '.ok' : '.warn'}`, { text: label }) : mk('span.muted', { text: '' });
  }

  function sourceLabelText(source) {
    return {
      manuell: 'manuell',
      regel: 'Regel',
      csv: 'CSV',
      default: 'Default',
      detailimport: 'Detailimport',
    }[source] || '';
  }

  function tagsInput(t) {
    const input = mk('input.cell-input', { value: (t.tags || []).join(', '), list: 'buchungen-tags', placeholder: 'Tags' });
    const save = () => updateTransaktion(t.id, { tags: input.value });
    input.addEventListener('change', save);
    input.addEventListener('blur', save);
    return input;
  }

  function detailCategoryInput(parent, item, refresh) {
    const select = mk('select.cell-input', {}, kategorieOptions(item.kategorie));
    select.addEventListener('change', () => {
      updateDetailPosition(parent, item.id, { kategorie: select.value, unterkategorie: '', kategorieQuelle: 'manuell' });
      refresh();
    });
    return select;
  }

  function detailUnterkategorieInput(parent, item) {
    if (!item.kategorie) return mk('span.muted', { text: 'erst Kategorie wählen' });
    const unterkategorien = unterkategorienFuer(item.kategorie);
    if (!unterkategorien.length) return mk('span.muted', { text: 'keine angelegt' });
    const select = mk('select.cell-input', {}, unterkategorieOptions(item.kategorie, item.unterkategorie));
    select.addEventListener('change', () => {
      updateDetailPosition(parent, item.id, { unterkategorie: select.value });
    });
    return select;
  }

  function detailTagsInput(parent, item) {
    const input = mk('input.cell-input', { value: (item.tags || []).join(', '), list: 'buchungen-tags', placeholder: 'Tags' });
    const save = () => updateDetailPosition(parent, item.id, { tags: input.value });
    input.addEventListener('change', save);
    input.addEventListener('blur', save);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        save();
        input.blur();
      }
    });
    return input;
  }

  function updateDetailPosition(parent, itemId, patch) {
    updateTransaktion(parent.id, {
      detailPositionen: (parent.detailPositionen || []).map(item => (
        item.id === itemId ? { ...item, ...patch } : item
      )),
    });
  }

  function wrap(label, input) {
    return mk('div.field', {}, [mk('label', { text: label }), input]);
  }

  window.renderBuchungen = renderBuchungen;
})();
