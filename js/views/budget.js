(function () {
  'use strict';

  function renderBudget(root) {
    const state = getState();
    const currentMonth = monthKey();

    root.appendChild(mk('h1', { text: 'Budget' }));
    root.appendChild(mk('div.sub', { text: `Monatliche Limits und Verbrauch für ${currentMonth}.` }));
    root.appendChild(buildForm());

    if (!state.budgets.length) {
      root.appendChild(mk('div.card', {}, [mk('div.empty', { text: 'Noch keine Budgets angelegt.' })]));
      return;
    }

    root.appendChild(mk('div.card', {}, [
      mk('h2', { text: 'Budgetübersicht' }),
      mk('table', {}, [
        mk('tr', {}, [
          mk('th', { text: 'Kategorie' }),
          mk('th', { text: 'Limit' }),
          mk('th', { text: 'Verbraucht' }),
          mk('th', { text: 'Fortschritt' }),
          mk('th', { text: '' }),
        ]),
        ...state.budgets.map(b => budgetRow(b, state.transaktionen, currentMonth)),
      ]),
    ]));
  }

  function buildForm() {
    const kategorie = mk('input', { placeholder: 'Kategorie' });
    const limit = mk('input', { type: 'number', step: '0.01', min: '0', placeholder: 'Monatslimit €' });

    const submit = btn('Budget speichern', () => {
      const name = kategorie.value.trim();
      const value = parseFloat(limit.value);
      if (!name || !Number.isFinite(value)) return;
      upsertBudget(name, value);
      rerender();
    });

    return mk('div.card', {}, [
      mk('h2', { text: 'Neues Budget' }),
      mk('div.row', {}, [wrap('Kategorie', kategorie), wrap('Limit', limit), submit]),
    ]);
  }

  function budgetRow(budget, transaktionen, currentMonth) {
    const verbraucht = Math.abs(transaktionen
      .filter(t => !istTransfer(t) && t.kategorie === budget.kategorie && monthKey(t.datum) === currentMonth && t.betrag < 0)
      .reduce((sum, t) => sum + t.betrag, 0));
    const ratio = budget.limit > 0 ? Math.min(verbraucht / budget.limit, 1) : 0;
    const over = verbraucht > budget.limit && budget.limit > 0;

    return mk('tr', {}, [
      mk('td', { text: budget.kategorie }),
      mk('td.num', { text: euro(budget.limit) }),
      mk('td.num', { text: euro(verbraucht) }),
      mk('td', {}, [
        mk('div.progress', {}, [mk(`div.progress-bar${over ? '.over' : ''}`, { style: `width:${Math.round(ratio * 100)}%` })]),
        mk('span.muted', { text: `${Math.round((budget.limit > 0 ? verbraucht / budget.limit : 0) * 100)}%` }),
      ]),
      mk('td', {}, [btn('Löschen', () => { deleteBudget(budget.id); rerender(); }, 'sm danger')]),
    ]);
  }

  function wrap(label, input) {
    return mk('div.field', {}, [mk('label', { text: label }), input]);
  }

  window.renderBudget = renderBudget;
})();
