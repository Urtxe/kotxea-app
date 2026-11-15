const fs = require('node:fs');
const path = require('node:path');
const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} = require('@firebase/rules-unit-testing');
const { doc, setDoc, writeBatch } = require('firebase/firestore');

const projectId = 'demo-kotxea';
const rules = fs.readFileSync(path.join(__dirname, 'firestore.rules'), 'utf8');
let testEnv;

before(async () => {
    testEnv = await initializeTestEnvironment({
        projectId,
        firestore: { rules }
    });
});

beforeEach(async () => {
    await testEnv.clearFirestore();
});

after(async () => {
    await testEnv.cleanup();
});

async function seedAccount(uid, role) {
    await testEnv.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await setDoc(doc(db, 'users', uid), { uid, email: `${uid}@example.com` });
        if (role) await setDoc(doc(db, 'platformRoles', uid), { role });
    });
}

async function createGroupBatch(db, uid) {
    const batch = writeBatch(db);
    batch.set(doc(db, 'groups', 'group-1'), {
        name: 'Kotxea',
        ownerUid: uid,
        createdBy: uid,
        discoverable: true,
        status: 'initializing',
        revision: 0
    });
    batch.set(doc(db, 'groups', 'group-1', 'members', uid), {
        uid,
        role: 'owner',
        personId: null
    });
    batch.set(doc(db, 'users', uid, 'groups', 'group-1'), {
        groupId: 'group-1',
        groupName: 'Kotxea',
        role: 'owner'
    });
    return batch.commit();
}

test('a verified group creator can atomically create a group and its owner membership', async () => {
    const uid = 'creator-user';
    await seedAccount(uid, 'creator');
    const db = testEnv.authenticatedContext(uid, {
        email: `${uid}@example.com`,
        email_verified: true
    }).firestore();

    await assertSucceeds(createGroupBatch(db, uid));
});

test('a verified account without a creator role cannot create a group', async () => {
    const uid = 'regular-user';
    await seedAccount(uid, null);
    const db = testEnv.authenticatedContext(uid, {
        email: `${uid}@example.com`,
        email_verified: true
    }).firestore();

    await assertFails(createGroupBatch(db, uid));
});
