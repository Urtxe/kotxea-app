'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { HttpsError, onCall } = require('firebase-functions/v2/https');

initializeApp();

Object.assign(exports, require('./group-names'));

const functionsConfig = {
    region: 'us-central1',
    maxInstances: 2,
    serviceAccount: 'firebase-adminsdk-fbsvc@kotxea-urtxe.iam.gserviceaccount.com'
};

function validUid(uid) {
    return typeof uid === 'string' && uid.length > 0 && uid.length <= 128 && !uid.includes('/');
}

async function requirePlatformAdmin(request, db) {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    const [role, tombstone] = await Promise.all([
        db.collection('platformRoles').doc(uid).get(),
        db.collection('deletedAccounts').doc(uid).get()
    ]);
    if (tombstone.exists) throw new HttpsError('unauthenticated', 'La cuenta ya no está activa.');
    if (!role.exists || role.data().role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Solo el administrador global puede gestionar las cuentas.');
    }
    return uid;
}

exports.listAuthUsers = onCall(functionsConfig, async request => {
    const db = getFirestore();
    await requirePlatformAdmin(request, db);

    const authUsers = [];
    let pageToken;
    do {
        const page = await getAuth().listUsers(1000, pageToken);
        authUsers.push(...page.users);
        pageToken = page.pageToken;
    } while (pageToken);

    const users = [];
    for (let offset = 0; offset < authUsers.length; offset += 100) {
        const page = authUsers.slice(offset, offset + 100);
        const [roles, profiles, deletions, presences] = await Promise.all([
            db.getAll(...page.map(user => db.collection('platformRoles').doc(user.uid))),
            db.getAll(...page.map(user => db.collection('users').doc(user.uid))),
            db.getAll(...page.map(user => db.collection('deletedAccounts').doc(user.uid))),
            db.getAll(...page.map(user => db.collection('userPresence').doc(user.uid)))
        ]);
        page.forEach((user, index) => {
            const profile = profiles[index].exists ? profiles[index].data() : {};
            const firstName = typeof profile.firstName === 'string' ? profile.firstName.trim() : '';
            const lastName = typeof profile.lastName === 'string' ? profile.lastName.trim() : '';
            const legacyName = (user.displayName || profile.displayName || '').trim();
            const legacyParts = legacyName.split(/\s+/).filter(Boolean);
            const parsedFirstName = legacyParts.shift() || '';
            const lastSeenAt = presences[index].data()?.lastSeenAt?.toDate?.().toISOString() || null;
            users.push({
                uid: user.uid,
                email: user.email || '',
                displayName: user.displayName || profile.displayName || '',
                firstName: firstName || (!lastName ? parsedFirstName : ''),
                lastName: lastName || (!firstName ? legacyParts.join(' ') : ''),
                createdAt: user.metadata.creationTime || null,
                lastSeenAt,
                emailVerified: user.emailVerified,
                disabled: user.disabled,
                deletionPending: deletions[index].exists,
                platformRole: roles[index].exists ? roles[index].data().role : '',
                canParticipate: roles[index].exists && roles[index].data().canParticipate === true
            });
        });
    }
    return { users };
});

