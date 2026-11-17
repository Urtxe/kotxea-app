'use strict';

const { createHash } = require('node:crypto');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const config = { region: 'us-central1', maxInstances: 2, serviceAccount: 'firebase-adminsdk-fbsvc@kotxea-urtxe.iam.gserviceaccount.com' };
const normalize = name => String(name || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('eu');
const keyFor = name => createHash('sha256').update(normalize(name)).digest('hex');

async function changeName(request, rename) {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Hasi saioa.');
    const { groupId } = request.data || {};
    const name = typeof request.data?.name === 'string' ? request.data.name.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > 100 || typeof groupId !== 'string' || !/^[\w-]{1,128}$/.test(groupId)) throw new HttpsError('invalid-argument', 'Idatzi taldearen izena (gehienez 100 karaktere).');
    const db = getFirestore();
    const nameKey = keyFor(name);
    const groupRef = db.collection('groups').doc(groupId);
    const claimRef = db.collection('groupNames').doc(nameKey);
    await db.runTransaction(async tx => {
        const [tombstone, role, group, member, claim] = await Promise.all([
            tx.get(db.collection('deletedAccounts').doc(uid)), tx.get(db.collection('platformRoles').doc(uid)),
            tx.get(groupRef), tx.get(groupRef.collection('members').doc(uid)), tx.get(claimRef)
        ]);
        const superadmin = role.data()?.role === 'superadmin';
        if (tombstone.exists) throw new HttpsError('permission-denied', 'Kontua ez dago erabilgarri.');
        if (rename ? !group.exists || group.data().status !== 'active' || !(superadmin || ['owner', 'admin'].includes(member.data()?.role))
            : !request.auth.token.email_verified || (superadmin && role.data().canParticipate !== true) || (group.exists && group.data().createdBy !== uid)) {
            throw new HttpsError('permission-denied', 'Ez duzu taldea kudeatzeko baimenik.');
        }
        let occupied = false;
        if (!rename && claim.exists && claim.data().groupId === groupId && claim.data().uid !== uid) {
            throw new HttpsError('permission-denied', 'Taldearen izena beste kontu batek erreserbatu du.');
        }
        if (claim.exists && claim.data().groupId !== groupId) {
            const claimedGroup = await tx.get(db.collection('groups').doc(claim.data().groupId));
            occupied = claimedGroup.exists || claim.data().reservedAt.toMillis() > Date.now() - 15 * 60 * 1000;
        }
        // Legacy groups lack nameKey. Scan until a migration backfills their registry entries;
        // this is acceptable for the current small directory, then replace with indexed lookups.
        const groups = await tx.get(db.collection('groups'));
        if (occupied || groups.docs.some(doc => doc.id !== groupId && normalize(doc.data().name) === normalize(name))) {
            throw new HttpsError('already-exists', 'Izen hori duen talde bat badago. Aukeratu beste izen bat.');
        }
        if (!rename && group.exists && group.data().nameKey !== nameKey) throw new HttpsError('failed-precondition', 'Taldea sortuta dago jada.');
        let members, invites, oldClaim;
        if (rename) {
            [members, invites] = await Promise.all([tx.get(groupRef.collection('members')), tx.get(db.collection('invitations').where('groupId', '==', groupId))]);
            if (group.data().nameKey && group.data().nameKey !== nameKey) oldClaim = await tx.get(db.collection('groupNames').doc(group.data().nameKey));
            if (members.size + invites.size > 440) throw new HttpsError('failed-precondition', 'Taldea handiegia da izena aldatzeko; jarri harremanetan administratzailearekin.');
        }
        tx.set(claimRef, { groupId, uid: rename ? group.data().createdBy : uid, name, reservedAt: Timestamp.now() });
        if (rename) {
            if (oldClaim?.data()?.groupId === groupId) tx.delete(oldClaim.ref);
            tx.update(groupRef, { name, nameKey, revision: Number(group.data().revision || 0) + 1, updatedAt: FieldValue.serverTimestamp() });
            tx.set(db.collection('directoryGroups').doc(groupId), { groupId, name, discoverable: Boolean(group.data().discoverable), status: group.data().status, updatedAt: FieldValue.serverTimestamp() });
            members.docs.forEach(member => tx.set(db.collection('users').doc(member.id).collection('groups').doc(groupId), { groupName: name }, { merge: true }));
            invites.docs.forEach(invite => tx.update(invite.ref, { groupName: name }));
        }
    });
    return { name, nameKey };
}

exports.prepareGroupName = onCall(config, request => changeName(request, false));
exports.renameGroup = onCall(config, request => changeName(request, true));
