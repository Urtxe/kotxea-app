const fs = require('node:fs');
const path = require('node:path');
const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} = require('@firebase/rules-unit-testing');
const { collection, doc, getDoc, getDocs, increment, serverTimestamp, setDoc, updateDoc, writeBatch } = require('firebase/firestore');

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
        revision: 0,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    batch.set(doc(db, 'groups', 'group-1', 'members', uid), {
        uid,
        role: 'owner',
        personId, email: `${uid}@example.com`, displayName: 'Creator', joinedAt: serverTimestamp()
    });
    batch.set(doc(db, 'groups', 'group-1', 'people', personId), {
        id: personId, name: 'Creator', active: true, linkedUid: uid, createdBy: uid,
        opening: { gidatu: 0, bidaiak_guztira: 0, bidaiak_portzentaia: 0 }
    });
    batch.set(doc(db, 'users', uid, 'groups', 'group-1'), {
        groupId: 'group-1',
        groupName: 'Kotxea',
        role: 'owner', joinedAt: serverTimestamp()
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

test('a verified regular account can finish setting up its new group', async () => {
    const uid = 'creator-user';
    await seedAccount(uid, null);
    const db = testEnv.authenticatedContext(uid, {
        email: `${uid}@example.com`,
        email_verified: true
    }).firestore();

    await assertSucceeds(createGroupBatch(db, uid));

    const timestamp = new Date();
    const finish = writeBatch(db);
    finish.update(doc(db, 'groups/group-1'), { status: 'active', updatedAt: timestamp });
    finish.set(doc(db, 'directoryGroups/group-1'), {
        groupId: 'group-1', name: 'Kotxea', discoverable: true, status: 'active', updatedAt: timestamp
    });
    finish.set(doc(db, 'users', uid, 'groups', 'group-1'), {
        groupId: 'group-1', groupName: 'Kotxea', role: 'owner', joinedAt: timestamp
    }, { merge: true });

    await assertSucceeds(finish.commit());
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

test('a group member can queue a trip and increment the group revision atomically', async () => {
    const uid = 'trip-member';
    await seedAccount(uid, null);
    await testEnv.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await setDoc(doc(db, 'groups/group-1'), {
            name: 'Kotxea', ownerUid: uid, createdBy: uid, status: 'active', revision: 0
        });
        await setDoc(doc(db, 'groups/group-1/members', uid), { uid, role: 'owner', personId: 'person-1' });
        await setDoc(doc(db, 'groups/group-1/people/person-1'), { id: 'person-1', name: 'Nerea', active: true, linkedUid: uid });
    });
    const db = testEnv.authenticatedContext(uid, {
        email: `${uid}@example.com`, email_verified: true
    }).firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'groups/group-1/trips/trip-1'), {
        id: 'trip-1', date: '2026-08-23', driver: 'person-1', passengers: ['person-1'],
        createdBy: uid, createdByName: 'Nerea', createdAt: serverTimestamp(), updatedBy: uid, updatedAt: serverTimestamp()
    });
    batch.update(doc(db, 'groups/group-1'), { revision: increment(1), updatedAt: serverTimestamp() });

    await assertSucceeds(batch.commit());
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

test('a deletion tombstone blocks an already-issued sign-in token immediately', async () => {
    const uid = 'deleted-user';
    await seedAccount(uid, null);
    await testEnv.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'deletedAccounts', uid), { state: 'deleted' });
    });
    const db = testEnv.authenticatedContext(uid, {
        email: `${uid}@example.com`, email_verified: true
    }).firestore();

    await assertFails(getDoc(doc(db, 'users', uid)));
    await assertFails(getDoc(doc(db, 'deletedAccounts', uid)));
    await assertFails(setDoc(doc(db, 'userPresence', uid), { uid, lastSeenAt: serverTimestamp() }));
});

test('a regular account can save its separate first and last names', async () => {
    const uid = 'named-user';
    await seedAccount(uid, null);
    const db = testEnv.authenticatedContext(uid, {
        email: `${uid}@example.com`, email_verified: true
    }).firestore();

    await assertSucceeds(updateDoc(doc(db, 'users', uid), {
        displayName: 'Ana López García', firstName: 'Ana', lastName: 'López García'
    }));
});

test('accounts can publish only their own current presence and global admins can read it', async () => {
    await seedAccount('presence-user', null);
    await seedAccount('presence-other', null);
    await seedAccount('presence-admin', 'superadmin');
    const ownDb = testEnv.authenticatedContext('presence-user', {
        email: 'presence-user@example.com', email_verified: true
    }).firestore();
    const otherDb = testEnv.authenticatedContext('presence-other', {
        email: 'presence-other@example.com', email_verified: true
    }).firestore();
    const adminDb = testEnv.authenticatedContext('presence-admin', {
        email: 'presence-admin@example.com', email_verified: true
    }).firestore();

    await assertSucceeds(setDoc(doc(ownDb, 'userPresence/presence-user'), {
        uid: 'presence-user', lastSeenAt: serverTimestamp()
    }));
    await assertFails(setDoc(doc(ownDb, 'userPresence/presence-other'), {
        uid: 'presence-other', lastSeenAt: serverTimestamp()
    }));
    await assertFails(setDoc(doc(ownDb, 'userPresence/presence-user'), {
        uid: 'presence-user', lastSeenAt: new Date(0)
    }));
    await assertSucceeds(getDocs(collection(adminDb, 'userPresence')));
    await assertFails(getDocs(collection(ownDb, 'userPresence')));
});

test('a global admin cannot restore a platform role to a deleted account', async () => {
    const adminUid = 'global-admin';
    const deletedUid = 'deleted-user';
    await seedAccount(adminUid, 'superadmin');
    await seedAccount(deletedUid, null);
    await testEnv.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'deletedAccounts', deletedUid), { state: 'deleted' });
    });
    const db = testEnv.authenticatedContext(adminUid, {
        email: `${adminUid}@example.com`, email_verified: true
    }).firestore();

    await assertFails(setDoc(doc(db, 'platformRoles', deletedUid), {
        role: 'superadmin', grantedBy: adminUid, grantedAt: new Date()
    }));
});