exports.setPlatformUser = onCall(functionsConfig, async request => {
    const db = getFirestore();
    const actorUid = await requirePlatformAdmin(request, db);
    const { uid, role, canParticipate } = request.data || {};
    const firstName = typeof request.data?.firstName === 'string' ? request.data.firstName.trim() : '';
    const lastName = typeof request.data?.lastName === 'string' ? request.data.lastName.trim() : '';
    if (!validUid(uid) || !['normal', 'superadmin'].includes(role)
        || typeof canParticipate !== 'boolean' || firstName.length > 80 || lastName.length > 120) {
        throw new HttpsError('invalid-argument', 'Revisa los datos del usuario.');
    }
    if (uid === actorUid && role !== 'superadmin') {
        throw new HttpsError('failed-precondition', 'No puedes quitarte tu propio rol de administrador global.');
    }
    const auth = getAuth();
    let account;
    try { account = await auth.getUser(uid); }
    catch (error) {
        if (error.code === 'auth/user-not-found') throw new HttpsError('not-found', 'La cuenta ya no existe.');
        throw error;
    }
    const displayName = [firstName, lastName].filter(Boolean).join(' ') || account.displayName || account.email || 'Usuario';
    const profileRef = db.collection('users').doc(uid);
    const roleRef = db.collection('platformRoles').doc(uid);
    const tombstoneRef = db.collection('deletedAccounts').doc(uid);
    await db.runTransaction(async transaction => {
        const [tombstone, actorRole, actorTombstone] = await Promise.all([
            transaction.get(tombstoneRef),
            transaction.get(db.collection('platformRoles').doc(actorUid)),
            transaction.get(db.collection('deletedAccounts').doc(actorUid))
        ]);
        if (actorTombstone.exists || !actorRole.exists || actorRole.data().role !== 'superadmin') {
            throw new HttpsError('permission-denied', 'Solo el administrador global puede gestionar las cuentas.');
        }
        if (tombstone.exists) throw new HttpsError('failed-precondition', 'Esta cuenta está en proceso de borrado.');
        if (role === 'superadmin') {
            transaction.set(roleRef, {
                role: 'superadmin', grantedBy: actorUid, grantedAt: FieldValue.serverTimestamp(),
                ...(canParticipate ? { canParticipate: true } : {})
            });
        } else transaction.delete(roleRef);
        transaction.set(profileRef, {
            uid, email: account.email || '', displayName, firstName, lastName
        }, { merge: true });
    });
    await auth.updateUser(uid, { displayName });
    return { success: true };
});

function sortedMemberCandidates(snapshot, excludedUid) {
    const candidates = snapshot.docs.filter(member => member.id !== excludedUid);
    candidates.sort((a, b) => {
        const rank = doc => doc.data().role === 'owner' ? 0 : doc.data().role === 'admin' ? 1 : 2;
        const roleDiff = rank(a) - rank(b);
        if (roleDiff) return roleDiff;
        const joinedA = a.data().joinedAt?.toMillis?.() || 0;
        const joinedB = b.data().joinedAt?.toMillis?.() || 0;
        return joinedA - joinedB;
    });
    return candidates;
}

