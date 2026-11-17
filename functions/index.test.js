'use strict';

const { randomUUID } = require('node:crypto');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const functions = require('./index.js');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth: getClientAuth, connectAuthEmulator, signInWithEmailAndPassword, reload, getIdTokenResult } = require('firebase/auth');
const { getFirestore: getClientFirestore, connectFirestoreEmulator, doc: clientDoc, writeBatch: clientWriteBatch } = require('firebase/firestore');

const db = getFirestore();
const auth = getAuth();
let adminUid;

test('reloading a verified password account still requires refreshing its earlier ID token', async () => {
    const uid = `verification-${randomUUID()}`;
    const email = `${uid}@example.com`;
    const password = 'emulator-only-password';
    await auth.createUser({ uid, email, password, emailVerified: false });
    const app = initializeApp({ projectId: 'demo-kotxea', apiKey: 'demo-key' }, uid);
    try {
        const clientAuth = getClientAuth(app);
        connectAuthEmulator(clientAuth, 'http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST, { disableWarnings: true });
        const { user } = await signInWithEmailAndPassword(clientAuth, email, password);
        assert.equal((await getIdTokenResult(user)).claims.email_verified, false);
        await auth.updateUser(uid, { emailVerified: true });
        await reload(user);
        assert.equal(user.emailVerified, true);
        assert.equal((await getIdTokenResult(user)).claims.email_verified, false);
        const clientDb = getClientFirestore(app);
        const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
        connectFirestoreEmulator(clientDb, host, Number(port));
        await db.collection('groupNames').doc(uid).set({ groupId: uid, uid, name: 'Donostia - Arrasate' });
        const createGroup = () => {
            const batch = clientWriteBatch(clientDb);
            batch.set(clientDoc(clientDb, 'groups', uid), {
                name: 'Donostia - Arrasate', nameKey: uid, ownerUid: uid, createdBy: uid,
                status: 'initializing', discoverable: true, revision: 0
            });
            batch.set(clientDoc(clientDb, 'groups', uid, 'members', uid), { uid, role: 'owner', personId: uid });
            batch.set(clientDoc(clientDb, 'groups', uid, 'people', uid), {
                id: uid, name: 'Creator', active: true, linkedUid: uid, createdBy: uid,
                opening: { gidatu: 0, bidaiak_guztira: 0, bidaiak_portzentaia: 0 }
            });
            batch.set(clientDoc(clientDb, 'users', uid, 'groups', uid), { groupId: uid, groupName: 'Donostia - Arrasate', role: 'owner' });
            return batch.commit();
        };
        await assert.rejects(createGroup(), error => error.code === 'permission-denied');
        assert.equal((await getIdTokenResult(user, true)).claims.email_verified, true);
        await createGroup();
        assert.equal((await db.collection('groups').doc(uid).get()).data().ownerUid, uid);
    } finally {
        await deleteApp(app);
    }
});

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

test('removing an owner requires a chosen successor, revokes access and preserves history', async () => {
    const owner = await createUser('GroupOwner');
    const successor = await createUser('Successor');
    const stranger = await createUser('Stranger');
    const groupId = `remove-${randomUUID()}`;
    const group = db.collection('groups').doc(groupId);
    await group.set({ name: 'Remove', status: 'active', ownerUid: owner, revision: 0 });
    await group.collection('members').doc(owner).set({ uid: owner, role: 'owner', personId: 'old' });
    await group.collection('members').doc(successor).set({ uid: successor, role: 'member' });
    await group.collection('people').doc('old').set({ id: 'old', name: 'Owner', active: true, linkedUid: owner, opening: { balance: 1 } });
    await group.collection('trips').doc('history').set({ driver: 'old' });
    const invite = db.collection('invitations').doc();
    await invite.set({ groupId, personId: 'old', status: 'accepted', acceptedBy: owner });
    const requestRef = db.collection('joinRequests').doc();
    await requestRef.set({ groupId, uid: owner, personId: 'old', status: 'approved' });
    const remove = (actor, replacementUid) => functions.removeGroupPerson.run(callableRequest(actor, { groupId, personId: 'old', replacementUid }));
    await assert.rejects(remove(stranger, successor), error => error.code === 'permission-denied');
    await assert.rejects(remove(owner), error => error.code === 'failed-precondition');
    await assert.rejects(remove(owner, stranger), error => error.code === 'failed-precondition');
    assert.equal((await group.collection('members').doc(owner).get()).exists, true);
    await remove(owner, successor);
    assert.equal((await group.get()).data().ownerUid, successor);
    assert.equal((await group.collection('members').doc(successor).get()).data().role, 'owner');
    assert.equal((await group.collection('members').doc(owner).get()).exists, false);
    const person = (await group.collection('people').doc('old').get()).data();
    assert.equal(person.removed, true);
    assert.equal(person.linkedUid, undefined);
    assert.equal(person.opening.balance, 1);
    assert.equal((await group.collection('trips').doc('history').get()).exists, true);
    assert.equal((await invite.get()).data().status, 'revoked');
    assert.equal((await requestRef.get()).data().status, 'revoked');
    assert.ok(await auth.getUser(owner));
    await remove(successor);
});

test('removing an administrator without a traveler profile preserves the chosen owner role', async () => {
    const owner = await createUser('OwnerWithoutTraveler');
    const administrator = await createUser('AdministratorWithoutTraveler');
    const groupId = `admin-remove-${randomUUID()}`;
    const group = db.collection('groups').doc(groupId);
    await group.set({ name: 'Admin removal', status: 'active', ownerUid: owner, revision: 0 });
    await group.collection('members').doc(owner).set({ uid: owner, role: 'owner', personId: null });
    await group.collection('members').doc(administrator).set({ uid: administrator, role: 'admin', personId: null, email: `${administrator}@example.com` });
    const invite = db.collection('invitations').doc();
    await invite.set({ groupId, personId: null, email: `${administrator}@example.com`, status: 'pending' });
    const remove = replacementUid => functions.removeGroupPerson.run(callableRequest(owner, { groupId, uid: administrator, replacementUid }));
    await assert.rejects(remove(), error => error.code === 'failed-precondition');
    await remove(owner);
    assert.equal((await group.collection('members').doc(administrator).get()).exists, false);
    assert.equal((await group.collection('members').doc(owner).get()).data().role, 'owner');
    assert.equal((await group.get()).data().ownerUid, owner);
    assert.equal((await invite.get()).data().status, 'revoked');
    assert.ok(await auth.getUser(administrator));
});

test('group owners and global admins can permanently delete a group and its references', async () => {
    const owner = await createUser('DeleteGroupOwner');
    const member = await createUser('DeleteGroupMember');
    const groupId = `delete-${randomUUID()}`;
    const nameKey = `delete-name-${randomUUID()}`;
    const group = db.collection('groups').doc(groupId);
    await group.set({ name: 'Delete me', nameKey, ownerUid: owner, createdBy: owner, status: 'active', revision: 0 });
    await db.collection('groupNames').doc(nameKey).set({ groupId, uid: owner, name: 'Delete me' });
    await db.collection('directoryGroups').doc(groupId).set({ groupId, name: 'Delete me' });
    for (const [uid, role] of [[owner, 'owner'], [member, 'member']]) {
        await group.collection('members').doc(uid).set({ uid, role });
        await db.collection('users').doc(uid).collection('groups').doc(groupId).set({ groupId, role });
    }
    await group.collection('people').doc('traveler').set({ id: 'traveler', name: 'Traveler' });
    await group.collection('trips').doc('trip').set({ id: 'trip', driver: 'traveler' });
    const invitation = db.collection('invitations').doc();
    const joinRequest = db.collection('joinRequests').doc();
    await invitation.set({ groupId, status: 'pending' });
    await joinRequest.set({ groupId, status: 'pending' });
    const deleteAs = uid => functions.deleteGroup.run(callableRequest(uid, { groupId }));

    await assert.rejects(deleteAs(member), error => error.code === 'permission-denied');
    await deleteAs(owner);
    assert.equal((await group.get()).exists, false);
    assert.equal((await group.collection('trips').get()).empty, true);
    assert.equal((await db.collection('groupNames').doc(nameKey).get()).exists, false);
    assert.equal((await db.collection('directoryGroups').doc(groupId).get()).exists, false);
    assert.equal((await invitation.get()).exists, false);
    assert.equal((await joinRequest.get()).exists, false);
    assert.equal((await db.collection('users').doc(owner).collection('groups').doc(groupId).get()).exists, false);
    assert.equal((await db.collection('users').doc(member).collection('groups').doc(groupId).get()).exists, false);

    const globalGroupId = `global-delete-${randomUUID()}`;
    const globalGroup = db.collection('groups').doc(globalGroupId);
    await globalGroup.set({ name: 'Global delete', ownerUid: member, createdBy: member, status: 'active' });
    await functions.deleteGroup.run(callableRequest(adminUid, { groupId: globalGroupId }));
    assert.equal((await globalGroup.get()).exists, false);
});

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

test('user directory separates legacy first and last names and includes auth timestamps', async () => {
    const uid = `legacy-${randomUUID()}`;
    await auth.createUser({ uid, email: `${uid}@example.com`, displayName: 'Mikel Urtxegi Garcia' });
    await db.collection('users').doc(uid).set({ uid, email: `${uid}@example.com`, displayName: 'Mikel Urtxegi Garcia' });
    const seenAt = new Date('2026-11-15T12:30:00.000Z');
    await db.collection('userPresence').doc(uid).set({ uid, lastSeenAt: seenAt });

    const result = await functions.listAuthUsers.run(callableRequest(adminUid, {}));
    const listed = result.users.find(profile => profile.uid === uid);

    assert.equal(listed.firstName, 'Mikel');
    assert.equal(listed.lastName, 'Urtxegi Garcia');
    assert.ok(Number.isFinite(Date.parse(listed.createdAt)));
    assert.equal(listed.lastSeenAt, seenAt.toISOString());
});

test('deleting a group owner transfers ownership and preserves its trip history', async () => {
    const targetUid = await createUser('Owner');
    const replacementUid = await createUser('Member');
    await db.collection('userPresence').doc(targetUid).set({ uid: targetUid, lastSeenAt: new Date() });
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
    assert.equal((await db.collection('userPresence').doc(targetUid).get()).exists, false);
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
