const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function startCloud(role, canParticipate = false, userAgent = '') {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const elements = new Map();
    for (const [tag, id] of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
        elements.set(id, {
            hidden: /\bhidden\b/.test(tag), value: '', textContent: '',
            listeners: {},
            addEventListener(event, listener) { this.listeners[event] = listener; },
            showModal() { this.open = true; },
            close() { this.open = false; },
            scrollIntoView() {},
            closest() { return this; },
            replaceChildren() {}
        });
    }
    const nav = { hidden: false };
    const emptySnapshot = { docs: [], empty: true, forEach() {} };
    const presenceWrites = [];
    const reference = (refPath) => ({
        collection: name => reference(refPath + '/' + name),
        doc: id => reference(refPath + '/' + id),
        where: () => reference(refPath),
        async set(data) { if (refPath.startsWith('userPresence/')) presenceWrites.push({ path: refPath, data }); },
        async get() {
            if (refPath === 'users/test-user') return { exists: true };
            if (refPath === 'platformRoles/test-user') return { exists: Boolean(role), data: () => ({ role, canParticipate }) };
            return emptySnapshot;
        }
    });
    let onAuthChanged;
    const rootListeners = {};
    const auth = { onAuthStateChanged(callback) { onAuthChanged = callback; } };
    const db = { collection: name => reference(name), async enablePersistence() {} };
    const firestore = Object.assign(() => db, { FieldValue: { serverTimestamp: () => new Date() } });
    const context = {
        console,
        document: { getElementById: id => elements.get(id) || null, querySelector: () => nav, visibilityState: 'visible', addEventListener() {} },
        firebase: { apps: [{}], auth: () => auth, firestore },
        KOTXEA_FIREBASE_CONFIG: {},
        localStorage: { length: 0 },
        navigator: { userAgent, platform: '', maxTouchPoints: 0 }, location: { protocol: 'https:', href: 'https://example.com/' },
        matchMedia: () => ({ matches: false }), addEventListener(event, listener) { rootListeners[event] = listener; },
        setInterval() { return 1; }, clearInterval() {}, setTimeout(callback) { callback(); }, URL
    };
    context.window = context;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'cloud.js'), 'utf8'), context);
    await context.KotxeaCloud.start();
    const user = { uid: 'test-user', email: 'user@example.com', displayName: 'Test', emailVerified: true, providerData: [{ providerId: 'google.com' }] };
    await onAuthChanged(user);
    return { elements, nav, onAuthChanged, rootListeners, presenceWrites };
}

test('signed-in global administrator gets the dashboard without becoming a group participant', async () => {
    const { elements, nav } = await startCloud('superadmin');
    assert.equal(elements.get('groupsPanel').hidden, false);
    assert.equal(elements.get('authPanel').hidden, true);
    assert.equal(elements.get('adminPanel').hidden, true);
    assert.equal(elements.get('appContent').hidden, true);
    assert.equal(elements.get('createGroupDetails').hidden, true);
    assert.equal(elements.get('groupSearchPanel').hidden, true);
    assert.equal(elements.get('globalAdminFromGroupsBtn').hidden, false);
    assert.equal(elements.get('signOutFromGroupsBtn').hidden, false);
    assert.equal(nav.hidden, true);
    await elements.get('accountMenuBtn').listeners.click();
    assert.equal(elements.get('groupsPanel').hidden, false);
});

test('a regular account can create a group; signing out returns to login', async () => {
    const { elements, onAuthChanged } = await startCloud(null);
    assert.equal(elements.get('groupsPanel').hidden, false);
    assert.equal(elements.get('createGroupDetails').hidden, false);
    assert.equal(elements.get('groupSearchPanel').hidden, false);
    assert.equal(elements.get('globalAdminFromGroupsBtn').hidden, true);
    assert.equal(elements.get('refreshRoleBtn').hidden, false);
    await onAuthChanged(null);
    assert.equal(elements.get('authPanel').hidden, false);
    assert.equal(elements.get('groupsPanel').hidden, true);
    assert.equal(elements.get('accountMenuBtn').hidden, true);
});

test('a global administrator marked as a participant can create and join groups', async () => {
    const { elements } = await startCloud('superadmin', true);
    assert.equal(elements.get('createGroupDetails').hidden, false);
    assert.equal(elements.get('groupSearchPanel').hidden, false);
});

test('a verified signed-in user publishes a presence heartbeat', async () => {
    const { presenceWrites } = await startCloud(null);
    assert.equal(presenceWrites.length, 1);
    assert.equal(presenceWrites[0].path, 'userPresence/test-user');
    assert.equal(presenceWrites[0].data.uid, 'test-user');
    assert.equal(typeof presenceWrites[0].data.lastSeenAt.getTime, 'function');
});

test('install opens an explanation and remains available if the native prompt is dismissed', async () => {
    const { elements, rootListeners } = await startCloud(null);
    rootListeners.beforeinstallprompt({ preventDefault() {}, async prompt() {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) });

    elements.get('installAppBtn').listeners.click();
    assert.equal(elements.get('installDialog').open, true);
    assert.match(elements.get('installDialogText').textContent, /Chrome-n/);
    await elements.get('installConfirmBtn').listeners.click();
    assert.equal(elements.get('installAppBtn').hidden, false);
});

test('install explanation gives Safari and Chrome iPhone and Android steps in Basque', async () => {
    const safari = await startCloud(null, false, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
    safari.elements.get('installAppBtn').listeners.click();
    assert.match(safari.elements.get('installDialogText').textContent, /Safari-n \(iPhone\/iPad\)/);
    assert.match(safari.elements.get('installDialogText').textContent, /Añadir a pantalla de inicio/);

    const chromeIOS = await startCloud(null, false, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.0.0 Mobile/15E148 Safari/604.1');
    chromeIOS.elements.get('installAppBtn').listeners.click();
    assert.match(chromeIOS.elements.get('installDialogText').textContent, /Chrome-n \(iPhone\/iPad\)/);

    const chromeAndroid = await startCloud(null, false, 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36');
    chromeAndroid.elements.get('installAppBtn').listeners.click();
    assert.match(chromeAndroid.elements.get('installDialogText').textContent, /Chrome-n \(Android\)/);
    assert.match(chromeAndroid.elements.get('installDialogText').textContent, /Añadir a pantalla de inicio/);
});
