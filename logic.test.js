const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DEFAULT_PEOPLE,
    emptyState,
    calculateSummary,
    migrateLegacy,
    parseStored,
    validateState,
    addPerson,
    removePerson,
    restoreDefaults
} = require('./script.js');

test('fresh state keeps the four original people and is valid', () => {
    const state = emptyState();
    assert.deepEqual(state.people.map(person => person.id), ['nerea', 'leire', 'naroa', 'gorka']);
    assert.equal(validateState(state), true);
});

test('summary distributes one trip proportionally, including the driver', () => {
    const state = emptyState();
    state.trips.push({ id: 'trip-1', date: '2026-01-01', driver: 'nerea', passengers: ['nerea', 'leire', 'naroa', 'gorka'] });
    const summary = calculateSummary(state);
    assert.equal(summary.nerea.gidatu, 1);
    assert.equal(summary.nerea.bidaiak_guztira, 1);
    assert.equal(summary.nerea.bidaiak_portzentaia, 0.25);
    assert.equal(summary.nerea.emaitza, 0.75);
    assert.equal(summary.leire.emaitza, -0.25);
});

test('legacy migration retains totals through immutable residual opening balances', () => {
    const result = migrateLegacy({
        nerea: { gidatu: 3, bidaiak_guztira: 4, bidaiak_portzentaia: 1.5 },
        leire: { gidatu: 0, bidaiak_guztira: 1, bidaiak_portzentaia: 0.5 },
        naroa: { gidatu: 0, bidaiak_guztira: 0, bidaiak_portzentaia: 0 },
        gorka: { gidatu: 0, bidaiak_guztira: 0, bidaiak_portzentaia: 0 }
    }, [{ id: 7, data: '2026-01-01', gidaria: 'nerea', bidaiariak: ['nerea', 'leire'] }], null);
    assert.ok(result.state);
    assert.deepEqual(result.state.opening.nerea, { gidatu: 2, bidaiak_guztira: 3, bidaiak_portzentaia: 1 });
    assert.deepEqual(calculateSummary(result.state).nerea, { gidatu: 3, bidaiak_guztira: 4, bidaiak_portzentaia: 1.5, emaitza: 1.5 });
});

test('malformed legacy trip is rejected instead of silently filtered', () => {
    const result = migrateLegacy({}, [{ id: 1, data: '2026-01-01', gidaria: 'nerea', bidaiariak: ['nerea', 'unknown'] }], null);
    assert.match(result.error, /Historialeko/);
});

test('history-only legacy data is migrated without inventing a summary', () => {
    const result = migrateLegacy(null, [{ id: 2, data: '2026-01-01', gidaria: 'nerea', bidaiariak: ['nerea', 'leire'] }], null);
    assert.ok(result.state);
    assert.equal(calculateSummary(result.state).nerea.gidatu, 1);
    assert.equal(calculateSummary(result.state).leire.bidaiak_guztira, 1);
});

test('people can be added, archived when used, and default people restored', () => {
    const state = emptyState();
    const added = addPerson(state, 'Ane');
    assert.equal(added.person.name, 'Ane');
    state.trips.push({ id: 'trip-2', date: '2026-01-02', driver: added.person.id, passengers: [added.person.id] });
    assert.deepEqual(removePerson(state, added.person.id), { archived: true });
    assert.equal(state.people.find(person => person.id === added.person.id).active, false);
    state.people.find(person => person.id === 'nerea').active = false;
    restoreDefaults(state);
    assert.equal(state.people.find(person => person.id === 'nerea').active, true);
    assert.equal(state.people.find(person => person.id === added.person.id).active, false);
});

test('prototype-like person ids cannot enter the model', () => {
    const state = emptyState();
    assert.equal(validateState({ ...state, people: [...state.people, { id: '__proto__', name: 'Bad', active: true }], opening: { ...state.opening, '__proto__': { gidatu: 0, bidaiak_guztira: 0, bidaiak_portzentaia: 0 } } }), false);
    assert.equal(DEFAULT_PEOPLE.length, 4);
});