exports.removeGroupPerson = onCall(functionsConfig, async request => {
    const actorUid = request.auth?.uid;
    if (!actorUid) throw new HttpsError('unauthenticated', 'Hasi saioa.');
    const { groupId, uid, replacementUid } = request.data || {};
    let personId = request.data?.personId || null;
    if (!validUid(groupId) || !(personId ? validUid(personId) : validUid(uid))
        || (uid != null && !validUid(uid)) || (replacementUid != null && !validUid(replacementUid))) {
        throw new HttpsError('invalid-argument', 'Berrikusi taldea eta pertsona.');
    }
    const db = getFirestore();
    const groupRef = db.collection('groups').doc(groupId);
    await db.runTransaction(async transaction => {
        const [groupSnap, actor, role, deletedActor, invites, requests] = await Promise.all([
            transaction.get(groupRef),
            transaction.get(groupRef.collection('members').doc(actorUid)),
            transaction.get(db.collection('platformRoles').doc(actorUid)),
            transaction.get(db.collection('deletedAccounts').doc(actorUid)),
            transaction.get(db.collection('invitations').where('groupId', '==', groupId)),
            transaction.get(db.collection('joinRequests').where('groupId', '==', groupId))
        ]);
        if (deletedActor.exists || !(role.data()?.role === 'superadmin' || ['owner', 'admin'].includes(actor.data()?.role))) {
            throw new HttpsError('permission-denied', 'Ez duzu taldea administratzeko baimenik.');
        }
        let member = uid ? await transaction.get(groupRef.collection('members').doc(uid)) : null;
        const resolvedPersonId = personId || member?.data()?.personId || null;
        const personSnap = resolvedPersonId ? await transaction.get(groupRef.collection('people').doc(encodeURIComponent(resolvedPersonId))) : null;
        if (!groupSnap.exists || groupSnap.data().status !== 'active'
            || (resolvedPersonId && !personSnap?.exists) || (!resolvedPersonId && !member?.exists)) {
            throw new HttpsError('failed-precondition', 'Taldea edo pertsona ez dago erabilgarri.');
        }
        const group = groupSnap.data();
        const person = personSnap?.data();
        if (person?.removed && !member?.exists) return;
        const targetUid = person?.linkedUid || uid || null;
        if (uid && targetUid !== uid) throw new HttpsError('failed-precondition', 'Pertsonaren kontua aldatu da.');
        const memberRef = targetUid ? groupRef.collection('members').doc(targetUid) : null;
        if (!member && memberRef) member = await transaction.get(memberRef);
        const transfer = targetUid && (group.ownerUid === targetUid || ['owner', 'admin'].includes(member?.data()?.role));
        let replacementRef;
        let replacementRole;
        if (transfer) {
            if (!replacementUid || replacementUid === targetUid) {
                throw new HttpsError('failed-precondition', 'Nori eman nahi diozu taldea administratzeko boterea?');
            }
            replacementRef = groupRef.collection('members').doc(replacementUid);
            const [replacement, deletedReplacement] = await Promise.all([
                transaction.get(replacementRef), transaction.get(db.collection('deletedAccounts').doc(replacementUid))
            ]);
            if (!replacement.exists || deletedReplacement.exists) {
                throw new HttpsError('failed-precondition', 'Hautatu taldeko beste kide aktibo bat.');
            }
            replacementRole = replacement.data().role;
        }
        const revokedInvites = invites.docs.filter(doc => (resolvedPersonId && doc.data().personId === resolvedPersonId)
            || (targetUid && doc.data().acceptedBy === targetUid)
            || (member?.data()?.email && doc.data().email === member.data().email));
        const revokedRequests = requests.docs.filter(doc => (resolvedPersonId && doc.data().personId === resolvedPersonId)
            || (targetUid && doc.data().uid === targetUid));
        // Small carpool groups fit one transaction; refuse instead of partially removing a large history.
        if (revokedInvites.length + revokedRequests.length > 440) {
            throw new HttpsError('failed-precondition', 'Ezin da baja osatu. Jarri harremanetan administratzailearekin.');
        }
        if (transfer) {
            const newRole = group.ownerUid === targetUid || replacementRole === 'owner' ? 'owner' : 'admin';
            transaction.update(replacementRef, { role: newRole });
            transaction.set(db.collection('users').doc(replacementUid).collection('groups').doc(groupId), {
                groupId, groupName: group.name, role: newRole
            }, { merge: true });
        }
        transaction.update(groupRef, {
            ...(group.ownerUid === targetUid ? { ownerUid: replacementUid } : {}),
            revision: Number(group.revision || 0) + 1, updatedAt: FieldValue.serverTimestamp()
        });
        // Retain historical references and balances; removed people cannot be reactivated by the UI.
        if (personSnap) transaction.update(personSnap.ref, { removed: true, active: false, linkedUid: FieldValue.delete() });
        if (memberRef) {
            transaction.delete(memberRef);
            transaction.delete(db.collection('users').doc(targetUid).collection('groups').doc(groupId));
        }
        revokedInvites.forEach(doc => transaction.update(doc.ref, {
            status: 'revoked', revokedBy: actorUid, revokedAt: FieldValue.serverTimestamp()
        }));
        revokedRequests.forEach(doc => transaction.update(doc.ref, { status: 'revoked' }));
    });
    return { success: true };
});

