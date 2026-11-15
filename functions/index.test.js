'use strict';

const { randomUUID } = require('node:crypto');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const functions = require('./index.js');

const db = getFirestore();
const auth = getAuth();
let adminUid;

before(async () => {
    adminUid = `admin-${randomUUID()}`;
    await auth.createUser({ uid: adminUid, email: `${adminUid}@example.com`, emailVerified: true });
    await db.collection('platformRoles').doc(adminUid).set({ role: 'superadmin' });
});

async function createUser(label) {
    const uid = `${label}-${randomUUID()}`;
    await auth.createUser({ uid, email: `${uid}@example.com`, emailVerified: true, displayName: label });
    await db.collection('users').doc(uid).set({ uid, email: `${uid}@example.com`, displayName: label });
    return uid;
}

function callableRequest(uid, data) {
    return { auth: { uid }, data };
}

test('global admin can edit names and switch a user between normal and global admin', async () => {
    const uid = await createUser('Ana');
    await functions.setPlatformUser.run(callableRequest(adminUid, {
        uid, firstName: 'Ana', lastName: 'López García', role: 'superadmin', canParticipate: true
    }));

    assert.equal((await db.collection('platformRoles').doc(uid).get()).data().canParticipate, true);
    assert.equal((await db.collection('users').doc(uid).get()).data().lastName, 'López García');
    assert.equal((await auth.getUser(uid)).displayName, 'Ana López García');

    await functions.setPlatformUser.run(callableRequest(adminUid, {
        uid, firstName: 'Ana', lastName: 'López García', role: 'normal', canParticipate: false
    }));
    assert.equal((await db.collection('platformRoles').doc(uid).get()).exists, false);
});

test('deleting a group owner transfers ownership and preserves its trip history', async () => {
    const targetUid = await createUser('Owner');
    const replacementUid = await createUser('Member');
    const groupId = `group-${randomUUID()}`;
    const groupRef = db.collection('groups').doc(groupId);
    await groupRef.set({ name: 'Familia', ownerUid: targetUid, createdBy: targetUid, status: 'active', revision: 4 });
    await groupRef.collection('members').doc(targetUid).set({ uid: targetUid, role: 'owner', personId: 'owner-person' });
    await groupRef.collection('members').doc(replacementUid).set({ uid: replacementUid, role: 'member', personId: 'member-person' });
    await groupRef.collection('people').doc('owner-person').set({ id: 'owner-person', name: 'Owner', linkedUid: targetUid });
    await groupRef.collection('trips').doc('trip-1').set({ id: 'trip-1', driver: 'owner-person', createdBy: targetUid });
    await db.collection('users').doc(targetUid).collection('groups').doc(groupId).set({ groupId, role: 'owner' });
    await db.collection('users').doc(replacementUid).collection('groups').doc(groupId).set({ groupId, role: 'member' });

    await functions.deletePlatformUser.run(callableRequest(adminUid, { uid: targetUid }));

    assert.equal((await groupRef.get()).data().ownerUid, replacementUid);
    assert.equal((await groupRef.get()).data().revision, 6);
    assert.equal((await groupRef.collection('members').doc(replacementUid).get()).data().role, 'owner');
    assert.equal((await groupRef.collection('members').doc(targetUid).get()).exists, false);
    assert.equal((await groupRef.collection('people').doc('owner-person').get()).data().linkedUid, undefined);
    assert.equal((await groupRef.collection('trips').doc('trip-1').get()).exists, true);
    assert.equal((await db.collection('deletedAccounts').doc(targetUid).get()).data().state, 'deleted');
    await assert.rejects(auth.getUser(targetUid), error => error.code === 'auth/user-not-found');
});

test('deletion refuses a sole-member owner group without locking or deleting the account', async () => {
    const targetUid = await createUser('Solo');
    const groupId = `group-${randomUUID()}`;
    const groupRef = db.collection('groups').doc(groupId);
    await groupRef.set({ name: 'Solo', ownerUid: targetUid, createdBy: targetUid, status: 'active', revision: 0 });
    await groupRef.collection('members').doc(targetUid).set({ uid: targetUid, role: 'owner', personId: 'solo-person' });
    await db.collection('users').doc(targetUid).collection('groups').doc(groupId).set({ groupId, role: 'owner' });

    await assert.rejects(
        functions.deletePlatformUser.run(callableRequest(adminUid, { uid: targetUid })),
        error => error.code === 'failed-precondition'
    );
    assert.equal((await db.collection('deletedAccounts').doc(targetUid).get()).exists, false);
    assert.ok(await auth.getUser(targetUid));
});

test('concurrent deletion cannot leave a group owner pointing at a deleted member', async () => {
    const ownerUid = await createUser('ConcurrentOwner');
    const memberUid = await createUser('ConcurrentMember');
    const groupId = `group-${randomUUID()}`;
    const groupRef = db.collection('groups').doc(groupId);
    await groupRef.set({ name: 'Concurrent', ownerUid, createdBy: ownerUid, status: 'active', revision: 0 });
    await groupRef.collection('members').doc(ownerUid).set({ uid: ownerUid, role: 'owner', personId: 'owner-person' });
    await groupRef.collection('members').doc(memberUid).set({ uid: memberUid, role: 'member', personId: 'member-person' });
    await db.collection('users').doc(ownerUid).collection('groups').doc(groupId).set({ groupId, role: 'owner' });
    await db.collection('users').doc(memberUid).collection('groups').doc(groupId).set({ groupId, role: 'member' });

    const results = await Promise.allSettled([
        functions.deletePlatformUser.run(callableRequest(adminUid, { uid: ownerUid })),
        functions.deletePlatformUser.run(callableRequest(adminUid, { uid: memberUid }))
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const owner = (await groupRef.get()).data().ownerUid;
    assert.ok([ownerUid, memberUid].includes(owner));
    assert.ok(await auth.getUser(owner));
    const removedUid = owner === ownerUid ? memberUid : ownerUid;
    await assert.rejects(auth.getUser(removedUid), error => error.code === 'auth/user-not-found');
});

test('account management callables reject non-admin users', async () => {
    const uid = await createUser('Normal');
    await assert.rejects(
        functions.listAuthUsers.run(callableRequest(uid, {})),
        error => error.code === 'permission-denied'
    );
});