test('restoring defaults reuses a manually re-added person with the same name', () => {
    const state = emptyState();
    removePerson(state, 'nerea');
    const { person } = addPerson(state, 'Nerea');
    restoreDefaults(state);
    assert.equal(state.people.length, 4);
    assert.equal(state.people.find(item => item.name === 'Nerea').id, person.id);
    assert.equal(validateState(state), true);
});

test('migration tolerates floating point residue after all old trips were deleted', () => {
    const summary = Object.fromEntries(DEFAULT_PEOPLE.map(person => [person.id, { gidatu: 0, bidaiak_guztira: 0, bidaiak_portzentaia: -1e-16 }]));
    const result = migrateLegacy(summary, [], null);
    assert.ok(result.state);
    assert.equal(calculateSummary(result.state).nerea.emaitza, 0);
});

test('inconsistent legacy summary is rejected instead of zeroing the opening balance', () => {
    const summary = Object.fromEntries(DEFAULT_PEOPLE.map(person => [person.id, { gidatu: 0, bidaiak_guztira: 0, bidaiak_portzentaia: 0 }]));
    const result = migrateLegacy(summary, [{ id: 1, data: '2026-01-01', gidaria: 'nerea', bidaiariak: ['nerea'] }], null);
    assert.match(result.error, /ez datoz bat/);
});

test('migration clamps floating point residuals close to zero', () => {
    const summary = Object.fromEntries(DEFAULT_PEOPLE.map(person => [person.id, { gidatu: 0, bidaiak_guztira: 0, bidaiak_portzentaia: 0 }]));
    summary.nerea.gidatu = 2;
    summary.nerea.bidaiak_guztira = 2;
    summary.nerea.bidaiak_portzentaia = 0.6666666666666667;
    summary.leire.bidaiak_guztira = 2;
    summary.leire.bidaiak_portzentaia = 0.6666666666666667;
    summary.naroa.bidaiak_guztira = 2;
    summary.naroa.bidaiak_portzentaia = 0.6666666666666667;
    const history = [
        { id: 1, data: '2026-01-01', gidaria: 'nerea', bidaiariak: ['nerea', 'leire', 'naroa'] },
        { id: 2, data: '2026-01-02', gidaria: 'nerea', bidaiariak: ['nerea', 'leire', 'naroa'] }
    ];
    const result = migrateLegacy(summary, history, null);
    assert.ok(result.state);
    assert.equal(result.state.opening.nerea.bidaiak_portzentaia, 0);
    assert.equal(validateState(result.state), true);
});

test('summary-only legacy storage preserves totals', () => {
    const summary = Object.fromEntries(DEFAULT_PEOPLE.map(person => [person.id, { gidatu: 1, bidaiak_guztira: 2, bidaiak_portzentaia: 0.5 }]));
    const storage = { getItem(key) { return key === 'kotxeaDatos' ? JSON.stringify(summary) : null; } };
    const result = parseStored(storage);
    assert.ok(result.state);
    assert.deepEqual(result.state.opening.nerea, { gidatu: 1, bidaiak_guztira: 2, bidaiak_portzentaia: 0.5 });
});

test('state validation rejects null or duplicate trips, duplicate names, and invalid calendar dates', () => {
    const state = emptyState();
    assert.equal(validateState({ ...state, trips: [null] }), false);
    assert.equal(validateState({ ...state, trips: [
        { id: 'same', date: '2026-01-01', driver: 'nerea', passengers: ['nerea'] },
        { id: 'same', date: '2026-01-02', driver: 'leire', passengers: ['leire'] }
    ] }), false);
    const duplicateNames = emptyState(); duplicateNames.people[1].name = duplicateNames.people[0].name;
    assert.equal(validateState(duplicateNames), false);
    assert.equal(validateState({ ...state, trips: [{ id: 'bad-date', date: '2026-02-30', driver: 'nerea', passengers: ['nerea'] }] }), false);
});

test('malformed v1 state and unknown future state remain in recovery mode', () => {
    const malformed = { getItem(key) { return key === 'kotxeaEstado' ? JSON.stringify({ version: 1, people: [null], trips: [] }) : null; } };
    assert.match(parseStored(malformed).error, /egitura/);
    const future = { getItem(key) { return key === 'kotxeaEstado' ? JSON.stringify({ version: 99 }) : null; } };
    assert.match(parseStored(future).error, /bertsioa/);
});
