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

async function seedAccount(uid, role, extra = {}) {
    await testEnv.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await setDoc(doc(db, 'users', uid), { uid, email: `${uid}@example.com` });
        if (role) await setDoc(doc(db, 'platformRoles', uid), { role, ...extra });
    });
}

async function createGroupBatch(db, uid) {
    const batch = writeBatch(db);
    const personId = 'creator-person';
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
        personId
    });
    batch.set(doc(db, 'groups', 'group-1', 'people', personId), {
        id: personId, name: 'Creator', active: true, linkedUid: uid
    });
    batch.set(doc(db, 'users', uid, 'groups', 'group-1'), {
        groupId: 'group-1',
        groupName: 'Kotxea',
        role: 'owner'
    });
    return batch.commit();
}

test('a verified regular account can create a group and join as its owner participant', async () => {
    const uid = 'creator-user';
    await seedAccount(uid, null);
    const db = testEnv.authenticatedContext(uid, {
        email: `${uid}@example.com`,
        email_verified: true
    }).firestore();

    await assertSucceeds(createGroupBatch(db, uid));
});

test('an unverified account cannot create a group', async () => {
    const uid = 'unverified-user';
    await seedAccount(uid, null);
    const db = testEnv.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: false }).firestore();

    await assertFails(createGroupBatch(db, uid));
});

test('the global superadmin cannot create a participant group for himself', async () => {
    const uid = 'global-admin';
    await seedAccount(uid, 'superadmin');
    const db = testEnv.authenticatedContext(uid, {
        email: `${uid}@example.com`, email_verified: true
    }).firestore();

    await assertFails(createGroupBatch(db, uid));
});

test('a participating global administrator can create a group', async () => {
    const uid = 'participating-admin';
    await seedAccount(uid, 'superadmin', { canParticipate: true });
    const db = testEnv.authenticatedContext(uid, {
        email: `${uid}@example.com`, email_verified: true
    }).firestore();

    await assertSucceeds(createGroupBatch(db, uid));
});

test('the global superadmin can grant global administration to another account but not himself', async () => {
    const uid = 'global-admin';
    await seedAccount(uid, 'superadmin');
    await seedAccount('wife-user', null);
    const db = testEnv.authenticatedContext(uid, {
        email: `${uid}@example.com`, email_verified: true
    }).firestore();

    await assertSucceeds(setDoc(doc(db, 'platformRoles', 'wife-user'), {
        role: 'superadmin', canParticipate: true, grantedBy: uid, grantedAt: new Date()
    }));
    await assertFails(setDoc(doc(db, 'platformRoles', uid), {
        role: 'creator', grantedBy: uid, grantedAt: new Date()
    }));
});
