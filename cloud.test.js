const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function startCloud(role) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const elements = new Map();
    for (const [tag, id] of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
        elements.set(id, {
            hidden: /\bhidden\b/.test(tag), value: '', textContent: '',
            listeners: {},
            addEventListener(event, listener) { this.listeners[event] = listener; },
            replaceChildren() {}
        });
    }
    const nav = { hidden: false };
    const emptySnapshot = { docs: [], empty: true, forEach() {} };
    const reference = (refPath) => ({
        collection: name => reference(refPath + '/' + name),
        doc: id => reference(refPath + '/' + id),
        where: () => reference(refPath),
        async get() {
            if (refPath === 'users/test-user') return { exists: true };
            if (refPath === 'platformRoles/test-user') return { exists: Boolean(role), data: () => ({ role }) };
            return emptySnapshot;
        }
    });
    let onAuthChanged;
    const auth = { onAuthStateChanged(callback) { onAuthChanged = callback; } };
    const db = { collection: name => reference(name), async enablePersistence() {} };
    const context = {
        console,
        document: { getElementById: id => elements.get(id) || null, querySelector: () => nav },
        firebase: { apps: [{}], auth: () => auth, firestore: () => db },
        KOTXEA_FIREBASE_CONFIG: {},
        localStorage: { length: 0 },
        navigator: {}, location: { protocol: 'https:', href: 'https://example.com/' },
        matchMedia: () => ({ matches: false }), addEventListener() {}, URL
    };
    context.window = context;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'cloud.js'), 'utf8'), context);
    await context.KotxeaCloud.start();
    const user = { uid: 'test-user', email: 'user@example.com', displayName: 'Test', emailVerified: true, providerData: [{ providerId: 'google.com' }] };
    await onAuthChanged(user);
    return { elements, nav, onAuthChanged };
}

test('signed-in superadmin sees groups, group creation and sign-out without an existing group', async () => {
    const { elements, nav } = await startCloud('superadmin');
    assert.equal(elements.get('groupsPanel').hidden, false);
    assert.equal(elements.get('authPanel').hidden, true);
    assert.equal(elements.get('adminPanel').hidden, true);
    assert.equal(elements.get('appContent').hidden, true);
    assert.equal(elements.get('createGroupDetails').hidden, false);
    assert.equal(elements.get('signOutFromGroupsBtn').hidden, false);
    assert.equal(nav.hidden, true);
    await elements.get('accountMenuBtn').listeners.click();
    assert.equal(elements.get('groupsPanel').hidden, false);
});

test('regular account sees groups and role refresh; signing out returns to login', async () => {
    const { elements, onAuthChanged } = await startCloud(null);
    assert.equal(elements.get('groupsPanel').hidden, false);
    assert.equal(elements.get('createGroupDetails').hidden, true);
    assert.equal(elements.get('refreshRoleBtn').hidden, false);
    await onAuthChanged(null);
    assert.equal(elements.get('authPanel').hidden, false);
    assert.equal(elements.get('groupsPanel').hidden, true);
    assert.equal(elements.get('accountMenuBtn').hidden, true);
});
