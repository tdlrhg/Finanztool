(function () {
  'use strict';

  const STORAGE_KEY = 'finanztool_data_v1';

  function defaultState() {
    return {
      konten: [],       // {id, name, typ: 'giro'|'kreditkarte'|'paypal'|'spar'|'miete', startsaldo, farbe}
      transaktionen: [], // {id, datum, betrag, buchungstyp, gegenkontoId, kategorie, kategorieQuelle, tags, detailPositionen, kontoId, empfaenger, beschreibung, mietobjektId}
      regeln: [],        // {id, empfaenger, stichwort, betragVon, betragBis, kategorie, tags} – erweiterte Automatisierungsregeln
      budgets: [],       // {id, kategorie, limit}
      sparziele: [],     // {id, name, zielbetrag, aktuellerBetrag, zieldatum, notiz}
      mietobjekte: [],   // {id, name, mieterName, sollMiete, kontoId, beginn, notizen} – altes Modell, wird nicht mehr angezeigt
      wohnungen: [],     // {id, name, flaeche, mea, selbstgenutzt}
      eigentuemerabrechnungen: [], // {id, wohnungId, jahr: 'YYYY', summeLautAbrechnung, positionen: [{id, nr, bezeichnung, schluessel, betrag, umlagefaehig}], eigeneKosten: [{id, bezeichnung, betrag, umlagefaehig, buchungIds: []}], heizkosten: [{id, nutzer: mvId|'leerstand', gesamt, co2Vermieter}]}
      mietverhaeltnisse: [], // {id, wohnungId, mieter, von: 'YYYY-MM', bis: 'YYYY-MM'|'', kaltmiete, kaltmieteAenderungen: [{ab: 'YYYY-MM', betrag}], vorauszahlung, zahlerNamen: []}
      kategorien: [],    // verwaltete Liste der Kategorienamen
      mietKategorien: [], // Teilmenge von kategorien, die nur für Buchungen auf Mietkonten gilt
      mietKategorienBereinigt: false, // einmalige Bereinigung alter Kategorien auf Mietkonten erledigt
      unterkategorien: [], // {id, kategorie, name} – hängen jeweils an einer Kategorie
      empfaengerAliase: [], // {id, alias, kanonisch} – Schreibweise-Varianten (z.B. verschiedener Bank-Exporte) auf einen Namen zusammengeführt
      einnahmenZeilen: [], // {id, label, kategorie, unterkategorie, empfaenger} – frei konfigurierte Zeilen für die Einnahmen-Tabelle
      erstattungen: [], // {id, ziel, kategorie, unterkategorie, empfaenger, tag} – Einnahmen, die gegen eine Ausgabenkategorie gerechnet werden
      ausgabenZeilen: [], // wie einnahmenZeilen, für die Ausgaben-Tabelle
      ausgabenSonstigeDeaktiviert: false,
      einnahmenSonstigeDeaktiviert: false, // "Sonstige Einnahmen"-Zeile aus der Summe ausblenden
    };
  }

  // Zwei Schritte statt "let state = load();": load() ruft intern
  // canonicalKategorie/canonicalUnterkategorie auf, die das äußere `state`
  // lesen — solange die let-Deklaration noch läuft, ist `state` im TDZ und
  // jeder Zugriff wirft "Cannot access 'state' before initialization".
  let state = defaultState();
  state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return normalizeState({ ...defaultState(), ...parsed });
    } catch (e) {
      console.error('Konnte gespeicherte Daten nicht laden, starte mit leerem Stand.', e);
      return defaultState();
    }
  }

  function normalizeState(data) {
    const normalized = { ...defaultState(), ...data };
    normalized.konten = Array.isArray(normalized.konten) ? normalized.konten : [];
    normalized.transaktionen = Array.isArray(normalized.transaktionen)
      ? normalized.transaktionen.map(t => ({
          empfaenger: '',
          beschreibung: '',
          buchungstyp: 'buchung',
          gegenkontoId: '',
          kategorieQuelle: t.kategorie ? 'csv' : '',
          tags: [],
          unterkategorie: '',
          detailPositionen: [],
          ausAuswertung: false,
          mietZuordnung: '',
          mietNkJahr: '',
          ...t,
          tags: normalizeTags(t.tags),
          detailPositionen: normalizeDetailPositionen(t.detailPositionen),
        }))
      : [];
    normalized.budgets = Array.isArray(normalized.budgets) ? normalized.budgets : [];
    normalized.sparziele = Array.isArray(normalized.sparziele) ? normalized.sparziele : [];
    normalized.mietobjekte = Array.isArray(normalized.mietobjekte) ? normalized.mietobjekte : [];
    normalized.wohnungen = Array.isArray(normalized.wohnungen) ? normalized.wohnungen : [];
    normalized.eigentuemerabrechnungen = Array.isArray(normalized.eigentuemerabrechnungen)
      ? normalized.eigentuemerabrechnungen.map(ea => ({
          summeLautAbrechnung: null, ...ea,
          positionen: Array.isArray(ea.positionen) ? ea.positionen : [],
          eigeneKosten: Array.isArray(ea.eigeneKosten) ? ea.eigeneKosten.map(k => ({ ...k, buchungIds: Array.isArray(k.buchungIds) ? k.buchungIds : [] })) : [],
          heizkosten: Array.isArray(ea.heizkosten) ? ea.heizkosten : [],
        }))
      : [];
    normalized.mietverhaeltnisse = Array.isArray(normalized.mietverhaeltnisse)
      ? normalized.mietverhaeltnisse.map(mv => ({
          mieter: '', von: '', bis: '', kaltmiete: 0, vorauszahlung: 0, ...mv,
          zahlerNamen: Array.isArray(mv.zahlerNamen) ? mv.zahlerNamen : [],
          kaltmieteAenderungen: Array.isArray(mv.kaltmieteAenderungen) ? mv.kaltmieteAenderungen : [],
        }))
      : [];
    // Alte "Empfänger-Kategorien" (vor der Umstellung auf Automatisierungsregeln)
    // nur noch lokal für die Migration unten verwenden — der Zustand selbst
    // behält dieses Feld nicht mehr (auch die "Detailimport nötig"-Markierung
    // ist inzwischen entfernt, die dort ebenfalls drin steckte).
    const alteEmpfaengerRegelnRoh = (Array.isArray(data.empfaengerRegeln) ? data.empfaengerRegeln : [])
      .map(r => ({ typ: r.kategorie ? 'kategorie' : 'detailimport', ...r }));
    normalized.regeln = Array.isArray(normalized.regeln) ? normalized.regeln : [];
    normalized.regeln = normalized.regeln.map(r => ({
      empfaenger: '', stichwort: '', betragVon: null, betragBis: null, tags: [], unterkategorie: '',
      ...r,
      tags: normalizeTags(r.tags),
    }));
    normalized.unterkategorien = Array.isArray(normalized.unterkategorien) ? normalized.unterkategorien : [];
    normalized.empfaengerAliase = Array.isArray(normalized.empfaengerAliase) ? normalized.empfaengerAliase : [];
    normalized.einnahmenZeilen = Array.isArray(normalized.einnahmenZeilen) ? normalized.einnahmenZeilen : [];
    normalized.einnahmenSonstigeDeaktiviert = !!normalized.einnahmenSonstigeDeaktiviert;
    normalized.erstattungen = Array.isArray(normalized.erstattungen) ? normalized.erstattungen : [];
    normalized.ausgabenZeilen = Array.isArray(normalized.ausgabenZeilen) ? normalized.ausgabenZeilen : [];
    normalized.ausgabenSonstigeDeaktiviert = !!normalized.ausgabenSonstigeDeaktiviert;
    normalized.kategorien = Array.isArray(normalized.kategorien) ? normalized.kategorien : [];
    normalized.mietKategorien = Array.isArray(normalized.mietKategorien) ? normalized.mietKategorien : [];
    // Einmalig: Buchungen auf Mietkonten verlieren ihre bisherigen (privaten)
    // Kategorien, damit sie mit den neuen Miet-Kategorien neu zugeordnet
    // werden können.
    if (!normalized.mietKategorienBereinigt) {
      const mietKontoIds = new Set(normalized.konten.filter(k => k.typ === 'miete').map(k => k.id));
      const mietKeys = new Set(normalized.mietKategorien.map(normalizeKategorieKey));
      normalized.transaktionen.forEach(t => {
        if (!mietKontoIds.has(t.kontoId)) return;
        if (t.kategorie && !mietKeys.has(normalizeKategorieKey(t.kategorie))) { t.kategorie = ''; t.unterkategorie = ''; t.kategorieQuelle = ''; }
        (t.detailPositionen || []).forEach(item => {
          if (item.kategorie && !mietKeys.has(normalizeKategorieKey(item.kategorie))) { item.kategorie = ''; item.unterkategorie = ''; item.kategorieQuelle = ''; }
        });
      });
      normalized.mietKategorienBereinigt = true;
    }
    if (!normalized.kategorien.length) {
      // Migration: verwaltete Liste aus bereits vorhandenen Kategorien befüllen
      const seen = new Set();
      const vorhandene = [
        ...normalized.transaktionen.map(t => t.kategorie),
        ...normalized.transaktionen.flatMap(t => (t.detailPositionen || []).map(item => item.kategorie)),
        ...normalized.budgets.map(b => b.kategorie),
        ...alteEmpfaengerRegelnRoh.map(r => r.kategorie),
      ];
      vorhandene.forEach(k => {
        if (!k) return;
        const key = k.trim().toLowerCase().replace(/\s+/g, ' ');
        if (!key || seen.has(key)) return;
        seen.add(key);
        normalized.kategorien.push(k.trim());
      });
    }
    // Migration: alte, einfache Empfänger-Kategorien-Regeln in die
    // Automatisierungsregeln überführen. Alte "Detailimport nötig"-Markierungen
    // (die andere Hälfte von alteEmpfaengerRegelnRoh) werden verworfen, das
    // Feature gibt es nicht mehr.
    const alteKategorieRegeln = alteEmpfaengerRegelnRoh.filter(r => r.typ === 'kategorie');
    alteKategorieRegeln.forEach(r => {
      if (!r.empfaenger || !r.kategorie) return;
      const key = r.empfaenger.trim().toLowerCase();
      const existsAlready = normalized.regeln.some(x => (x.empfaenger || '').trim().toLowerCase() === key && !x.stichwort && x.betragVon === null && x.betragBis === null);
      if (existsAlready) return;
      normalized.regeln.push({ id: r.id || uid(), empfaenger: r.empfaenger.trim(), stichwort: '', betragVon: null, betragBis: null, kategorie: r.kategorie, unterkategorie: '', tags: [] });
    });
    // Migration: "Import" war früher die Standardkategorie für beim Import
    // nicht zugeordnete Buchungen — das duplizierte "Ohne Kategorie" unnötig
    // (zwei getrennte Buckets für dieselbe Bedeutung). Einmalig auf echtes
    // "Ohne Kategorie" (leer) zurückstellen und aus der Liste entfernen.
    const importKey = normalizeKategorieKey('Import');
    if (normalized.kategorien.some(k => normalizeKategorieKey(k) === importKey)) {
      normalized.kategorien = normalized.kategorien.filter(k => normalizeKategorieKey(k) !== importKey);
      normalized.transaktionen.forEach(t => {
        if (normalizeKategorieKey(t.kategorie) === importKey) { t.kategorie = ''; t.kategorieQuelle = ''; t.unterkategorie = ''; }
        (t.detailPositionen || []).forEach(item => {
          if (normalizeKategorieKey(item.kategorie) === importKey) { item.kategorie = ''; item.kategorieQuelle = ''; }
        });
      });
      normalized.budgets = normalized.budgets.filter(b => normalizeKategorieKey(b.kategorie) !== importKey);
      normalized.regeln.forEach(r => { if (normalizeKategorieKey(r.kategorie) === importKey) r.kategorie = ''; });
    }
    return normalized;
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function getState() {
    return state;
  }

  function replaceState(newState) {
    state = normalizeState({ ...defaultState(), ...newState });
    save();
  }

  function resetState() {
    state = defaultState();
    save();
  }

  // ── Konten ──
  function addKonto(data) {
    const konto = { id: uid(), name: '', typ: 'giro', startsaldo: 0, farbe: '#0f766e', ...data };
    state.konten.push(konto);
    save();
    return konto;
  }
  function updateKonto(id, patch) {
    const k = state.konten.find(k => k.id === id);
    if (k) Object.assign(k, patch);
    save();
  }
  function deleteKonto(id) {
    state.konten = state.konten.filter(k => k.id !== id);
    state.transaktionen = state.transaktionen.filter(t => t.kontoId !== id);
    state.transaktionen.forEach(t => { if (t.gegenkontoId === id) t.gegenkontoId = ''; });
    save();
  }
  function kontoSaldo(id) {
    const konto = state.konten.find(k => k.id === id);
    if (!konto) return 0;
    const summe = state.transaktionen.filter(t => t.kontoId === id).reduce((s, t) => s + t.betrag, 0);
    return (konto.startsaldo || 0) + summe;
  }

  // ── Transaktionen ──
  function addTransaktion(data) {
    const t = { id: uid(), datum: todayISO(), betrag: 0, buchungstyp: 'buchung', gegenkontoId: '', kategorie: '', kategorieQuelle: '', tags: [], unterkategorie: '', detailPositionen: [], kontoId: '', empfaenger: '', beschreibung: '', mietobjektId: null, ausAuswertung: false, ...data };
    t.kategorie = canonicalKategorie(t.kategorie);
    t.unterkategorie = canonicalUnterkategorie(t.kategorie, t.unterkategorie);
    t.tags = normalizeTags(t.tags);
    t.detailPositionen = normalizeDetailPositionen(t.detailPositionen);
    passendeKategorienErzwingen(t);
    state.transaktionen.push(t);
    save();
    return t;
  }
  function updateTransaktion(id, patch) {
    const t = state.transaktionen.find(t => t.id === id);
    if (t) {
      Object.assign(t, patch, {
        ...(patch.kategorie !== undefined ? { kategorie: canonicalKategorie(patch.kategorie) } : {}),
        ...(patch.tags !== undefined ? { tags: normalizeTags(patch.tags) } : {}),
        ...(patch.detailPositionen !== undefined ? { detailPositionen: normalizeDetailPositionen(patch.detailPositionen) } : {}),
      });
      if (patch.unterkategorie !== undefined || patch.kategorie !== undefined) {
        t.unterkategorie = canonicalUnterkategorie(t.kategorie, t.unterkategorie);
      }
      // Sobald eine Buchung in Einzelpositionen aufgeteilt ist, steckt die
      // Kategorisierung in den Positionen — die Elternbuchung bräuchte sonst
      // sowohl selbst eine Kategorie als auch aufgesplittete Positionen,
      // was in der Auswertung zu doppelt gezähltem Betrag führen würde.
      if (patch.detailPositionen !== undefined && t.detailPositionen.length) {
        t.kategorie = '';
        t.kategorieQuelle = '';
        t.unterkategorie = '';
      }
      passendeKategorienErzwingen(t);
    }
    save();
  }
  function deleteTransaktion(id) {
    state.transaktionen = state.transaktionen.filter(t => t.id !== id);
    save();
  }

  // ── Miet-Kategorien ──
  // Buchungen auf Mietkonten haben nur Miet-Kategorien, alle anderen nur
  // private Kategorien. Unpassende Kategorien werden entfernt.
  function istMietKonto(kontoId) {
    return state.konten.some(k => k.id === kontoId && k.typ === 'miete');
  }
  function istMietKategorie(kategorie) {
    const key = normalizeKategorieKey(kategorie);
    return !!key && state.mietKategorien.some(k => normalizeKategorieKey(k) === key);
  }
  function privateKategorien() {
    return state.kategorien.filter(k => !istMietKategorie(k));
  }
  function mietKategorienListe() {
    return state.kategorien.filter(k => istMietKategorie(k));
  }
  function passendeKategorienErzwingen(t) {
    const miet = istMietKonto(t.kontoId);
    const passt = k => !k || istMietKategorie(k) === miet;
    if (!passt(t.kategorie)) { t.kategorie = ''; t.unterkategorie = ''; t.kategorieQuelle = ''; }
    (t.detailPositionen || []).forEach(item => {
      if (!passt(item.kategorie)) { item.kategorie = ''; item.unterkategorie = ''; item.kategorieQuelle = ''; }
    });
  }
  function addMietKategorie(name) {
    const trimmed = (name || '').trim().replace(/\s+/g, ' ');
    if (!trimmed) return '';
    const key = normalizeKategorieKey(trimmed);
    // Gleicher Name wie eine private Kategorie ist nicht möglich (eine
    // gemeinsame Namensliste); dann bewusst nichts anlegen.
    if (state.kategorien.some(k => normalizeKategorieKey(k) === key) && !istMietKategorie(trimmed)) return null;
    const kategorie = canonicalKategorie(trimmed);
    if (!istMietKategorie(kategorie)) state.mietKategorien.push(kategorie);
    save();
    return kategorie;
  }

  function istTransfer(t) {
    return t?.buchungstyp === 'transfer';
  }

  function normalizeEmpfaenger(empfaenger) {
    return (empfaenger || '').trim().toLowerCase();
  }

  // Bildet Schreibweise-Varianten (z.B. leicht unterschiedliche Bank-Exporte
  // desselben Zahlungsempfängers) auf einen einheitlichen Namen ab. Wird
  // beim Import angewendet, damit Automatisierungsregeln und Auswertungen
  // nicht durch Varianten fragmentiert werden.
  function canonicalEmpfaenger(empfaenger) {
    const trimmed = (empfaenger || '').trim();
    if (!trimmed) return trimmed;
    const key = normalizeEmpfaenger(trimmed);
    const alias = state.empfaengerAliase.find(a => normalizeEmpfaenger(a.alias) === key);
    return alias ? alias.kanonisch : trimmed;
  }

  // Führt mehrere Empfänger-Schreibweisen zu einer zusammen: registriert
  // jede Variante als Alias (wirkt ab sofort auch bei künftigen Importen)
  // und stellt alle bestehenden Buchungen mit einer dieser Schreibweisen auf
  // den einheitlichen Namen um.
  function mergeEmpfaenger(varianten, kanonisch) {
    const ziel = (kanonisch || '').trim();
    if (!ziel || !Array.isArray(varianten) || !varianten.length) return { changedCount: 0 };
    const zielKey = normalizeEmpfaenger(ziel);
    varianten.forEach(variante => {
      const key = normalizeEmpfaenger(variante);
      if (!key || key === zielKey) return;
      const bestehend = state.empfaengerAliase.find(a => normalizeEmpfaenger(a.alias) === key);
      if (bestehend) bestehend.kanonisch = ziel;
      else state.empfaengerAliase.push({ id: uid(), alias: variante.trim(), kanonisch: ziel });
    });
    const varianteKeys = new Set(varianten.map(normalizeEmpfaenger));
    let changedCount = 0;
    state.transaktionen.forEach(t => {
      if (varianteKeys.has(normalizeEmpfaenger(t.empfaenger)) && t.empfaenger !== ziel) {
        t.empfaenger = ziel;
        changedCount++;
      }
      (t.detailPositionen || []).forEach(item => {
        if (varianteKeys.has(normalizeEmpfaenger(item.empfaenger)) && item.empfaenger !== ziel) {
          item.empfaenger = ziel;
        }
      });
    });
    save();
    return { changedCount };
  }

  function deleteEmpfaengerAlias(id) {
    state.empfaengerAliase = state.empfaengerAliase.filter(a => a.id !== id);
    save();
  }

  // ── Einnahmen-Tabelle: frei definierte Zeilen (Name + Zuordnungskriterium
  // aus Kategorie/Unterkategorie/Empfänger), z.B. "Beteiligung Person A" →
  // Kategorie "Sonstige Einnahmen", Unterkategorie "Beteiligung Person A". ──
  function addEinnahmenZeile(data, art = 'einnahmen') {
    const label = (data.label || '').trim();
    const kategorie = (data.kategorie || '').trim();
    const unterkategorie = (data.unterkategorie || '').trim();
    const empfaenger = (data.empfaenger || '').trim();
    const tag = (data.tag || '').trim();
    if (!label || (!kategorie && !unterkategorie && !empfaenger && !tag)) return null;
    const zeile = { id: uid(), label, kategorie, unterkategorie, empfaenger, tag, deaktiviert: false };
    state[art + 'Zeilen'].push(zeile);
    save();
    return zeile;
  }

  function toggleEinnahmenZeile(id, art = 'einnahmen') {
    const zeile = state[art + 'Zeilen'].find(z => z.id === id);
    if (!zeile) return;
    zeile.deaktiviert = !zeile.deaktiviert;
    save();
  }

  // Erstattungen: Einnahmen (z.B. Versicherung/Beihilfe), die keine echten Einnahmen
  // sind, sondern eine Ausgabenkategorie (z.B. Gesundheit) mindern.
  function addErstattung(data) {
    const ziel = (data.ziel || '').trim();
    const kategorie = (data.kategorie || '').trim();
    const unterkategorie = (data.unterkategorie || '').trim();
    const empfaenger = (data.empfaenger || '').trim();
    const tag = (data.tag || '').trim();
    if (!ziel || (!kategorie && !unterkategorie && !empfaenger && !tag)) return null;
    const eintrag = { id: uid(), ziel, kategorie, unterkategorie, empfaenger, tag };
    state.erstattungen.push(eintrag);
    save();
    return eintrag;
  }

  function deleteErstattung(id) {
    state.erstattungen = state.erstattungen.filter(e => e.id !== id);
    save();
  }

  // Liefert die Ziel-Kategorie, wenn die Buchung eine Erstattung ist.
  function erstattungsZiel(buchung) {
    if (buchung.betrag <= 0) return null;
    const treffer = state.erstattungen.find(e => einnahmenZeileTrifftZu(e, buchung));
    return treffer ? treffer.ziel : null;
  }

  function toggleEinnahmenSonstige(art = 'einnahmen') {
    state[art + 'SonstigeDeaktiviert'] = !state[art + 'SonstigeDeaktiviert'];
    save();
  }

  function deleteEinnahmenZeile(id, art = 'einnahmen') {
    state[art + 'Zeilen'] = state[art + 'Zeilen'].filter(z => z.id !== id);
    save();
  }

  function moveEinnahmenZeile(id, richtung, art = 'einnahmen') {
    const liste = state[art + 'Zeilen'];
    const index = liste.findIndex(z => z.id === id);
    if (index < 0) return;
    const ziel = index + richtung;
    if (ziel < 0 || ziel >= liste.length) return;
    const [item] = liste.splice(index, 1);
    liste.splice(ziel, 0, item);
    save();
  }

  // Empfänger unterstützt mehrere, kommagetrennte Namen (ODER-verknüpft) —
  // z.B. "Versicherung, Beihilfe" fasst zwei unterschiedliche Absender in einer Zeile
  // zusammen, auch wenn es getrennte Buchungen sind.
  function einnahmenZeileTrifftZu(zeile, buchung) {
    if (zeile.kategorie && buchung.kategorie !== zeile.kategorie) return false;
    if (zeile.unterkategorie && buchung.unterkategorie !== zeile.unterkategorie) return false;
    if (zeile.empfaenger) {
      const namen = zeile.empfaenger.split(',').map(normalizeEmpfaenger).filter(Boolean);
      if (namen.length && !namen.includes(normalizeEmpfaenger(buchung.empfaenger))) return false;
    }
    if (zeile.tag && !(buchung.tags || []).some(t => normalizeEmpfaenger(t) === normalizeEmpfaenger(zeile.tag))) return false;
    return true;
  }

  // ── Automatisierungsregeln (Empfänger/Stichwort/Betrag → Kategorie+Tags) ──
  function addRegel(data) {
    const empfaenger = (data.empfaenger || '').trim();
    const stichwort = (data.stichwort || '').trim();
    const betragVon = toNumberOrNull(data.betragVon);
    const betragBis = toNumberOrNull(data.betragBis);
    if (!empfaenger && !stichwort && betragVon === null && betragBis === null) return null;
    const kategorie = canonicalKategorie(data.kategorie);
    // Gleiche Bedingungen wie eine bestehende Regel: ersetzen statt eine
    // zweite anzulegen, die von der ersten verdeckt würde.
    state.regeln = state.regeln.filter(r => !(
      normalizeEmpfaenger(r.empfaenger) === normalizeEmpfaenger(empfaenger)
      && (r.stichwort || '').toLowerCase() === stichwort.toLowerCase()
      && r.betragVon === betragVon && r.betragBis === betragBis
    ));
    const regel = {
      id: uid(),
      empfaenger,
      stichwort,
      betragVon,
      betragBis,
      kategorie,
      unterkategorie: canonicalUnterkategorie(kategorie, data.unterkategorie),
      tags: normalizeTags(data.tags),
    };
    state.regeln.push(regel);
    save();
    return regel;
  }

  function deleteRegel(id) {
    state.regeln = state.regeln.filter(r => r.id !== id);
    save();
  }

  function updateRegel(id, patch) {
    const r = state.regeln.find(r => r.id === id);
    if (!r) return null;
    Object.assign(r, patch);
    if (patch.kategorie !== undefined) r.kategorie = canonicalKategorie(r.kategorie);
    if (patch.unterkategorie !== undefined || patch.kategorie !== undefined) {
      r.unterkategorie = canonicalUnterkategorie(r.kategorie, r.unterkategorie);
    }
    if (patch.tags !== undefined) r.tags = normalizeTags(r.tags);
    save();
    return r;
  }

  // Legt eine einfache Empfänger→Kategorie(+Unterkategorie+Tags)-Regel an
  // oder ersetzt eine bereits vorhandene für diesen Empfänger (statt
  // Duplikate anzusammeln), und wendet sie sofort auf bestehende, nicht von
  // Hand kategorisierte Buchungen dieses Empfängers an.
  function upsertEmpfaengerAutomatisierung(empfaenger, kategorie, unterkategorie, tags) {
    const key = normalizeEmpfaenger(empfaenger);
    state.regeln = state.regeln.filter(r => !(normalizeEmpfaenger(r.empfaenger) === key && !r.stichwort && r.betragVon === null && r.betragBis === null));
    const regel = addRegel({ empfaenger, kategorie, unterkategorie, tags });
    if (regel) {
      state.transaktionen.forEach(t => {
        if (normalizeEmpfaenger(t.empfaenger) === key && t.kategorieQuelle !== 'manuell') {
          t.kategorie = regel.kategorie;
          if (regel.unterkategorie) t.unterkategorie = regel.unterkategorie;
          t.kategorieQuelle = 'regel';
          if (regel.tags.length) t.tags = [...new Set([...(t.tags || []), ...regel.tags])];
        }
      });
      save();
    }
    return regel;
  }

  function empfaengerOnlyRegel(empfaenger) {
    const key = normalizeEmpfaenger(empfaenger);
    return state.regeln.find(r => normalizeEmpfaenger(r.empfaenger) === key && !r.stichwort && r.betragVon === null && r.betragBis === null) || null;
  }

  function toNumberOrNull(value) {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function regelTrifftZu(regel, buchung) {
    if (regel.empfaenger && normalizeEmpfaenger(buchung.empfaenger) !== normalizeEmpfaenger(regel.empfaenger)) return false;
    if (regel.stichwort && !(buchung.beschreibung || '').toLowerCase().includes(regel.stichwort.toLowerCase())) return false;
    if (regel.betragVon !== null && Number(buchung.betrag) < regel.betragVon) return false;
    if (regel.betragBis !== null && Number(buchung.betrag) > regel.betragBis) return false;
    return true;
  }

  // Prüft eine Buchung (oder eine noch nicht gespeicherte, aber gleich
  // aufgebaute CSV-Zeile) gegen alle Automatisierungsregeln.
  function kategorieUndTagsFuerBuchung(buchung) {
    // Regeln gelten (vorerst) nicht für Buchungen auf Mietkonten.
    if (buchung && istMietKonto(buchung.kontoId)) return null;
    // Eine Regel ohne Kategorie (z.B. Altlast) darf eine spätere, passende
    // Regel mit Kategorie nicht verdecken.
    const treffer = state.regeln.filter(r => regelTrifftZu(r, buchung));
    const regel = treffer.find(r => r.kategorie) || treffer[0];
    return regel ? { kategorie: regel.kategorie, unterkategorie: regel.unterkategorie, tags: regel.tags } : null;
  }

  function applyRegelnToTransactions() {
    state.transaktionen.forEach(t => {
      const treffer = kategorieUndTagsFuerBuchung(t);
      if (!treffer) return;
      // "manuell" schützt nur echte Kategorien — wurde sie von Hand auf
      // "keine" gestellt, darf die Regel wieder greifen.
      const vonHand = t.kategorieQuelle === 'manuell' && t.kategorie;
      if (!vonHand && treffer.kategorie && normalizeKategorieKey(t.kategorie) !== normalizeKategorieKey(treffer.kategorie)) {
        t.kategorie = treffer.kategorie;
        t.kategorieQuelle = 'regel';
        if (treffer.unterkategorie) t.unterkategorie = treffer.unterkategorie;
      }
      if (treffer.tags.length) {
        t.tags = [...new Set([...(t.tags || []), ...treffer.tags])];
      }
    });
    save();
  }

  function normalizeKategorieKey(kategorie) {
    return (kategorie || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // Verwaltete Kategorienliste ist die Quelle der Wahrheit: matcht eine
  // Kategorie dagegen (unabhängig von Groß-/Kleinschreibung/Leerzeichen) und
  // nimmt bislang unbekannte Kategorien automatisch mit auf (z.B. beim
  // CSV-Import), damit der Import nicht durch die Liste blockiert wird.
  function canonicalKategorie(kategorie) {
    const trimmed = (kategorie || '').trim().replace(/\s+/g, ' ');
    if (!trimmed) return '';
    const key = normalizeKategorieKey(trimmed);
    const existing = state.kategorien.find(k => normalizeKategorieKey(k) === key);
    if (existing) return existing;
    state.kategorien.push(trimmed);
    return trimmed;
  }

  // Wie canonicalKategorie, registriert aber keine neue Kategorie — für
  // Fälle wie den CSV-Import, wo eine von der Bank mitgelieferte
  // Kategoriespalte (z.B. "Lebensmittel und Drogerie") nicht ungefragt zur
  // eigenen, gepflegten Kategorienliste hinzugefügt werden soll, nur weil
  // sie zufällig in der Datei steht.
  function findKategorie(kategorie) {
    const trimmed = (kategorie || '').trim();
    if (!trimmed) return '';
    const key = normalizeKategorieKey(trimmed);
    const existing = state.kategorien.find(k => normalizeKategorieKey(k) === key);
    return existing || '';
  }

  function addKategorie(name) {
    const kategorie = canonicalKategorie(name);
    save();
    return kategorie;
  }

  // Löscht eine Kategorie aus der Liste UND setzt sie bei allen bisherigen
  // Verwendungen zurück auf "ohne Kategorie", statt sie stehen zu lassen —
  // sonst wären betroffene Buchungen über den "Ohne Kategorie"-Filter nicht
  // mehr auffindbar und nicht mehr neu zuweisbar.
  function deleteKategorie(name) {
    const key = normalizeKategorieKey(name);
    state.kategorien = state.kategorien.filter(k => normalizeKategorieKey(k) !== key);
    state.mietKategorien = state.mietKategorien.filter(k => normalizeKategorieKey(k) !== key);
    state.unterkategorien = state.unterkategorien.filter(u => normalizeKategorieKey(u.kategorie) !== key);
    state.transaktionen.forEach(t => {
      if (normalizeKategorieKey(t.kategorie) === key) { t.kategorie = ''; t.kategorieQuelle = ''; t.unterkategorie = ''; }
      (t.detailPositionen || []).forEach(item => {
        if (normalizeKategorieKey(item.kategorie) === key) { item.kategorie = ''; item.kategorieQuelle = ''; }
      });
    });
    state.budgets = state.budgets.filter(b => normalizeKategorieKey(b.kategorie) !== key);
    save();
  }

  function normalizeUnterkategorieKey(name) {
    return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function unterkategorienFuer(kategorie) {
    const key = normalizeKategorieKey(kategorie);
    if (!key) return [];
    return state.unterkategorien.filter(u => normalizeKategorieKey(u.kategorie) === key).map(u => u.name);
  }

  // Wie canonicalKategorie, nur je Kategorie: nutzt eine bereits vorhandene
  // Unterkategorie weiter statt Schreibweise-Varianten anzusammeln, und
  // registriert eine neue Unterkategorie automatisch unter der Kategorie.
  function canonicalUnterkategorie(kategorie, unterkategorie) {
    const trimmed = (unterkategorie || '').trim().replace(/\s+/g, ' ');
    if (!trimmed || !kategorie) return '';
    const kategorieKey = normalizeKategorieKey(kategorie);
    const key = normalizeUnterkategorieKey(trimmed);
    const existing = state.unterkategorien.find(u => normalizeKategorieKey(u.kategorie) === kategorieKey && normalizeUnterkategorieKey(u.name) === key);
    if (existing) return existing.name;
    state.unterkategorien.push({ id: uid(), kategorie: canonicalKategorie(kategorie), name: trimmed });
    return trimmed;
  }

  function addUnterkategorie(kategorie, name) {
    const result = canonicalUnterkategorie(kategorie, name);
    save();
    return result;
  }

  function deleteUnterkategorie(id) {
    const u = state.unterkategorien.find(u => u.id === id);
    if (!u) return;
    state.unterkategorien = state.unterkategorien.filter(x => x.id !== id);
    const key = normalizeUnterkategorieKey(u.name);
    const kategorieKey = normalizeKategorieKey(u.kategorie);
    state.transaktionen.forEach(t => {
      if (normalizeKategorieKey(t.kategorie) === kategorieKey && normalizeUnterkategorieKey(t.unterkategorie) === key) {
        t.unterkategorie = '';
      }
    });
    save();
  }

  function normalizeTags(tags) {
    if (Array.isArray(tags)) return tags.map(t => String(t).trim()).filter(Boolean);
    if (typeof tags === 'string') return tags.split(/[;,]/).map(t => t.trim()).filter(Boolean);
    return [];
  }

  function normalizeDetailPositionen(items) {
    if (!Array.isArray(items)) return [];
    return items.map(item => ({
      id: item.id || uid(),
      datum: item.datum || '',
      betrag: Number(item.betrag) || 0,
      empfaenger: item.empfaenger || '',
      beschreibung: item.beschreibung || '',
      kategorie: canonicalKategorie(item.kategorie || ''),
      unterkategorie: canonicalUnterkategorie(item.kategorie || '', item.unterkategorie || ''),
      kategorieQuelle: item.kategorieQuelle || (item.kategorie ? 'manuell' : ''),
      tags: normalizeTags(item.tags),
      quelle: item.quelle || '',
    })).filter(item => item.betrag);
  }

  // ── Budgets ──
  function upsertBudget(kategorie, limit) {
    const cleanKategorie = canonicalKategorie(kategorie);
    let b = state.budgets.find(b => b.kategorie === cleanKategorie);
    if (!b) {
      b = { id: uid(), kategorie: cleanKategorie, limit };
      state.budgets.push(b);
    } else {
      b.limit = limit;
    }
    save();
    return b;
  }
  function deleteBudget(id) {
    state.budgets = state.budgets.filter(b => b.id !== id);
    save();
  }

  // ── Sparziele ──
  function addSparziel(data) {
    const s = { id: uid(), name: '', zielbetrag: 0, aktuellerBetrag: 0, zieldatum: '', notiz: '', ...data };
    state.sparziele.push(s);
    save();
    return s;
  }
  function updateSparziel(id, patch) {
    const s = state.sparziele.find(s => s.id === id);
    if (s) Object.assign(s, patch);
    save();
  }
  function deleteSparziel(id) {
    state.sparziele = state.sparziele.filter(s => s.id !== id);
    save();
  }

  // ── Mietobjekte ──
  function addMietobjekt(data) {
    const m = { id: uid(), name: '', mieterName: '', sollMiete: 0, kontoId: '', beginn: todayISO().slice(0, 7), notizen: '', ...data };
    state.mietobjekte.push(m);
    save();
    return m;
  }
  function updateMietobjekt(id, patch) {
    const m = state.mietobjekte.find(m => m.id === id);
    if (m) Object.assign(m, patch);
    save();
  }
  function deleteMietobjekt(id) {
    state.mietobjekte = state.mietobjekte.filter(m => m.id !== id);
    state.transaktionen.forEach(t => { if (t.mietobjektId === id) t.mietobjektId = null; });
    save();
  }

  // ── Wohnungen und Mietverhältnisse ──
  function addWohnung(data) {
    const w = { id: uid(), name: '', flaeche: 0, mea: 0, selbstgenutzt: false, ...data };
    state.wohnungen.push(w);
    save();
    return w;
  }
  function updateWohnung(id, patch) {
    const w = state.wohnungen.find(w => w.id === id);
    if (w) Object.assign(w, patch);
    save();
  }
  function deleteWohnung(id) {
    const mvIds = new Set(state.mietverhaeltnisse.filter(mv => mv.wohnungId === id).map(mv => mv.id));
    state.wohnungen = state.wohnungen.filter(w => w.id !== id);
    state.mietverhaeltnisse = state.mietverhaeltnisse.filter(mv => !mvIds.has(mv.id));
    state.eigentuemerabrechnungen = state.eigentuemerabrechnungen.filter(ea => ea.wohnungId !== id);
    state.transaktionen.forEach(t => { if (mvIds.has(t.mietZuordnung)) t.mietZuordnung = ''; });
    save();
  }

  // ── Eigentümerabrechnungen (eine je Wohnung und Jahr) ──
  function eigentuemerabrechnungFuer(wohnungId, jahr) {
    return state.eigentuemerabrechnungen.find(ea => ea.wohnungId === wohnungId && ea.jahr === String(jahr)) || null;
  }
  // Legt die Abrechnung an oder ersetzt eine vorhandene für Wohnung + Jahr.
  function speichereEigentuemerabrechnung(data) {
    const vorhanden = eigentuemerabrechnungFuer(data.wohnungId, data.jahr);
    const ea = {
      id: vorhanden?.id || uid(), summeLautAbrechnung: null, ...data, jahr: String(data.jahr),
      positionen: (data.positionen || []).map(p => ({ id: p.id || uid(), nr: '', bezeichnung: '', schluessel: '', betrag: 0, umlagefaehig: false, ...p })),
      // Eigene Kosten (z.B. Grundsteuer) gehören nicht zur Verwalterabrechnung
      // und bleiben beim Ersetzen der Positionen (Import) erhalten.
      eigeneKosten: (data.eigeneKosten || vorhanden?.eigeneKosten || []).map(k => ({ id: k.id || uid(), bezeichnung: '', betrag: 0, umlagefaehig: true, ...k, buchungIds: Array.isArray(k.buchungIds) ? k.buchungIds : [] })),
      // Heizkosten laut Einzelabrechnung des Messdienstes (je Nutzer bzw.
      // Leerstand), ebenfalls unabhängig vom Import der Verwalterpositionen.
      heizkosten: (data.heizkosten || vorhanden?.heizkosten || []).map(h => ({ id: h.id || uid(), nutzer: '', gesamt: 0, co2Vermieter: 0, ...h })),
    };
    state.eigentuemerabrechnungen = state.eigentuemerabrechnungen.filter(x => x.id !== ea.id);
    state.eigentuemerabrechnungen.push(ea);
    save();
    return ea;
  }
  // Betrag einer eigenen Kostenposition: mit verknüpften Buchungen die
  // Summe dieser Zahlungen, sonst der eingetragene Betrag.
  function eigeneKostenBetrag(k) {
    if (!k.buchungIds?.length) return k.betrag || 0;
    return state.transaktionen.filter(t => k.buchungIds.includes(t.id)).reduce((s, t) => s + Math.abs(t.betrag), 0);
  }
  function deleteEigentuemerabrechnung(id) {
    state.eigentuemerabrechnungen = state.eigentuemerabrechnungen.filter(ea => ea.id !== id);
    save();
  }
  function addMietverhaeltnis(data) {
    const mv = { id: uid(), wohnungId: '', mieter: '', von: todayISO().slice(0, 7), bis: '', kaltmiete: 0, kaltmieteAenderungen: [], vorauszahlung: 0, zahlerNamen: [], ...data };
    state.mietverhaeltnisse.push(mv);
    save();
    return mv;
  }
  function updateMietverhaeltnis(id, patch) {
    const mv = state.mietverhaeltnisse.find(mv => mv.id === id);
    if (mv) Object.assign(mv, patch);
    save();
  }
  function deleteMietverhaeltnis(id) {
    state.mietverhaeltnisse = state.mietverhaeltnisse.filter(mv => mv.id !== id);
    state.transaktionen.forEach(t => { if (t.mietZuordnung === id) t.mietZuordnung = ''; });
    save();
  }
  // mietZuordnung an der Buchung: '' = automatisch über die Namen,
  // eine Mietverhältnis-ID = von Hand zugeordnet, 'keine' = keine Mietzahlung.
  // mietNkJahr (nur bei Zuordnung von Hand): gesetzt = Nachzahlung bzw.
  // Guthaben aus der Nebenkostenabrechnung dieses Jahres, leer = Miete.
  function setMietZuordnung(transaktionId, wert, nkJahr = '') {
    const t = state.transaktionen.find(t => t.id === transaktionId);
    if (t) {
      t.mietZuordnung = wert || '';
      t.mietNkJahr = wert && wert !== 'keine' ? String(nkJahr || '') : '';
    }
    save();
  }

  // Buchung auf einem Mietkonto (ohne Transfers).
  function istMietBuchung(t) {
    if (!t || !t.betrag || istTransfer(t)) return false;
    const konto = state.konten.find(k => k.id === t.kontoId);
    return konto?.typ === 'miete';
  }
  function istMietEingang(t) {
    return istMietBuchung(t) && t.betrag > 0;
  }

  // Kaltmiete in einem Monat: die letzte Änderung mit "ab" <= Monat, sonst
  // die Kaltmiete ab Mietbeginn.
  function kaltmieteIm(mv, monat) {
    const aenderung = (mv.kaltmieteAenderungen || [])
      .filter(a => a.ab && a.ab <= monat)
      .sort((a, b) => (a.ab < b.ab ? 1 : -1))[0];
    return aenderung ? aenderung.betrag || 0 : mv.kaltmiete || 0;
  }

  function mvLaeuftIm(mv, monat) {
    return !!mv.von && mv.von <= monat && (!mv.bis || monat <= mv.bis);
  }

  // Stichwörter für Nachzahlungen/Guthaben aus der Nebenkostenabrechnung.
  // "Nebenkosten" allein reicht bewusst nicht, weil normale Mietzahlungen
  // oft "Miete inkl. Nebenkosten" im Verwendungszweck tragen.
  const NK_ABRECHNUNG_STICHWORTE = /nachzahlung|abrechnung|guthaben|erstattung/;

  // Abrechnungsjahr: eine Jahreszahl im Text, die vor dem Zahlungsjahr
  // liegt, sonst das Vorjahr der Zahlung.
  function nkJahrAusText(text, datum) {
    const zahlJahr = parseInt((datum || '').slice(0, 4), 10) || new Date().getFullYear();
    const jahre = (text.match(/\b(19|20)\d{2}\b/g) || []).map(Number).filter(j => j < zahlJahr);
    return String(jahre.length ? Math.max(...jahre) : zahlJahr - 1);
  }

  // Zu welchem Mietverhältnis gehört eine Buchung, und ist sie Miete oder
  // eine Nachzahlung/ein Guthaben aus einer Nebenkostenabrechnung?
  // Liefert { mv, nkJahr } (nkJahr '' = Miete) oder null.
  // Von Hand gesetzte Zuordnung gewinnt. Automatisch:
  // - Name passt (alle Wörter, Reihenfolge egal; Banken schreiben oft
  //   "Nachname, Vorname"), gesucht in Empfänger und Beschreibung;
  // - Ausgang an die Mieter*in oder Stichwort wie "Nachzahlung" =
  //   NK-Abrechnung, sonst Eingang im Mietzeitraum = Miete.
  function mietZuordnungFuerBuchung(t) {
    if (!t || t.mietZuordnung === 'keine') return null;
    if (t.mietZuordnung) {
      const mv = state.mietverhaeltnisse.find(mv => mv.id === t.mietZuordnung);
      return mv ? { mv, nkJahr: t.mietNkJahr || '' } : null;
    }
    if (!istMietBuchung(t)) return null;
    const text = `${t.empfaenger || ''} ${t.beschreibung || ''}`.toLowerCase();
    const monat = monthKey(t.datum);
    const passt = name => {
      const woerter = name.toLowerCase().split(/[\s,]+/).filter(w => w.length >= 2);
      return woerter.join('').length >= 3 && woerter.every(w => text.includes(w));
    };
    const kandidaten = state.mietverhaeltnisse.filter(mv => mv.zahlerNamen.some(passt));
    if (!kandidaten.length) return null;
    const imZeitraum = kandidaten.find(mv => mvLaeuftIm(mv, monat));
    if (t.betrag < 0 || NK_ABRECHNUNG_STICHWORTE.test(text)) {
      // Nachzahlungen kommen oft erst nach dem Auszug: dann das letzte
      // Mietverhältnis, das vor der Zahlung begonnen hat.
      const mv = imZeitraum || kandidaten.filter(mv => mv.von && mv.von <= monat).sort((a, b) => (a.von < b.von ? 1 : -1))[0];
      return mv ? { mv, nkJahr: nkJahrAusText(text, t.datum) } : null;
    }
    return imZeitraum ? { mv: imZeitraum, nkJahr: '' } : null;
  }

  function mietverhaeltnisFuerBuchung(t) {
    return mietZuordnungFuerBuchung(t)?.mv || null;
  }

  window.getState = getState;
  window.replaceState = replaceState;
  window.resetState = resetState;
  window.addKonto = addKonto;
  window.updateKonto = updateKonto;
  window.deleteKonto = deleteKonto;
  window.kontoSaldo = kontoSaldo;
  window.addTransaktion = addTransaktion;
  window.updateTransaktion = updateTransaktion;
  window.deleteTransaktion = deleteTransaktion;
  window.istTransfer = istTransfer;
  window.canonicalEmpfaenger = canonicalEmpfaenger;
  window.mergeEmpfaenger = mergeEmpfaenger;
  window.deleteEmpfaengerAlias = deleteEmpfaengerAlias;
  window.addEinnahmenZeile = addEinnahmenZeile;
  window.deleteEinnahmenZeile = deleteEinnahmenZeile;
  window.moveEinnahmenZeile = moveEinnahmenZeile;
  window.toggleEinnahmenZeile = toggleEinnahmenZeile;
  window.toggleEinnahmenSonstige = toggleEinnahmenSonstige;
  window.addErstattung = addErstattung;
  window.deleteErstattung = deleteErstattung;
  window.erstattungsZiel = erstattungsZiel;
  window.einnahmenZeileTrifftZu = einnahmenZeileTrifftZu;
  window.addRegel = addRegel;
  window.deleteRegel = deleteRegel;
  window.updateRegel = updateRegel;
  window.upsertEmpfaengerAutomatisierung = upsertEmpfaengerAutomatisierung;
  window.empfaengerOnlyRegel = empfaengerOnlyRegel;
  window.kategorieUndTagsFuerBuchung = kategorieUndTagsFuerBuchung;
  window.applyRegelnToTransactions = applyRegelnToTransactions;
  window.addKategorie = addKategorie;
  window.findKategorie = findKategorie;
  window.istMietKonto = istMietKonto;
  window.istMietKategorie = istMietKategorie;
  window.privateKategorien = privateKategorien;
  window.mietKategorienListe = mietKategorienListe;
  window.addMietKategorie = addMietKategorie;
  window.deleteKategorie = deleteKategorie;
  window.unterkategorienFuer = unterkategorienFuer;
  window.addUnterkategorie = addUnterkategorie;
  window.deleteUnterkategorie = deleteUnterkategorie;
  window.upsertBudget = upsertBudget;
  window.deleteBudget = deleteBudget;
  window.addSparziel = addSparziel;
  window.updateSparziel = updateSparziel;
  window.deleteSparziel = deleteSparziel;
  window.addMietobjekt = addMietobjekt;
  window.updateMietobjekt = updateMietobjekt;
  window.deleteMietobjekt = deleteMietobjekt;
  window.addWohnung = addWohnung;
  window.updateWohnung = updateWohnung;
  window.deleteWohnung = deleteWohnung;
  window.addMietverhaeltnis = addMietverhaeltnis;
  window.eigentuemerabrechnungFuer = eigentuemerabrechnungFuer;
  window.speichereEigentuemerabrechnung = speichereEigentuemerabrechnung;
  window.deleteEigentuemerabrechnung = deleteEigentuemerabrechnung;
  window.eigeneKostenBetrag = eigeneKostenBetrag;
  window.updateMietverhaeltnis = updateMietverhaeltnis;
  window.deleteMietverhaeltnis = deleteMietverhaeltnis;
  window.setMietZuordnung = setMietZuordnung;
  window.istMietEingang = istMietEingang;
  window.istMietBuchung = istMietBuchung;
  window.mietZuordnungFuerBuchung = mietZuordnungFuerBuchung;
  window.mvLaeuftIm = mvLaeuftIm;
  window.kaltmieteIm = kaltmieteIm;
  window.mietverhaeltnisFuerBuchung = mietverhaeltnisFuerBuchung;
})();
