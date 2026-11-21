(function () {
  'use strict';

  function renderSparziele(root) {
    const state = getState();

    root.appendChild(mk('h1', { text: 'Sparziele' }));
    root.appendChild(mk('div.sub', { text: 'Zielbeträge, aktueller Stand und Fortschritt.' }));
    root.appendChild(buildForm());

    if (!state.sparziele.length) {
      root.appendChild(mk('div.card', {}, [mk('div.empty', { text: 'Noch keine Sparziele angelegt.' })]));
      return;
    }

    root.appendChild(mk('div.grid.cols-2', {}, state.sparziele.map(buildSparzielCard)));
  }

  function buildForm() {
    const name = mk('input', { placeholder: 'Name' });
    const zielbetrag = mk('input', { type: 'number', step: '0.01', min: '0', placeholder: 'Zielbetrag €' });
    const aktuellerBetrag = mk('input', { type: 'number', step: '0.01', min: '0', placeholder: 'Aktuell €', value: '0' });
    const zieldatum = mk('input', { type: 'date' });
    const notiz = mk('input', { placeholder: 'Notiz' });

    const submit = btn('Sparziel anlegen', () => {
      if (!name.value.trim()) return;
      addSparziel({
        name: name.value.trim(),
        zielbetrag: parseFloat(zielbetrag.value) || 0,
        aktuellerBetrag: parseFloat(aktuellerBetrag.value) || 0,
        zieldatum: zieldatum.value,
        notiz: notiz.value.trim(),
      });
      rerender();
    });

    return mk('div.card', {}, [
      mk('h2', { text: 'Neues Sparziel' }),
      mk('div.row', {}, [
        wrap('Name', name),
        wrap('Zielbetrag', zielbetrag),
        wrap('Aktuell', aktuellerBetrag),
        wrap('Zieldatum', zieldatum),
        wrap('Notiz', notiz),
        submit,
      ]),
    ]);
  }

  function buildSparzielCard(s) {
    const ratio = s.zielbetrag > 0 ? Math.min(s.aktuellerBetrag / s.zielbetrag, 1) : 0;
    const addAmount = mk('input', { type: 'number', step: '0.01', min: '0', placeholder: 'Betrag €' });

    return mk('div.card', {}, [
      mk('div.flex-between', {}, [
        mk('h2', { text: s.name }),
        btn('Löschen', () => { if (confirm('Sparziel löschen?')) { deleteSparziel(s.id); rerender(); } }, 'sm danger'),
      ]),
      s.notiz ? mk('div.sub', { text: s.notiz }) : null,
      mk('div.stat-label', { text: `${euro(s.aktuellerBetrag)} von ${euro(s.zielbetrag)}${s.zieldatum ? ' bis ' + fmtDate(s.zieldatum) : ''}` }),
      mk('div.progress', {}, [mk('div.progress-bar', { style: `width:${Math.round(ratio * 100)}%` })]),
      mk('div.row', { style: 'margin-top:10px' }, [
        wrap('Einzahlung', addAmount),
        btn('Hinzufügen', () => {
          const value = parseFloat(addAmount.value);
          if (!Number.isFinite(value) || value <= 0) return;
          updateSparziel(s.id, { aktuellerBetrag: (s.aktuellerBetrag || 0) + value });
          rerender();
        }, 'sm'),
      ]),
    ]);
  }

  function wrap(label, input) {
    return mk('div.field', {}, [mk('label', { text: label }), input]);
  }

  window.renderSparziele = renderSparziele;
})();
