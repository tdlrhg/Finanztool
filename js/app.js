(function () {
  'use strict';

  const ROUTES = [
    { hash: '#dashboard', label: 'Übersicht', icon: '⌂', render: renderDashboard },
    { hash: '#buchungen', label: 'Buchungen', icon: '\u{1F4CB}', render: renderBuchungen },
    { hash: '#miete', label: 'Mietverwaltung', icon: '\u{1F3E0}', render: renderMiete },
    { hash: '#auswertung', label: 'Auswertung', icon: '\u{1F4C8}', render: renderAuswertung },
    { hash: '#import', label: 'Import', icon: '⬇', render: renderImport },
    { hash: '#einstellungen', label: 'Einstellungen', icon: '⚙', render: renderEinstellungen },
  ];

  const sidebar = document.getElementById('sidebar');
  const content = document.getElementById('content');

  function rerender() {
    route();
  }

  function renderSidebar() {
    clear(sidebar);
    const current = location.hash || ROUTES[0].hash;
    ROUTES.forEach(r => {
      sidebar.appendChild(mk(`a.sb-item${current === r.hash ? '.active' : ''}`, { href: r.hash }, [
        mk('span.sb-icon', { text: r.icon }),
        mk('span', { text: r.label }),
      ]));
    });
  }

  function route() {
    const hash = location.hash || ROUTES[0].hash;
    const match = ROUTES.find(r => r.hash === hash) || ROUTES[0];
    renderSidebar();
    clear(content);
    content.dataset.appStarted = 'true';
    match.render(content);
  }

  window.addEventListener('hashchange', route);
  window.addEventListener('DOMContentLoaded', () => {
    if (!location.hash) location.hash = ROUTES[0].hash;
    route();
  });

  window.rerender = rerender;
})();
