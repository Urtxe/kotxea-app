(function (root) {
    'use strict';

    const STATE_KEY = 'kotxeaEstado';
    const SUMMARY_KEY = 'kotxeaDatos';
    const HISTORY_KEY = 'kotxeaHistoriala';
    const VERSION = 2;
    const DEFAULT_PEOPLE = [
        { id: 'nerea', name: 'Nerea', active: true, default: true },
        { id: 'leire', name: 'Leire', active: true, default: true },
        { id: 'naroa', name: 'Naroa', active: true, default: true },
        { id: 'gorka', name: 'Gorka', active: true, default: true }
    ];

    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function makeId() {
        if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
        if (root.crypto && typeof root.crypto.getRandomValues === 'function') {
            const bytes = new Uint8Array(16); root.crypto.getRandomValues(bytes);
            bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
            return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
        }
        return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    }
    function todayString() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
    function validId(id) { return typeof id === 'string' && id.length > 0 && id.length <= 80 && !['__proto__', 'constructor', 'prototype'].includes(id); }
    function validDate(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const [year, month, day] = value.split('-').map(Number); const parsed = new Date(year, month - 1, day); return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day; }
    function number(value) { return typeof value === 'number' && Number.isFinite(value); }
    function emptyOpening() { return { gidatu: 0, bidaiak_guztira: 0, bidaiak_portzentaia: 0 }; }
    function emptyState() {
        const state = { version: VERSION, people: clone(DEFAULT_PEOPLE), trips: [], opening: Object.create(null) };
        state.people.forEach(person => { state.opening[person.id] = emptyOpening(); }); return state;
    }
    function peopleMap(people) { const map = new Map(); (people || []).forEach(person => map.set(person.id, person)); return map; }
    function validatePerson(person) { return person && validId(person.id) && typeof person.name === 'string' && person.name.trim().length > 0 && person.name.trim().length <= 80 && typeof person.active === 'boolean'; }
    function validateTrip(trip, people) {
        if (!trip || !validId(trip.id) || !validDate(trip.date) || !validId(trip.driver) || !people.has(trip.driver) || !Array.isArray(trip.passengers) || trip.passengers.length === 0) return false;
        const seen = new Set(); return trip.passengers.every(id => validId(id) && people.has(id) && !seen.has(id) && seen.add(id)) && trip.passengers.includes(trip.driver);
    }
    function validateState(state) {
        if (!state || state.version !== VERSION || !Array.isArray(state.people) || !Array.isArray(state.trips) || !state.opening) return false;
        const ids = new Set();
        const names = new Set();
        const tripIds = new Set();
        for (const person of state.people) {
            const normalizedName = person && typeof person.name === 'string' ? person.name.trim().toLocaleLowerCase() : '';
            if (!validatePerson(person) || ids.has(person.id) || names.has(normalizedName)) return false; ids.add(person.id); names.add(normalizedName);
            if (!Object.prototype.hasOwnProperty.call(state.opening, person.id)) return false;
            const opening = state.opening[person.id]; if (!opening || !Number.isSafeInteger(opening.gidatu) || opening.gidatu < 0 || !Number.isSafeInteger(opening.bidaiak_guztira) || opening.bidaiak_guztira < 0 || opening.gidatu > opening.bidaiak_guztira || !number(opening.bidaiak_portzentaia) || opening.bidaiak_portzentaia < 0 || opening.bidaiak_portzentaia > opening.bidaiak_guztira) return false;
        }
        const people = peopleMap(state.people); return state.trips.every(trip => { if (!trip || !validateTrip(trip, people) || tripIds.has(trip.id)) return false; tripIds.add(trip.id); return true; });
    }
    function tripContribution(state) {
        const result = Object.create(null); state.people.forEach(person => { result[person.id] = emptyOpening(); });
        state.trips.forEach(trip => { result[trip.driver].gidatu += 1; const share = 1 / trip.passengers.length; trip.passengers.forEach(id => { result[id].bidaiak_guztira += 1; result[id].bidaiak_portzentaia += share; }); });
        return result;
    }
    function calculateSummary(state) {
        const result = Object.create(null); const contributions = tripContribution(state);
        state.people.forEach(person => { const opening = state.opening[person.id] || emptyOpening(); const trip = contributions[person.id]; const gidatu = opening.gidatu + trip.gidatu; const bidaiak = opening.bidaiak_guztira + trip.bidaiak_guztira; const participation = opening.bidaiak_portzentaia + trip.bidaiak_portzentaia; result[person.id] = { gidatu, bidaiak_guztira: bidaiak, bidaiak_portzentaia: participation, emaitza: gidatu - participation }; });
        return result;
    }
    function normalizeLegacyTrip(trip, people) {
        if (!trip || (typeof trip.id !== 'string' && typeof trip.id !== 'number') || !validId(String(trip.id)) || !validDate(trip.data) || !validId(trip.gidaria) || !people.has(trip.gidaria) || !Array.isArray(trip.bidaiariak)) return null;
        const normalized = { id: String(trip.id), date: trip.data, driver: trip.gidaria, passengers: trip.bidaiariak.slice() };
        return validateTrip(normalized, people) ? normalized : null;
    }
    function migrateLegacy(summaryRaw, historyRaw, stateRaw) {
        const defaults = emptyState(); let summary = summaryRaw; let history = historyRaw;
        if (summary === null && history === null && stateRaw !== null) {
            if (!stateRaw || stateRaw.version !== 1 || !Array.isArray(stateRaw.people) || !Array.isArray(stateRaw.trips)) return { error: 'Ezin izan dira gordetako datuak egiaztatu.' };
            if (!stateRaw.people.every(person => person && typeof person === 'object') || !stateRaw.trips.every(trip => trip && typeof trip === 'object')) return { error: 'Gordetako pertsonen edo bidaien egitura ez da baliozkoa.' };
            const people = stateRaw.people.map(person => ({ id: person.id, name: person.name || person.izena, active: person.active !== false, default: Boolean(person.default) })); const ids = new Set(people.map(person => person.id));
            if (!people.every(validatePerson) || ids.size !== people.length) return { error: 'Gordetako pertsonen egitura ez da baliozkoa.' };
            const map = peopleMap(people); const trips = stateRaw.trips.map(trip => ({ id: (typeof trip.id === 'string' || typeof trip.id === 'number') ? String(trip.id) : trip.id, date: trip.date || trip.data, driver: trip.driver || trip.gidaria, passengers: trip.passengers || trip.bidaiariak }));
            const tripIds = new Set(); if (!trips.every(trip => validateTrip(trip, map) && !tripIds.has(trip.id) && tripIds.add(trip.id))) return { error: 'Gordetako bidaiaren egitura ez da baliozkoa.' };
            const migrated = { version: VERSION, people, trips, opening: Object.create(null) }; people.forEach(person => { migrated.opening[person.id] = emptyOpening(); }); if (!validateState(migrated)) return { error: 'Gordetako aplikazio-egoera ez da baliozkoa.' }; return { state: migrated, migrated: true };
        }
        if (summary === null && history === null) return { state: defaults };
        if (history === null || !Array.isArray(history) || (summary !== null && typeof summary !== 'object')) return { error: 'Gordetako datuak osatu gabe edo hondatuta daude.' };
        const people = clone(DEFAULT_PEOPLE); const map = peopleMap(people); const trips = history.map(trip => normalizeLegacyTrip(trip, map));
        const tripIds = new Set(); if (trips.some(trip => { if (!trip || tripIds.has(trip.id)) return true; tripIds.add(trip.id); return false; })) return { error: 'Historialeko bidaiaren bat ez da baliozkoa.' };
        const reconstructed = { version: VERSION, people, trips, opening: Object.create(null) }; people.forEach(person => { reconstructed.opening[person.id] = emptyOpening(); }); const contribution = tripContribution(reconstructed);
        if (summary === null) return { state: reconstructed, migrated: true };
        const epsilon = 1e-9;
        for (const person of people) {
            if (!Object.prototype.hasOwnProperty.call(summary, person.id)) return { error: 'Laburpeneko datuak ez dira baliozkoak.' };
            const old = summary[person.id];
            if (!old || !Number.isSafeInteger(old.gidatu) || old.gidatu < 0 || !Number.isSafeInteger(old.bidaiak_guztira) || old.bidaiak_guztira < 0 || old.gidatu > old.bidaiak_guztira || !number(old.bidaiak_portzentaia) || old.bidaiak_portzentaia < -epsilon || old.bidaiak_portzentaia > old.bidaiak_guztira + epsilon) return { error: 'Laburpeneko datuak ez dira baliozkoak.' };
            const residual = { gidatu: old.gidatu - contribution[person.id].gidatu, bidaiak_guztira: old.bidaiak_guztira - contribution[person.id].bidaiak_guztira, bidaiak_portzentaia: old.bidaiak_portzentaia - contribution[person.id].bidaiak_portzentaia };
            if (residual.gidatu < -epsilon || residual.bidaiak_guztira < -epsilon || residual.bidaiak_portzentaia < -epsilon || !Number.isInteger(residual.gidatu) || !Number.isInteger(residual.bidaiak_guztira)) return { error: 'Laburpenaren eta historialaren arteko datuak ez datoz bat.' };
            reconstructed.opening[person.id] = { gidatu: Math.abs(residual.gidatu) < epsilon ? 0 : residual.gidatu, bidaiak_guztira: Math.abs(residual.bidaiak_guztira) < epsilon ? 0 : residual.bidaiak_guztira, bidaiak_portzentaia: Math.abs(residual.bidaiak_portzentaia) < epsilon ? 0 : residual.bidaiak_portzentaia };
        }
        if (!validateState(reconstructed)) return { error: 'Laburpenaren eta historialaren arteko datuak ez datoz bat.' };
        return { state: reconstructed, migrated: true };
    }
    function parseStored(storage) {
        let stateRaw = null; let summaryRaw = null; let historyRaw = null; let stateText = null; let summaryText = null; let historyText = null;
        try { stateText = storage.getItem(STATE_KEY); } catch (_) { return { error: 'Gordetako datuak ezin izan dira irakurri.' }; }
        if (stateText !== null) { try { stateRaw = JSON.parse(stateText); } catch (_) { stateRaw = null; } if (stateRaw && stateRaw.version === VERSION) return validateState(stateRaw) ? { state: stateRaw } : { error: 'Gordetako aplikazio-egoera ez da baliozkoa.', raw: { stateRaw } }; if (stateRaw && stateRaw.version !== 1) return { error: 'Gordetako aplikazio-egoeraren bertsioa ez da bateragarria.', raw: { stateRaw } }; }
        try { summaryText = storage.getItem(SUMMARY_KEY); historyText = storage.getItem(HISTORY_KEY); summaryRaw = summaryText === null ? null : JSON.parse(summaryText); historyRaw = historyText === null ? null : JSON.parse(historyText); } catch (_) { return { error: 'Gordetako datuak ezin izan dira irakurri.', raw: { stateRaw, summaryRaw, historyRaw } }; }
        if ((stateText !== null && stateRaw === null) || (summaryText !== null && summaryRaw === null) || (historyText !== null && historyRaw === null)) return { error: 'Gordetako datuak hondatuta daude.', raw: { stateRaw, summaryRaw, historyRaw } };
        if (summaryText !== null && historyText === null) historyRaw = [];
        const result = migrateLegacy(summaryRaw, historyRaw, stateRaw); if (result.state && !validateState(result.state)) return { error: 'Gordetako migrazioaren emaitza ez da baliozkoa.', raw: { stateRaw, summaryRaw, historyRaw } }; return result;
    }
    function addPerson(state, name) { const clean = String(name || '').trim(); if (!clean || clean.length > 80) return { error: 'Izena beharrezkoa da.' }; if (state.people.some(person => person.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) return { error: 'Pertsona hori dagoeneko badago.' }; const person = { id: makeId(), name: clean, active: true, default: false }; state.people.push(person); state.opening[person.id] = emptyOpening(); return { person }; }
    function removePerson(state, id) { const person = state.people.find(item => item.id === id); if (!person) return { error: 'Pertsona ez da aurkitu.' }; const opening = state.opening[id] || emptyOpening(); const used = state.trips.some(trip => trip.driver === id || trip.passengers.includes(id)) || opening.gidatu > 0 || opening.bidaiak_guztira > 0 || opening.bidaiak_portzentaia > 0; if (used) { person.active = false; return { archived: true }; } state.people = state.people.filter(item => item.id !== id); delete state.opening[id]; return { removed: true }; }
    function restoreDefaults(state) { DEFAULT_PEOPLE.forEach(defaultPerson => { const existing = state.people.find(person => person.id === defaultPerson.id || person.name.trim().toLocaleLowerCase() === defaultPerson.name.toLocaleLowerCase()); if (existing) existing.active = true; else { state.people.push(clone(defaultPerson)); state.opening[defaultPerson.id] = emptyOpening(); } }); }

    const api = { VERSION, STATE_KEY, SUMMARY_KEY, HISTORY_KEY, DEFAULT_PEOPLE, emptyState, validateState, validateImport: validateState, calculateSummary, parseStored, migrateLegacy, addPerson, removePerson, restoreDefaults, todayString };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof document === 'undefined') return;

    let state = null; let readOnly = false; let snapshot = null; let storage; let editingTripIds = [];
    try { storage = root.localStorage; } catch (_) { storage = null; }
    function el(id) { return document.getElementById(id); }
    function setStatus(message, loadFailed = false) {
        const target = el('appStatus');
        target.textContent = message || ''; target.hidden = !message;
        if (loadFailed && !el('startupWarning').hidden) el('startupWarning').textContent = 'Datuak ezin izan dira kargatu. Jarraitu beheko oharrari berreskuratzeko.';
    }
    function formatNumber(value) { return Number(value.toFixed(2)).toString(); }
    function renderSummary() {
        if (!state) return; const summary = calculateSummary(state); const body = el('laburpenaBody');
        if (body) { body.innerHTML = ''; state.people.forEach(person => { const row = body.insertRow(); row.dataset.personId = person.id; row.insertCell().textContent = person.name + (person.active ? '' : ' (artxibatua)'); const values = summary[person.id]; const resultCell = row.insertCell(); resultCell.id = 'emaitza-' + person.id; resultCell.textContent = formatNumber(values.emaitza); const totalCell = row.insertCell(); totalCell.id = 'bidaiak-guztira-' + person.id; totalCell.textContent = values.bidaiak_guztira; const driverCell = row.insertCell(); driverCell.id = 'gidatu-' + person.id; driverCell.textContent = values.gidatu; const passengerCell = row.insertCell(); passengerCell.id = 'passenger-' + person.id; passengerCell.textContent = values.bidaiak_guztira - values.gidatu; const actions = row.insertCell(); const button = document.createElement('button'); button.type = 'button'; button.textContent = person.active ? 'Kendu' : 'Berreskuratu'; button.dataset.personId = person.id; button.addEventListener('click', togglePerson); actions.appendChild(button); }); return; }
        state.people.forEach(person => { const values = summary[person.id]; ['emaitza', 'bidaiak-guztira', 'gidatu', 'passenger'].forEach((key, index) => { const target = el(key + '-' + person.id); if (target) target.textContent = index === 0 ? formatNumber(values.emaitza) : String(index === 1 ? values.bidaiak_guztira : index === 2 ? values.gidatu : values.bidaiak_guztira - values.gidatu); }); });
    }
    function tripIdField() { return el('editTripId') || el('hiddenEditTripId'); }
    function renderPeopleChoices(extraIds) {
        if (!state) return; const driver = el('nor');
        const selectedParticipants = new Set([...document.querySelectorAll('input[name="bidaiariak"]:checked')].map(input => input.value));
        const included = new Set((extraIds || editingTripIds).concat(state.people.filter(person => person.active).map(person => person.id)));
        if (driver) { const selected = driver.value; driver.innerHTML = ''; state.people.filter(person => included.has(person.id)).forEach(person => driver.add(new Option(person.name + (person.active ? '' : ' (artxibatua)'), person.id))); if ([...driver.options].some(option => option.value === selected)) driver.value = selected; }
        const container = el('bidaiariakZerrenda');
        if (container) { container.innerHTML = ''; state.people.filter(person => included.has(person.id)).forEach(person => { const label = document.createElement('label'); const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.name = 'bidaiariak'; checkbox.value = person.id; checkbox.id = 'participant-' + person.id; checkbox.checked = selectedParticipants.has(person.id); label.append(checkbox, ' ' + person.name + (person.active ? '' : ' (artxibatua)')); container.appendChild(label); }); }
        updateDriverCheckbox();
        el('formControls').disabled = readOnly || included.size === 0;
        if (included.size === 0) setStatus('Ez dago pertsona aktiborik; gehitu edo berreskuratu pertsona bat bidaia berriak sortzeko.');
    }
    function updateDriverCheckbox(reset = false) { const driver = el('nor'); if (!driver) return; document.querySelectorAll('input[name="bidaiariak"]').forEach(checkbox => { if (reset) checkbox.checked = false; if (checkbox.value === driver.value) checkbox.checked = true; checkbox.disabled = checkbox.value === driver.value; }); }
    function renderHistory() {
        const body = el('historialaBody'); if (!body || !state) return; body.innerHTML = ''; const filter = el('historialEpea'); const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0); cutoff.setDate(cutoff.getDate() - 30); const people = peopleMap(state.people);
        state.trips.slice().reverse().filter(trip => !filter || filter.value !== '30' || (new Date(trip.date + 'T00:00:00') >= cutoff && trip.date <= todayString())).forEach(trip => { const row = body.insertRow(); row.insertCell().textContent = new Date(trip.date + 'T00:00:00').toLocaleDateString('es-ES'); row.insertCell().textContent = people.get(trip.driver)?.name || trip.driver; row.insertCell().textContent = trip.passengers.map(id => people.get(id)?.name || id).join(', '); const actions = row.insertCell(); const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Editatu'; edit.dataset.id = trip.id; edit.addEventListener('click', editTrip); const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Ezabatu'; remove.dataset.id = trip.id; remove.addEventListener('click', deleteTrip); actions.append(edit, remove); });
    }
    function renderAll() { renderSummary(); renderPeopleChoices(); renderHistory(); }
    function persist(nextState, recovery = false) {
        if ((!recovery && readOnly) || !validateState(nextState)) { setStatus('Datuak ez dira baliozkoak edo ezin dira aldatu.'); return false; }
        // ponytail: detects stale tabs; simultaneous writers still need Web Locks or IndexedDB.
        try { if (!recovery && snapshot !== storage.getItem(STATE_KEY)) { setStatus('Beste fitxa batean datuak aldatu dira. Berritu orria gorde aurretik.'); return false; } } catch (_) { setStatus('Ezin izan dira aldaketak gorde; datuak ez dira aldatu.'); return false; }
        const text = JSON.stringify(nextState);
        try { storage.setItem(STATE_KEY, text); } catch (_) { setStatus('Ezin izan dira aldaketak gorde; datuak ez dira aldatu.'); return false; }
        state = nextState; readOnly = false; snapshot = text;
        setStatus('Aldaketak gordeta.'); renderAll(); return true;
    }
    function resetTripForm() {
        editingTripIds = [];
        el('bidaiForm').reset();
        el('editTripId').value = '';
        el('cancelEditBtn').hidden = true;
        el('tripFormTitle').textContent = 'BIDAI BERRIA';
        el('saveTripBtn').textContent = 'Bidai berria gehitu';
        el('bidaiaData').value = todayString();
        el('bidaiaData').max = todayString();
        renderPeopleChoices();
        updateDriverCheckbox(true);
    }
    function togglePerson(event) { if (readOnly) return; const next = clone(state); const person = next.people.find(item => item.id === event.currentTarget.dataset.personId); if (!person) return; if (person.active) removePerson(next, person.id); else person.active = true; persist(next); }
    function submitTrip(event) {
        event.preventDefault(); if (readOnly) return; const date = el('bidaiaData').value; const driver = el('nor').value; const passengers = [...document.querySelectorAll('input[name="bidaiariak"]:checked')].map(input => input.value);
        const editId = tripIdField()?.value; const currentTrip = editId && state.trips.find(item => String(item.id) === String(editId)); if (!validDate(date) || (date > todayString() && (!currentTrip || currentTrip.date !== date))) { alert('Ezin da etorkizuneko bidaia berririk sortu.'); return; } if (!driver || passengers.length === 0 || !passengers.includes(driver)) { alert('Gidaria bidaiarien artean hautatu behar duzu.'); return; }
        const next = clone(state); if (editId) { const trip = next.trips.find(item => String(item.id) === String(editId)); if (!trip) return; trip.date = date; trip.driver = driver; trip.passengers = passengers; } else next.trips.push({ id: makeId(), date, driver, passengers });
        if (persist(next)) resetTripForm();
    }
    function editTrip(event) {
        const trip = state.trips.find(item => item.id === event.currentTarget.dataset.id);
        if (!trip) return;
        editingTripIds = trip.passengers.slice(); renderPeopleChoices(editingTripIds);
        el('bidaiaData').value = trip.date;
        el('bidaiaData').max = trip.date > todayString() ? trip.date : todayString();
        el('nor').value = trip.driver; el('editTripId').value = trip.id;
        el('cancelEditBtn').hidden = false; el('tripFormTitle').textContent = 'BIDAIA ALDATU';
        el('saveTripBtn').textContent = 'Aldaketak gorde';
        document.querySelectorAll('input[name="bidaiariak"]').forEach(input => { input.checked = trip.passengers.includes(input.value); });
        updateDriverCheckbox(); el('bidaiaData').focus();
    }
    function deleteTrip(event) {
        if (readOnly || !confirm('Ziur zaude bidaia hau ezabatu nahi duzula?')) return;
        const id = event.currentTarget.dataset.id;
        const next = clone(state); next.trips = next.trips.filter(trip => trip.id !== id);
        if (persist(next) && el('editTripId').value === id) resetTripForm();
    }
    function toggleAddPerson(event) { event.preventDefault(); if (readOnly) return; const next = clone(state); const result = addPerson(next, el('personName').value); if (result.error) { alert(result.error); return; } if (persist(next)) el('personName').value = ''; }
    function importState(event) {
        const file = event.target.files[0]; event.target.value = ''; if (!file) return;
        const reader = new FileReader();
        reader.onerror = () => setStatus('Ezin izan da fitxategia irakurri.');
        reader.onload = () => {
            let imported;
            try { imported = JSON.parse(reader.result); } catch (_) { setStatus('Inportatutako fitxategia ez da JSON baliozkoa.'); return; }
            if (!validateState(imported)) { setStatus('Inportatutako datuak ez dira baliozkoak.'); return; }
            if (confirm('Inportazioak uneko datuak ordezkatuko ditu. Egin kopia bat lehenik. Jarraitu?') && persist(clone(imported), readOnly)) {
                el('startupWarning').hidden = true;
                bindReadyListeners(); resetTripForm();
            }
        };
        reader.readAsText(file);
    }
    function exportState() {
        let payload;
        try { payload = JSON.stringify(!readOnly && state ? state : { raw: storage.getItem(STATE_KEY), summary: storage.getItem(SUMMARY_KEY), history: storage.getItem(HISTORY_KEY) }, null, 2); }
        catch (_) { setStatus('Ezin izan dira datuak irakurri kopia egiteko.'); return; }
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
        link.download = 'kotxea-' + todayString() + '.json';
        link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }
    function resetState() {
        if (!confirm('Ziur zaude bidaien historia eta kontagailuak berrezarri nahi dituzula?')) return;
        const next = state ? clone(state) : emptyState(); next.trips = [];
        next.people.forEach(person => { next.opening[person.id] = emptyOpening(); });
        if (persist(next, readOnly)) { el('startupWarning').hidden = true; bindReadyListeners(); resetTripForm(); }
    }
    let readyListenersBound = false;
    function bindReadyListeners() {
        el('personName').disabled = false;
        el('personForm').querySelectorAll('button').forEach(button => { button.disabled = false; });
        if (readyListenersBound) return;
        readyListenersBound = true;
        el('nor').addEventListener('change', () => updateDriverCheckbox(true));
        el('historialEpea').addEventListener('change', renderHistory);
        el('bidaiForm').addEventListener('submit', submitTrip);
        el('personForm').addEventListener('submit', toggleAddPerson);
        el('restoreDefaultsBtn').addEventListener('click', () => { const next = clone(state); restoreDefaults(next); persist(next); });
        el('cancelEditBtn').addEventListener('click', resetTripForm);
    }
    function setup() {
        el('exportBtn')?.addEventListener('click', exportState); el('importFile')?.addEventListener('change', importState); el('resetBtn')?.addEventListener('click', resetState);
        if (!storage) { readOnly = true; setStatus('Biltegiratzea ez dago erabilgarri. Datuak irakurtzeko moduan.', true); return; }
        const result = parseStored(storage); if (result.error) { readOnly = true; setStatus(result.error + ' Egin babeskopia edo inportatu fitxategi baliozko bat.', true); return; }
        state = result.state; if (result.migrated) { try { storage.setItem(STATE_KEY, JSON.stringify(state)); } catch (_) { readOnly = true; setStatus('Ezin izan da migrazioa gorde.', true); return; } }
        try { snapshot = storage.getItem(STATE_KEY); }
        catch (_) { readOnly = true; setStatus('Ezin izan dira datuak irakurri.', true); return; }
        renderAll(); resetTripForm(); el('startupWarning').hidden = true;
        bindReadyListeners();
        root.addEventListener('storage', event => { if ((event.key === STATE_KEY || event.key === null) && event.newValue !== snapshot) setStatus('Beste fitxa batean datuak aldatu dira. Berritu orria gorde aurretik.'); });
    }
    root.addEventListener('DOMContentLoaded', setup);
}(typeof window !== 'undefined' ? window : globalThis));
