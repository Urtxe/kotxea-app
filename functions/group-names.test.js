'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('./index');
const { getFirestore } = require('firebase-admin/firestore');
const functions = require('./group-names');
const db = getFirestore();
const request = (uid, data) => ({ auth: { uid, token: { email_verified: true } }, data });

test('concurrent names differing in case and whitespace reserve only one group', async () => {
    const uid = randomUUID();
    const name = `Route ${randomUUID()}`;
    const results = await Promise.allSettled([
        functions.prepareGroupName.run(request(uid, { groupId: randomUUID(), name })),
        functions.prepareGroupName.run(request(uid, { groupId: randomUUID(), name: ` ${name.toUpperCase()}  ` }))
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'already-exists');
});

test('legacy names block duplicates; rename updates directory, memberships and invitations', async () => {
    const uid = randomUUID(), groupId = randomUUID(), name = `Legacy ${randomUUID()}`;
    const group = db.collection('groups').doc(groupId);
    await group.set({ name, createdBy: uid, ownerUid: uid, status: 'active', discoverable: true });
    await group.collection('members').doc(uid).set({ uid, role: 'owner' });
    const invitation = db.collection('invitations').doc();
    await invitation.set({ groupId, groupName: name });
    await assert.rejects(functions.prepareGroupName.run(request(uid, { groupId: randomUUID(), name: name.toUpperCase() })), { code: 'already-exists' });
    await assert.rejects(functions.renameGroup.run(request(randomUUID(), { groupId, name: 'Other' })), { code: 'permission-denied' });
    const nextName = `Renamed ${randomUUID()}`;
    await functions.renameGroup.run(request(uid, { groupId, name: nextName }));
    assert.equal((await group.get()).data().name, nextName);
    assert.equal((await db.collection('directoryGroups').doc(groupId).get()).data().name, nextName);
    assert.equal((await db.collection('users').doc(uid).collection('groups').doc(groupId).get()).data().groupName, nextName);
    assert.equal((await invitation.get()).data().groupName, nextName);
});
