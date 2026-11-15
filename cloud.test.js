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
            focus() { this.focused = true; },
            scrollIntoView() {},
            closest() { return this; },
            replaceChildren() {},
            append() {}, add() {}, reset() {},
            querySelector() { return this.submitButton || (this.submitButton = { disabled: false }); }
        });
    }
    const nav = { hidden: false };
    const presenceWrites = [];
    let verifiedToken = false;
    let tokenRefreshes = 0;
    const documents = new Map();
    let nextId = 0;
    const reference = (refPath) => ({
        path: refPath,
        id: refPath.split('/').at(-1),
        collection: name => reference(refPath + '/' + name),
        doc: (id = 'auto-' + ++nextId) => reference(refPath + '/' + id),
        where: () => reference(refPath),
        onSnapshot() { return () => {}; },
        async set(data) { if (refPath.startsWith('userPresence/')) presenceWrites.push({ path: refPath, data }); },
        async get() {
            if (refPath === 'users/test-user') return { exists: true };
            if (refPath === 'platformRoles/test-user') return { exists: Boolean(role), data: () => ({ role, canParticipate }) };
            if (documents.has(refPath)) return { exists: true, data: () => documents.get(refPath) };
            if (refPath.split('/').length % 2 === 0) return { exists: false };
            const docs = [...documents].filter(([key]) => key.startsWith(refPath + '/') && key.split('/').length === refPath.split('/').length + 1)
                .map(([key, data]) => ({ id: key.split('/').at(-1), data: () => data }));
            return { docs, empty: !docs.length, forEach(callback) { docs.forEach(callback); } };
        }
    });
    let onAuthChanged;
    const rootListeners = {};
    const auth = { onAuthStateChanged(callback) { onAuthChanged = callback; } };
    const db = {
        collection: name => reference(name), async enablePersistence() {},
        batch() {
            const writes = [];
            return {
                set(ref, data) { writes.push([ref.path, data]); },
                update(ref, data) { writes.push([ref.path, { ...documents.get(ref.path), ...data }]); },
                async commit() {
                    if (!verifiedToken) throw Object.assign(new Error('Unverified ID token'), { code: 'permission-denied' });
                    writes.forEach(([key, data]) => documents.set(key, data));
                }
            };
        }
    };
    const firestore = Object.assign(() => db, { FieldValue: { serverTimestamp: () => new Date() } });
    const context = {
        console,
        document: { getElementById: id => elements.get(id) || null, querySelector: () => nav, querySelectorAll: () => [], createElement: () => ({ append() {}, addEventListener() {} }), visibilityState: 'visible', addEventListener() {} },
        firebase: { apps: [{}], auth: () => auth, firestore },
        KOTXEA_FIREBASE_CONFIG: {},
        localStorage: { length: 0, getItem() { return null; }, setItem() {}, removeItem() {} },
        navigator: { userAgent, platform: '', maxTouchPoints: 0 }, location: { protocol: 'https:', href: 'https://example.com/' },
        matchMedia: () => ({ matches: false }), addEventListener(event, listener) { rootListeners[event] = listener; },
        setInterval() { return 1; }, clearInterval() {}, setTimeout(callback) { callback(); }, URL,
        Option: function (label, value) { this.label = label; this.value = value; }
    };
    context.window = context;
    for (const [, file] of html.matchAll(/<script src="\.\/(script|cloud)\.js\?v=\d+"><\/script>/g)) {
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, file + '.js'), 'utf8'), context);
    }
    await context.KotxeaCloud.start();
    const user = { uid: 'test-user', email: 'user@example.com', displayName: 'Test', emailVerified: true, providerData: [{ providerId: 'password' }],
        async getIdToken(forceRefresh) { if (forceRefresh) { verifiedToken = true; tokenRefreshes += 1; } return 'test-token'; }
    };
    await onAuthChanged(user);
    return { elements, nav, onAuthChanged, rootListeners, presenceWrites, documents, tokenRefreshes, cloud: context.KotxeaCloud, logic: context.KotxeaLogic };
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
    assert.equal(elements.has('refreshRoleBtn'), false);
    assert.equal(elements.get('retryProfileBtn').hidden, true);
    assert.equal(elements.has('bootstrapHelp'), false);
    assert.match(elements.get('groupsFeedback').textContent, /Oraindik ez daukazu talderik/);
    await onAuthChanged(null);
    assert.equal(elements.get('authPanel').hidden, false);
    assert.equal(elements.get('groupsPanel').hidden, true);
    assert.equal(elements.get('accountMenuBtn').hidden, true);
});

test('group creation explains when the participant name is missing', async () => {
    const { elements } = await startCloud(null);
    elements.get('newGroupName').value = 'Donostia - Arrasate';
    elements.get('newGroupParticipantName').value = '';
    await elements.get('createGroupForm').listeners.submit({ preventDefault() {} });
    assert.match(elements.get('createGroupFeedback').textContent, /Idatzi zure izena/);
    assert.equal(elements.get('newGroupParticipantName').focused, true);
});

test('production script order supports creating, activating and opening a group', async () => {
    const { elements, documents, cloud, logic, tokenRefreshes } = await startCloud(null);
    assert.equal(tokenRefreshes, 1);
    elements.get('newGroupName').value = 'Donostia - Arrasate';
    elements.get('newGroupParticipantName').value = 'Nerea';
    elements.get('newGroupDiscoverable').checked = true;
    await elements.get('createGroupForm').listeners.submit({ preventDefault() {} });

    const group = cloud.currentGroup();
    assert.ok(group, elements.get('createGroupFeedback').textContent + ' ' + elements.get('groupsFeedback').textContent);
    assert.equal(group.status, 'active');
    assert.equal(group.name, 'Donostia - Arrasate');
    assert.equal(documents.get('groups/' + group.id).status, 'active');
    assert.equal(documents.get('directoryGroups/' + group.id).name, group.name);
    assert.equal(documents.get('groups/' + group.id + '/members/test-user').role, 'owner');
    assert.equal(elements.get('appContent').hidden, false);
    assert.equal(elements.get('createGroupFeedback').textContent, 'Taldea prest dago.');
    assert.equal(elements.get('createGroupForm').submitButton.disabled, false);
    assert.equal(logic.VERSION, 2);
});

test('native group form validation reports the field that needs attention', async () => {
    const { elements } = await startCloud(null);
    elements.get('createGroupForm').listeners.invalid({ target: { id: 'newGroupName' } });
    assert.match(elements.get('createGroupFeedback').textContent, /Idatzi taldearen izena/);
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