exports.deleteGroup = onCall({ ...functionsConfig, timeoutSeconds: 540 }, async request => {
    const actorUid = request.auth?.uid;
    if (!actorUid) throw new HttpsError('unauthenticated', 'Hasi saioa.');
    const { groupId } = request.data || {};
    if (!validUid(groupId) || !/^[\w-]{1,128}$/.test(groupId)) {
        throw new HttpsError('invalid-argument', 'Berrikusi taldearen identifikatzailea.');
    }
    const db = getFirestore();
    const groupRef = db.collection('groups').doc(groupId);
    let group;
    await db.runTransaction(async transaction => {
        const [groupSnap, member, role, tombstone] = await Promise.all([
            transaction.get(groupRef),
            transaction.get(groupRef.collection('members').doc(actorUid)),
            transaction.get(db.collection('platformRoles').doc(actorUid)),
            transaction.get(db.collection('deletedAccounts').doc(actorUid))
        ]);
        const globalAdmin = role.data()?.role === 'superadmin';
        if (tombstone.exists || !groupSnap.exists) {
            throw new HttpsError('not-found', 'Taldea ez da aurkitu.');
        }
        const current = groupSnap.data();
        const authorized = globalAdmin || ['owner', 'admin'].includes(member.data()?.role)
            || (current.status === 'deleting' && current.deletionRequestedBy === actorUid);
        if (!authorized) throw new HttpsError('permission-denied', 'Taldearen jabeak, administratzaileek edo administratzaile globalak soilik ezaba dezakete taldea.');
        if (current.status !== 'deleting') {
            transaction.update(groupRef, {
                status: 'deleting', deletionRequestedBy: actorUid,
                updatedAt: FieldValue.serverTimestamp()
            });
        }
        group = current;
    });

    const [members, invitations, requests] = await Promise.all([
        groupRef.collection('members').get(),
        db.collection('invitations').where('groupId', '==', groupId).get(),
        db.collection('joinRequests').where('groupId', '==', groupId).get()
    ]);
    const externalRefs = [
        ...members.docs.map(member => db.collection('users').doc(member.id).collection('groups').doc(groupId)),
        ...invitations.docs.map(doc => doc.ref),
        ...requests.docs.map(doc => doc.ref),
        db.collection('directoryGroups').doc(groupId)
    ];
    const groupNameKey = group.nameKey;
    if (groupNameKey) {
        const claimRef = db.collection('groupNames').doc(groupNameKey);
        const claim = await claimRef.get();
        if (claim.exists && claim.data().groupId === groupId) externalRefs.push(claimRef);
    }
    for (let offset = 0; offset < externalRefs.length; offset += 400) {
        const batch = db.batch();
        externalRefs.slice(offset, offset + 400).forEach(ref => batch.delete(ref));
        await batch.commit();
    }
    await db.recursiveDelete(groupRef);
    return { success: true };
});

