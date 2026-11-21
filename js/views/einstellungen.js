(function () {
  'use strict';

  const TAB_KEY = 'finanztool_einstellungen_tab';
  const EINSTELLUNGEN_TABS = [
    ['konten', 'Konten'],
    ['kategorien', 'Kategorien'],
    ['regeln', 'Regeln & Empfänger'],
    ['daten', 'Daten'],
  ];

  function ladeTab() {
    try {
      const key = localStorage.getItem(TAB_KEY);
      return EINSTELLUNGEN_TABS.some(([k]) => k === key) ? key : 'konten';
    } catch (e) { return 'konten'; }
  }

  function renderEinstellungen(root) {
    const aktiv = ladeTab();

    root.appendChild(mk('h1', { text: 'Einstellungen' }));
    root.appendChild(mk('div.sub', { text: 'Konten, Kategorien, Regeln, Datensicherung und lokaler Reset.' }));
    root.appendChild(mk('div.row', { style: 'margin:16px 0' }, EINSTELLUNGEN_TABS.map(([key, label]) => (
      btn(label, () => {
        try { localStorage.setItem(TAB_KEY, key); } catch (e) { /* ohne Speicher nicht merken */ }
        rerender();
      }, aktiv === key ? 'sm' : 'sm sec')
    ))));

    const tabs = {
      konten: () => {
        root.appendChild(buildKonten());
        renderKontenZeitleiste(root);
      },
      kategorien: () => { root.appendChild(buildKategorienBaum()); root.appendChild(buildKategorienBaum(true)); },
      regeln: () => {
        root.appendChild(buildAutomatisierungsregeln());
        root.appendChild(collapsibleCard('Empfänger zusammenführen', buildEmpfaengerZusammenfuehren));
      },
      daten: () => buildDatenTab(root),
    };
    tabs[aktiv]();
  }

  function buildDatenTab(root) {
    const exportBox = mk('textarea', { rows: '12', style: 'width:100%' });
    exportBox.value = JSON.stringify(getState(), null, 2);

    const importBox = mk('textarea', { rows: '12', style: 'width:100%', placeholder: 'JSON-Daten hier einfügen' });

    root.appendChild(mk('div.grid.cols-2', {}, [
      mk('div.card', {}, [
        mk('h2', { text: 'Export' }),
        exportBox,
      ]),
      mk('div.card', {}, [
        mk('h2', { text: 'Import' }),
        importBox,
        mk('div.row', { style: 'margin-top:10px' }, [
          btn('JSON importieren', () => {
            try {
              replaceState(JSON.parse(importBox.value));
              rerender();
            } catch (e) {
              alert('Die JSON-Daten konnten nicht gelesen werden.');
            }
          }),
        ]),
      ]),
    ]));

    root.appendChild(mk('div.card', {}, [
      mk('h2', { text: 'Daten zurücksetzen' }),
      mk('div.sub', { text: 'Löscht alle lokal gespeicherten Finanzdaten in diesem Browser.' }),
      btn('Alle Daten löschen', () => {
        if (confirm('Alle lokalen Daten wirklich löschen?')) {
          resetState();
          rerender();
        }
      }, 'danger'),
    ]));
  }

  function buildAutomatisierungsregeln() {
    const empfaenger = mk('input', { placeholder: 'z.B. Rewe' });
    const stichwort = mk('input', { placeholder: 'z.B. Netflix' });
    const betragVon = mk('input', { type: 'number', step: '0.01', placeholder: 'z.B. -50' });
    const betragBis = mk('input', { type: 'number', step: '0.01', placeholder: 'z.B. -20' });
    const kategorie = mk('select', {}, kategorieSelectOptions(privateKategorien(), ''));
    const unterkategorie = mk('select', {}, unterkategorieSelectOptions('', ''));
    const tags = mk('input', { placeholder: 'z.B. wichtig, geschäftlich' });
    const status = mk('div');
    const listHost = mk('div');

    kategorie.addEventListener('change', () => {
      unterkategorie.replaceChildren(...unterkategorieSelectOptions(kategorie.value, ''));
    });

    const renderListe = () => {
      const regeln = getState().regeln;
      listHost.replaceChildren(
        regeln.length
          ? mk('div.table-wrap', {}, [
              mk('table', {}, [
                mk('tr', {}, [mk('th', { text: 'Bedingung' }), mk('th', { text: 'Kategorie' }), mk('th', { text: 'Unterkategorie' }), mk('th', { text: 'Tags' }), mk('th', { text: '' })]),
                ...regeln.map(r => regelRow(r, renderListe)),
              ]),
            ])
          : mk('div.empty', { text: 'Noch keine Automatisierungsregeln angelegt.' })
      );
    };
    renderListe();

    return mk('div.card', {}, [
      mk('h2', { text: 'Weitere Automatisierungsregeln' }),
      mk('div.sub', { text: 'Kategorie, Unterkategorie und Tags nach Empfänger, Stichwort in der Beschreibung oder Betrag automatisch zuweisen. Mindestens eins der drei Felder Empfänger/Stichwort/Betrag angeben — alle angegebenen Bedingungen müssen zutreffen.' }),
      mk('div.row', {}, [
        wrap('Empfänger', empfaenger),
        wrap('Stichwort in Beschreibung', stichwort),
        wrap('Betrag von', betragVon),
        wrap('Betrag bis', betragBis),
        wrap('Kategorie', kategorie),
        wrap('Unterkategorie', unterkategorie),
        wrap('Tags', tags),
        btn('Regel anlegen', () => {
          const regel = addRegel({
            empfaenger: empfaenger.value,
            stichwort: stichwort.value,
            betragVon: betragVon.value,
            betragBis: betragBis.value,
            kategorie: kategorie.value,
            unterkategorie: unterkategorie.value,
            tags: tags.value,
          });
          if (!regel) {
            status.replaceChildren(mk('span.badge.warn', { text: 'Bitte mindestens Empfänger, Stichwort oder Betrag angeben.' }));
            return;
          }
          empfaenger.value = '';
          stichwort.value = '';
          betragVon.value = '';
          betragBis.value = '';
          tags.value = '';
          status.replaceChildren();
          renderListe();
        }, 'sm'),
      ]),
      status,
      mk('div.row', { style: 'margin-top:10px' }, [
        btn('Regeln auf Buchungen anwenden', () => {
          applyRegelnToTransactions();
          rerender();
        }, 'sec'),
      ]),
      listHost,
    ]);
  }

  function unterkategorieSelectOptions(kategorie, currentValue) {
    const unterkategorien = kategorie ? unterkategorienFuer(kategorie) : [];
    return [
      mk('option', { value: '', text: '(keine)', selected: !currentValue }),
      ...unterkategorien.map(u => mk('option', { value: u, text: u, selected: currentValue === u })),
    ];
  }

  // Kategorie/Unterkategorie/Tags einer bestehenden Regel direkt in der
  // Tabelle änderbar, statt sie löschen und komplett neu anlegen zu müssen.
  function regelRow(r, refresh) {
    const kategorie = mk('select', { style: 'min-width:150px' }, kategorieSelectOptions(privateKategorien(), r.kategorie));
    const unterkategorie = mk('select', { style: 'min-width:140px' }, unterkategorieSelectOptions(r.kategorie, r.unterkategorie));
    const tags = mk('input', { value: (r.tags || []).join(', '), style: 'min-width:130px' });

    kategorie.addEventListener('change', () => {
      unterkategorie.replaceChildren(...unterkategorieSelectOptions(kategorie.value, ''));
    });

    const speichern = () => {
      updateRegel(r.id, { kategorie: kategorie.value, unterkategorie: unterkategorie.value, tags: tags.value });
      refresh();
    };
    kategorie.addEventListener('change', speichern);
    unterkategorie.addEventListener('change', speichern);
    tags.addEventListener('change', speichern);
    tags.addEventListener('blur', speichern);

    return mk('tr', {}, [
      mk('td', { text: bedingungText(r) }),
      mk('td', {}, [kategorie]),
      mk('td', {}, [unterkategorie]),
      mk('td', {}, [tags]),
      mk('td', {}, [btn('Löschen', () => { deleteRegel(r.id); refresh(); }, 'sm danger')]),
    ]);
  }

  function bedingungText(r) {
    const parts = [];
    if (r.empfaenger) parts.push(`Empfänger "${r.empfaenger}"`);
    if (r.stichwort) parts.push(`Stichwort "${r.stichwort}"`);
    if (r.betragVon !== null || r.betragBis !== null) {
      const von = r.betragVon !== null ? euro(r.betragVon) : '…';
      const bis = r.betragBis !== null ? euro(r.betragBis) : '…';
      parts.push(`Betrag ${von} bis ${bis}`);
    }
    return parts.join(' UND ') || '–';
  }

  // Kategorien und Unterkategorien in einem Baum statt zwei getrennten
  // Tabellen: pro Kategorie direkt sichtbar, welche Unterkategorien
  // dazugehören, und dort auch anlegbar/löschbar.
  // miet = true: eigener Baum für die Kategorien der Mietkonten.
  function buildKategorienBaum(miet = false) {
    const name = mk('input', { placeholder: miet ? 'Neue Miet-Kategorie' : 'Neue Kategorie' });
    const treeHost = mk('div.kategorie-tree');
    const meldung = mk('div.sub');

    const renderTree = () => {
      const state = getState();
      const kategorien = miet ? mietKategorienListe() : privateKategorien();
      treeHost.replaceChildren(
        kategorien.length
          ? mk('div', {}, kategorien.map(k => kategorieNode(k, state.unterkategorien.filter(u => u.kategorie === k), renderTree)))
          : mk('div.empty', { text: miet ? 'Noch keine Miet-Kategorien angelegt.' : 'Noch keine Kategorien angelegt.' })
      );
    };
    renderTree();

    const anlegen = () => {
      if (!name.value.trim()) return;
      meldung.textContent = '';
      if (miet) {
        if (addMietKategorie(name.value) === null) {
          meldung.textContent = `„${name.value.trim()}“ gibt es schon als private Kategorie. Bitte einen anderen Namen wählen, z.B. „${name.value.trim()} Wohnung“.`;
          return;
        }
      } else if (istMietKategorie(name.value)) {
        meldung.textContent = `„${name.value.trim()}“ gibt es schon als Miet-Kategorie.`;
        return;
      } else {
        addKategorie(name.value);
      }
      name.value = '';
      renderTree();
    };
    name.addEventListener('keydown', event => { if (event.key === 'Enter') anlegen(); });

    return mk('div.card', { style: miet ? 'margin-top:16px' : null }, [
      mk('h2', { text: miet ? 'Kategorien für Mietkonten' : 'Kategorien & Unterkategorien' }),
      mk('div.sub', {
        text: miet
          ? 'Gelten nur für Buchungen auf Konten mit dem Typ „Mietkonto“, z.B. Hausgeld, Grundsteuer, Reparaturen. Dort stehen nur diese Kategorien zur Auswahl.'
          : 'Feste Liste, aus der du überall auswählst — verhindert unterschiedliche Schreibweisen. Unterkategorien gehören direkt zu ihrer Kategorie, z.B. Lebensmittel → Restaurant/Supermarkt. Gilt für alle Konten außer Mietkonten.',
      }),
      mk('div.row', {}, [
        wrap(miet ? 'Neue Miet-Kategorie' : 'Neue Kategorie', name),
        btn('Anlegen', anlegen, 'sm'),
      ]),
      meldung,
      treeHost,
    ]);
  }

  function kategorieNode(kategorie, unterkategorien, refresh) {
    const name = mk('input', { placeholder: 'Neue Unterkategorie' });
    const addUnter = () => {
      if (!name.value.trim()) return;
      addUnterkategorie(kategorie, name.value);
      name.value = '';
      refresh();
    };
    name.addEventListener('keydown', event => { if (event.key === 'Enter') addUnter(); });

    return mk('div.kategorie-node', {}, [
      mk('div.flex-between', {}, [
        mk('strong', { text: kategorie }),
        btn('Löschen', () => {
          if (confirm(`Kategorie "${kategorie}" löschen? Buchungen mit dieser Kategorie werden auf "Ohne Kategorie" zurückgesetzt.`)) {
            deleteKategorie(kategorie);
            refresh();
          }
        }, 'sm danger'),
      ]),
      mk('div.unterkategorie-list', {}, [
        ...unterkategorien.map(u => mk('div.unterkategorie-row', {}, [
          mk('span', { text: u.name }),
          btn('Löschen', () => { deleteUnterkategorie(u.id); refresh(); }, 'sm danger'),
        ])),
        mk('div.unterkategorie-row', {}, [
          name,
          btn('+ Hinzufügen', addUnter, 'sm sec'),
        ]),
      ]),
    ]);
  }

  function buildKonten() {
    const wrapper = mk('div');
    wrapper.appendChild(mk('h2', { text: 'Konten', style: 'margin-bottom:12px' }));
    renderKonten(wrapper, { embedded: true });
    return wrapper;
  }

  // Standardmäßig zugeklappte Karte — Inhalt wird erst beim ersten Öffnen
  // gebaut, damit selten genutzte Bereiche die Seite nicht dauerhaft
  // aufblähen.
  function collapsibleCard(title, contentBuilder) {
    const body = mk('div', { style: 'display:none; margin-top:12px' });
    const toggle = mk('span', { text: '▸', style: 'display:inline-block; margin-right:8px; transition:transform .15s;' });
    let built = false;
    const header = mk('div.flex-between', { style: 'cursor:pointer' }, [
      mk('h2', { style: 'margin-bottom:0' }, [toggle, document.createTextNode(title)]),
    ]);
    header.addEventListener('click', () => {
      const opening = body.style.display === 'none';
      body.style.display = opening ? '' : 'none';
      toggle.style.transform = opening ? 'rotate(90deg)' : '';
      if (opening && !built) {
        built = true;
        body.appendChild(contentBuilder());
      }
    });
    return mk('div.card', {}, [header, body]);
  }

  // Fasst Schreibweise-Varianten desselben Empfängers (z.B. leicht
  // unterschiedliche Bank-Exporte) zu einem einheitlichen Namen zusammen —
  // wirkt sofort auf bestehende Buchungen und merkt sich die Varianten als
  // Alias für künftige Importe.
  function buildEmpfaengerZusammenfuehren() {
    const suche = mk('input', { type: 'search', placeholder: 'Empfänger suchen' });
    const kanonisch = mk('input', { placeholder: 'Einheitlicher Name' });
    const status = mk('div');
    const listHost = mk('div', { style: 'max-height:220px; overflow-y:auto; margin-top:8px' });
    const aliasHost = mk('div', { style: 'margin-top:16px' });
    const selected = new Set();

    const alleEmpfaenger = () => {
      const namen = new Set(
        getState().transaktionen.map(t => (t.empfaenger || '').trim()).filter(Boolean)
      );
      return [...namen].sort((a, b) => a.localeCompare(b, 'de'));
    };

    const renderListe = () => {
      const query = suche.value.trim().toLowerCase();
      const namen = alleEmpfaenger().filter(n => !query || n.toLowerCase().includes(query));
      listHost.replaceChildren(
        namen.length
          ? mk('div', {}, namen.map(name => {
              const cb = mk('input', { type: 'checkbox', checked: selected.has(name) });
              cb.addEventListener('change', () => {
                if (cb.checked) selected.add(name); else selected.delete(name);
              });
              return mk('label.inline-check', { style: 'display:flex' }, [cb, document.createTextNode(' ' + name)]);
            }))
          : mk('div.empty', { text: 'Keine Empfänger gefunden.' })
      );
    };
    renderListe();
    suche.addEventListener('input', renderListe);

    const renderAliase = () => {
      const aliase = getState().empfaengerAliase;
      aliasHost.replaceChildren(
        aliase.length
          ? mk('div.table-wrap', {}, [
              mk('table', {}, [
                mk('tr', {}, [mk('th', { text: 'Variante' }), mk('th', { text: 'Einheitlicher Name' }), mk('th', { text: '' })]),
                ...aliase.map(a => mk('tr', {}, [
                  mk('td', { text: a.alias }),
                  mk('td', { text: a.kanonisch }),
                  mk('td', {}, [btn('Löschen', () => { deleteEmpfaengerAlias(a.id); renderAliase(); }, 'sm danger')]),
                ])),
              ]),
            ])
          : mk('div.empty', { text: 'Noch keine Empfänger zusammengeführt.' })
      );
    };
    renderAliase();

    return mk('div', {}, [
      mk('div.sub', { text: 'Wähle mehrere Schreibweisen desselben Empfängers aus und gib einen einheitlichen Namen vor. Gilt für bestehende Buchungen und wird für künftige Importe gemerkt.' }),
      wrap('Suche', suche),
      listHost,
      mk('div.row', { style: 'margin-top:12px' }, [
        wrap('Einheitlicher Name', kanonisch),
        btn('Zusammenführen', () => {
          if (selected.size < 2) {
            status.replaceChildren(mk('span.badge.warn', { text: 'Mindestens zwei Empfänger auswählen.' }));
            return;
          }
          if (!kanonisch.value.trim()) {
            status.replaceChildren(mk('span.badge.warn', { text: 'Bitte einheitlichen Namen angeben.' }));
            return;
          }
          const result = mergeEmpfaenger([...selected], kanonisch.value);
          selected.clear();
          kanonisch.value = '';
          status.replaceChildren(mk('span.badge.ok', { text: `${result.changedCount} Buchung(en) angepasst.` }));
          renderListe();
          renderAliase();
        }, 'sm'),
      ]),
      status,
      aliasHost,
    ]);
  }

  function kategorieSelectOptions(kategorien, currentValue) {
    const options = !currentValue || kategorien.includes(currentValue) ? kategorien : [currentValue, ...kategorien];
    return [
      mk('option', { value: '', text: '(keine Kategorie)', selected: !currentValue }),
      ...options.map(k => mk('option', { value: k, text: k, selected: currentValue === k })),
    ];
  }

  function wrap(label, input) {
    return mk('div.field', {}, [mk('label', { text: label }), input]);
  }

  window.renderEinstellungen = renderEinstellungen;
})();