async function markAccountDeleting(db, actorUid, targetUid) {
    const targetTombstoneRef = db.collection('deletedAccounts').doc(targetUid);
    const actorRoleRef = db.collection('platformRoles').doc(actorUid);
    const actorTombstoneRef = db.collection('deletedAccounts').doc(actorUid);
    const groupsRef = db.collection('groups');
    let replacementOwners = new Map();

    await db.runTransaction(async transaction => {
        const [actorRole, actorTombstone, targetTombstone, membershipIndex, ownedGroups, createdGroups] = await Promise.all([
            transaction.get(actorRoleRef),
            transaction.get(actorTombstoneRef),
            transaction.get(targetTombstoneRef),
            transaction.get(db.collection('users').doc(targetUid).collection('groups')),
            transaction.get(groupsRef.where('ownerUid', '==', targetUid)),
            transaction.get(groupsRef.where('createdBy', '==', targetUid))
        ]);
        if (actorTombstone.exists || !actorRole.exists || actorRole.data().role !== 'superadmin') {
            throw new HttpsError('permission-denied', 'Solo el administrador global puede gestionar las cuentas.');
        }

        const affectedGroups = new Map();
        membershipIndex.docs.forEach(membership => affectedGroups.set(membership.id, groupsRef.doc(membership.id)));
        ownedGroups.docs.forEach(group => affectedGroups.set(group.id, group.ref));
        createdGroups.docs.forEach(group => affectedGroups.set(group.id, group.ref));
        const replacementMap = new Map();
        const transferPlans = [];
        for (const groupRef of affectedGroups.values()) {
            const groupSnap = await transaction.get(groupRef);
            if (!groupSnap.exists) continue;
            const group = groupSnap.data();
            if (group.status === 'initializing' && (group.createdBy === targetUid || group.ownerUid === targetUid)) {
                throw new HttpsError('failed-precondition', 'No se puede borrar la cuenta porque tiene un grupo cuya importación sigue incompleta. Reanuda la importación primero.');
            }
            if (group.ownerUid === targetUid) {
                const members = await transaction.get(groupRef.collection('members'));
                let replacement = null;
                for (const candidate of sortedMemberCandidates(members, targetUid)) {
                    const candidateTombstone = await transaction.get(db.collection('deletedAccounts').doc(candidate.id));
                    if (!candidateTombstone.exists) { replacement = candidate; break; }
                }
                if (!replacement) {
                    throw new HttpsError('failed-precondition', `No se puede borrar la cuenta: el grupo «${group.name || groupRef.id}» no tiene otro miembro activo al que transferir la administración.`);
                }
                replacementMap.set(groupRef.id, replacement.id);
                transferPlans.push({ groupRef, group, replacementUid: replacement.id });
            }
        }
        for (const { groupRef, group, replacementUid } of transferPlans) {
            const groupId = groupRef.id;
            transaction.update(groupRef, {
                ownerUid: replacementUid,
                revision: Number(group.revision || 0) + 1,
                updatedAt: FieldValue.serverTimestamp()
            });
            transaction.update(groupRef.collection('members').doc(replacementUid), { role: 'owner' });
            transaction.set(db.collection('users').doc(replacementUid).collection('groups').doc(groupId), {
                groupId, groupName: group.name || 'Grupo', role: 'owner'
            }, { merge: true });
        }
        transaction.set(targetTombstoneRef, {
            state: 'deleting', deletedBy: actorUid, updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        replacementOwners = replacementMap;
    });
    return replacementOwners;
}

async function removeMembership(db, targetUid, groupRef, replacementUid) {
    const targetMemberRef = groupRef.collection('members').doc(targetUid);
    const groupId = groupRef.id;
    const groupDocRef = groupRef;
    await db.runTransaction(async transaction => {
        const [groupSnap, memberSnap] = await Promise.all([
            transaction.get(groupDocRef), transaction.get(targetMemberRef)
        ]);
        if (!groupSnap.exists) {
            transaction.delete(targetMemberRef);
            transaction.delete(db.collection('users').doc(targetUid).collection('groups').doc(groupId));
            return;
        }
        const group = groupSnap.data();
        const isOwner = group.ownerUid === targetUid;
        const replacementRef = isOwner && replacementUid ? groupRef.collection('members').doc(replacementUid) : null;
        const replacementSnap = replacementRef ? await transaction.get(replacementRef) : null;
        const replacementTombstone = replacementRef
            ? await transaction.get(db.collection('deletedAccounts').doc(replacementUid)) : null;
        if (isOwner && (!replacementSnap || !replacementSnap.exists)) {
            throw new HttpsError('failed-precondition', 'No se pudo transferir la administración del grupo. No se ha borrado la cuenta; inténtalo de nuevo.');
        }
        if (isOwner && replacementTombstone.exists) {
            throw new HttpsError('failed-precondition', 'El miembro elegido también está en proceso de borrado. Reintenta la operación para transferir la administración a otra persona.');
        }
        const member = memberSnap.exists ? memberSnap.data() : {};
        const personRef = typeof member.personId === 'string' && member.personId.length > 0
            ? groupRef.collection('people').doc(encodeURIComponent(member.personId)) : null;
        const personSnap = personRef ? await transaction.get(personRef) : null;

        if (isOwner) {
            transaction.update(groupDocRef, {
                ownerUid: replacementUid,
                revision: Number(group.revision || 0) + 1,
                updatedAt: FieldValue.serverTimestamp()
            });
            transaction.update(replacementRef, { role: 'owner' });
            transaction.set(db.collection('users').doc(replacementUid).collection('groups').doc(groupId), {
                groupId, groupName: group.name || 'Grupo', role: 'owner'
            }, { merge: true });
        } else if (group.status === 'active' && memberSnap.exists) {
            transaction.update(groupDocRef, {
                revision: Number(group.revision || 0) + 1,
                updatedAt: FieldValue.serverTimestamp()
            });
        }
        if (personRef && personSnap?.exists && personSnap.data().linkedUid === targetUid) {
            transaction.update(personRef, { linkedUid: FieldValue.delete() });
        }
        transaction.delete(targetMemberRef);
        transaction.delete(db.collection('users').doc(targetUid).collection('groups').doc(groupId));
    });
}

async function deleteInChunks(querySnapshot, transform) {
    const refs = querySnapshot.docs.map(doc => doc.ref);
    for (let offset = 0; offset < refs.length; offset += 400) {
        const batch = getFirestore().batch();
        refs.slice(offset, offset + 400).forEach(ref => transform(batch, ref));
        await batch.commit();
    }
}

exports.deletePlatformUser = onCall(functionsConfig, async request => {
    const db = getFirestore();
    const actorUid = await requirePlatformAdmin(request, db);
    const targetUid = request.data && request.data.uid;
    if (!validUid(targetUid)) throw new HttpsError('invalid-argument', 'Falta la cuenta que quieres borrar.');
    if (targetUid === actorUid) throw new HttpsError('failed-precondition', 'No puedes borrar tu propia cuenta de administración.');

    const auth = getAuth();
    let targetAccount = null;
    try { targetAccount = await auth.getUser(targetUid); }
    catch (error) { if (error.code !== 'auth/user-not-found') throw error; }

    const replacementOwners = await markAccountDeleting(db, actorUid, targetUid);
    const tombstoneRef = db.collection('deletedAccounts').doc(targetUid);

    try {
        // Re-query after the tombstone prevents stale membership indexes from leaving active access behind.
        const [membershipIndex, ownedGroups, createdGroups] = await Promise.all([
            db.collection('users').doc(targetUid).collection('groups').get(),
            db.collection('groups').where('ownerUid', '==', targetUid).get(),
            db.collection('groups').where('createdBy', '==', targetUid).get()
        ]);
        const affectedGroups = new Map();
        membershipIndex.docs.forEach(membership => affectedGroups.set(membership.id, db.collection('groups').doc(membership.id)));
        ownedGroups.docs.forEach(group => affectedGroups.set(group.id, group.ref));
        createdGroups.docs.forEach(group => affectedGroups.set(group.id, group.ref));
        for (const [groupId, groupRef] of affectedGroups) {
            await removeMembership(db, targetUid, groupRef, replacementOwners.get(groupId));
        }

        const [profileGroups, profileRequests, joinRequests, sentInvitations] = await Promise.all([
            db.collection('users').doc(targetUid).collection('groups').get(),
            db.collection('users').doc(targetUid).collection('requests').get(),
            db.collection('joinRequests').where('uid', '==', targetUid).get(),
            db.collection('invitations').where('createdBy', '==', targetUid).get()
        ]);
        await deleteInChunks(profileGroups, (batch, ref) => batch.delete(ref));
        await deleteInChunks(profileRequests, (batch, ref) => batch.delete(ref));
        await deleteInChunks(joinRequests, (batch, ref) => batch.delete(ref));
        await deleteInChunks({ docs: sentInvitations.docs.filter(doc => doc.data().status === 'pending') }, (batch, ref) => batch.update(ref, {
            status: 'revoked', revokedBy: targetUid, revokedAt: FieldValue.serverTimestamp()
        }));

        await Promise.all([
            db.collection('platformRoles').doc(targetUid).delete(),
            db.collection('users').doc(targetUid).delete(),
            db.collection('userPresence').doc(targetUid).delete()
        ]);
        if (targetAccount) {
            try { await auth.deleteUser(targetUid); }
            catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
        }
        await tombstoneRef.set({ state: 'deleted', deletedBy: actorUid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return { success: true };
    } catch (error) {
        await tombstoneRef.set({ state: 'deleting', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        throw error;
    }
});
